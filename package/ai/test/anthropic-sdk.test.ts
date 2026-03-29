import { afterEach, describe, expect, it, vi } from "vitest";

import { complete, configureAI, getModel, streamSimple, Type } from "../dist/index.js";

afterEach(() => {
  configureAI({});
});

describe("anthropic messages sdk", () => {
  it("returns typed model metadata for official anthropic models", () => {
    const model = getModel("anthropic", "claude-sonnet-4-5");

    expect(model).toMatchObject({
      id: "claude-sonnet-4-5",
      api: "anthropic-messages",
      provider: "anthropic",
      reasoning: true,
      input: ["text", "image"],
    });
  });

  it("completes a tool-using response through the messages api", async () => {
    configureAI({
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = toRequest(input, init);
        expect(request.url).toBe("https://anthropic.example/v1/messages");

        const body = JSON.parse(await request.clone().text()) as Record<string, any>;
        expect(body.model).toBe("claude-sonnet-4-5");
        expect(body.stream).toBe(true);
        expect(body.system[0].text).toBe("You are helpful.");
        expect(body.messages[0].role).toBe("user");
        expect(body.messages[0].content[0].text).toBe("What time is it?");
        expect(body.tools).toMatchObject([
          {
            name: "get_time",
            description: "Get current time",
          },
        ]);

        return createAnthropicSSELikeResponse([
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4-5","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"I will check."}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"get_time","input":{}}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"timezone\\":\\"UTC\\"}"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":5}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]);
      }) as typeof fetch,
      providers: {
        anthropic: {
          apiKey: "test-anthropic-key",
          baseUrl: "https://anthropic.example",
        },
      },
    });

    const response = await complete(
      getModel("anthropic", "claude-sonnet-4-5"),
      {
        systemPrompt: "You are helpful.",
        tools: [
          {
            name: "get_time",
            description: "Get current time",
            parameters: Type.Object({
              timezone: Type.Optional(Type.String()),
            }),
          },
        ],
        messages: [
          {
            role: "user",
            content: "What time is it?",
            timestamp: Date.now(),
          },
        ],
      },
    );

    expect(response.content).toEqual([
      {
        type: "text",
        text: "I will check.",
      },
      {
        type: "toolCall",
        id: "toolu_1",
        name: "get_time",
        arguments: {
          timezone: "UTC",
        },
      },
    ]);
    expect(response.stopReason).toBe("toolUse");
    expect(response.usage.input).toBe(10);
    expect(response.usage.output).toBe(5);
    expect(response.usage.totalTokens).toBe(15);
    expect(response.usage.cost.total).toBeGreaterThan(0);
  });

  it("streams thinking and text events", async () => {
    configureAI({
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = toRequest(input, init);
        expect(request.url).toBe("https://anthropic.example/v1/messages");

        const body = JSON.parse(await request.clone().text()) as Record<string, any>;
        expect(body.model).toBe("claude-opus-4-6");
        expect(body.thinking).toEqual({ type: "adaptive" });
        expect(body.output_config).toEqual({ effort: "max" });
        expect(body.messages[0].role).toBe("user");
        expect(body.messages[0].content[0].text).toBe("hello");

        return createAnthropicSSELikeResponse([
          'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":4,"output_tokens":0}}}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":"","signature":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Thinking..."}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"sig_1"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
          'event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}\n\n',
          'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}\n\n',
          'event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n',
          'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}\n\n',
          'event: message_stop\ndata: {"type":"message_stop"}\n\n',
        ]);
      }) as typeof fetch,
      providers: {
        anthropic: {
          apiKey: "test-anthropic-key",
          baseUrl: "https://anthropic.example",
        },
      },
    });

    const events = [];
    const s = streamSimple(
      getModel("anthropic", "claude-opus-4-6"),
      {
        messages: [
          {
            role: "user",
            content: "hello",
            timestamp: Date.now(),
          },
        ],
      },
      {
        reasoning: "xhigh",
      },
    );

    for await (const event of s) {
      events.push(event);
    }

    expect(events.map((event) => event.type)).toEqual([
      "start",
      "thinking_start",
      "thinking_delta",
      "thinking_end",
      "text_start",
      "text_delta",
      "text_end",
      "done",
    ]);

    const doneEvent = events[events.length - 1];
    expect(doneEvent).toMatchObject({
      type: "done",
      reason: "stop",
    });
  });
});

function createAnthropicSSELikeResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(chunk));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: {
        "content-type": "text/event-stream",
      },
    },
  );
}

function toRequest(input: string | URL | Request, init?: RequestInit): Request {
  if (input instanceof Request) {
    return input;
  }

  return new Request(input, init);
}
