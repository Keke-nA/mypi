import { afterEach, describe, expect, it, vi } from "vitest";

import { complete, configureAI, getModel, stream, streamSimple, StringEnum, Type, validateToolCall } from "../dist/index.js";

afterEach(() => {
  configureAI({});
});

describe("pi-style openai sdk", () => {
  it("returns typed model metadata for official openai models", () => {
    const model = getModel("openai", "gpt-5.4");

    expect(model).toMatchObject({
      id: "gpt-5.4",
      api: "openai-responses",
      provider: "openai",
      reasoning: true,
      input: ["text", "image"],
    });
  });

  it("completes a tool-using response through the responses api", async () => {
    configureAI({
      fetch: vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const request = toRequest(input, init);
        expect(request.url).toBe("https://openai.example/v1/responses");

        const body = JSON.parse(await request.clone().text()) as Record<string, unknown>;
        expect(body).toMatchObject({
          model: "gpt-4o-mini",
          stream: true,
          tools: [
            {
              type: "function",
              name: "get_time",
            },
          ],
        });
        expect(body.input).toEqual([
          {
            role: "system",
            content: "You are helpful.",
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: "What time is it?",
              },
            ],
          },
        ]);

        return createResponsesSSELikeResponse([
          "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_1\",\"status\":\"in_progress\"}}\n\n",
          "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"status\":\"in_progress\",\"content\":[]}}\n\n",
          "event: response.content_part.added\ndata: {\"type\":\"response.content_part.added\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"part\":{\"type\":\"output_text\",\"text\":\"\",\"annotations\":[]}}\n\n",
          "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_1\",\"output_index\":0,\"content_index\":0,\"delta\":\"I will check.\"}\n\n",
          "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"item\":{\"id\":\"msg_1\",\"type\":\"message\",\"role\":\"assistant\",\"status\":\"completed\",\"content\":[{\"type\":\"output_text\",\"text\":\"I will check.\",\"annotations\":[]}]}}\n\n",
          "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"get_time\",\"arguments\":\"\"}}\n\n",
          "event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_1\",\"output_index\":1,\"delta\":\"{\\\"timezone\\\":\\\"UTC\\\"}\"}\n\n",
          "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"item\":{\"id\":\"fc_1\",\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"get_time\",\"arguments\":\"{\\\"timezone\\\":\\\"UTC\\\"}\"}}\n\n",
          "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"status\":\"completed\",\"service_tier\":\"default\",\"usage\":{\"input_tokens\":10,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":5,\"output_tokens_details\":{\"reasoning_tokens\":0},\"total_tokens\":15}}}\n\n",
        ]);
      }) as typeof fetch,
      providers: {
        openai: {
          apiKey: "test-key",
          baseUrl: "https://openai.example/v1",
        },
      },
    });

    const response = await complete(
      getModel("openai", "gpt-4o-mini"),
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
        textSignature: expect.any(String),
      },
      {
        type: "toolCall",
        id: "call_1|fc_1",
        name: "get_time",
        arguments: {
          timezone: "UTC",
        },
      },
    ]);
    expect(response.stopReason).toBe("toolUse");
    expect(response.usage.input).toBe(10);
    expect(response.usage.output).toBe(5);
    expect(response.usage.cost.total).toBeGreaterThan(0);
  });

  it("streams text, thinking and tool-call events", async () => {
    configureAI({
      fetch: vi.fn(async () =>
        createResponsesSSELikeResponse([
          "event: response.created\ndata: {\"type\":\"response.created\",\"response\":{\"id\":\"resp_2\",\"status\":\"in_progress\"}}\n\n",
          "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[]}}\n\n",
          "event: response.reasoning_summary_part.added\ndata: {\"type\":\"response.reasoning_summary_part.added\",\"item_id\":\"rs_1\",\"part\":{\"type\":\"summary_text\",\"text\":\"\"}}\n\n",
          "event: response.reasoning_summary_text.delta\ndata: {\"type\":\"response.reasoning_summary_text.delta\",\"item_id\":\"rs_1\",\"delta\":\"Thinking...\"}\n\n",
          "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"item\":{\"id\":\"rs_1\",\"type\":\"reasoning\",\"summary\":[{\"type\":\"summary_text\",\"text\":\"Thinking...\"}]}}\n\n",
          "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"msg_2\",\"type\":\"message\",\"role\":\"assistant\",\"status\":\"in_progress\",\"content\":[]}}\n\n",
          "event: response.content_part.added\ndata: {\"type\":\"response.content_part.added\",\"item_id\":\"msg_2\",\"output_index\":1,\"content_index\":0,\"part\":{\"type\":\"output_text\",\"text\":\"\",\"annotations\":[]}}\n\n",
          "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"item_id\":\"msg_2\",\"output_index\":1,\"content_index\":0,\"delta\":\"Hello\"}\n\n",
          "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"item\":{\"id\":\"msg_2\",\"type\":\"message\",\"role\":\"assistant\",\"status\":\"completed\",\"content\":[{\"type\":\"output_text\",\"text\":\"Hello\",\"annotations\":[]}]}}\n\n",
          "event: response.output_item.added\ndata: {\"type\":\"response.output_item.added\",\"item\":{\"id\":\"fc_2\",\"type\":\"function_call\",\"call_id\":\"call_2\",\"name\":\"write_file\",\"arguments\":\"\"}}\n\n",
          "event: response.function_call_arguments.delta\ndata: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"fc_2\",\"output_index\":2,\"delta\":\"{\\\"path\\\":\\\"README.md\\\"}\"}\n\n",
          "event: response.output_item.done\ndata: {\"type\":\"response.output_item.done\",\"item\":{\"id\":\"fc_2\",\"type\":\"function_call\",\"call_id\":\"call_2\",\"name\":\"write_file\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}\n\n",
          "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_2\",\"status\":\"completed\",\"usage\":{\"input_tokens\":4,\"input_tokens_details\":{\"cached_tokens\":0},\"output_tokens\":2,\"output_tokens_details\":{\"reasoning_tokens\":0},\"total_tokens\":6}}}\n\n",
        ]),
      ) as typeof fetch,
      providers: {
        openai: {
          apiKey: "test-key",
          baseUrl: "https://api.openai.com/v1",
        },
      },
    });

    const events = [];
    const s = streamSimple(
      getModel("openai", "gpt-5.4"),
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
        reasoning: "high",
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
      "toolcall_start",
      "toolcall_delta",
      "toolcall_end",
      "done",
    ]);

    const doneEvent = events[events.length - 1];
    expect(doneEvent).toMatchObject({
      type: "done",
      reason: "toolUse",
    });
  });

  it("validates tool arguments with TypeBox + AJV", () => {
    const tools = [
      {
        name: "get_weather",
        description: "Get weather",
        parameters: Type.Object({
          location: Type.String(),
          units: StringEnum(["celsius", "fahrenheit"] as const),
        }),
      },
    ];

    expect(
      validateToolCall(tools, {
        type: "toolCall",
        id: "call_1",
        name: "get_weather",
        arguments: {
          location: "Shanghai",
          units: "celsius",
        },
      }),
    ).toEqual({
      location: "Shanghai",
      units: "celsius",
    });

    expect(() =>
      validateToolCall(tools, {
        type: "toolCall",
        id: "call_1",
        name: "get_weather",
        arguments: {
          location: "Shanghai",
          units: "kelvin",
        },
      }),
    ).toThrowError(/Validation failed/);
  });
});

function createResponsesSSELikeResponse(chunks: string[]): Response {
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
