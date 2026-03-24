import { stdin, stdout } from "node:process";

import { complete, configureAI, getModel, stream } from "../dist/index.js";

async function readStdin() {
  let data = "";
  for await (const chunk of stdin) {
    data += chunk;
  }
  return data.trim();
}

async function main() {
  const raw = await readStdin();
  if (!raw) {
    throw new Error("Expected JSON config on stdin.");
  }

  const input = JSON.parse(raw);
  const urls = Array.isArray(input.urls) ? input.urls : [];
  const apiKey = typeof input.apiKey === "string" ? input.apiKey : "";
  const model = typeof input.model === "string" ? input.model : "gpt-5.4";

  if (!apiKey) {
    throw new Error("Missing apiKey.");
  }

  const errors = [];

  for (const url of urls) {
    try {
      const discoveredModelId = await discoverModel(url, apiKey, model);
      configureAI({
        providers: {
          openai: {
            apiKey,
            baseUrl: url,
          },
        },
      });
      const resolvedModel = getModel("openai", discoveredModelId);

      const completion = await complete(
        resolvedModel,
        {
          messages: [{
            role: "user",
            content: "Reply with exactly PONG and nothing else.",
            timestamp: Date.now(),
          }],
        },
        {
          temperature: 0,
          maxTokens: 16,
        },
      );

      let streamedText = "";
      const streamEvents = [];
      for await (const event of stream(
        resolvedModel,
        {
          messages: [{
            role: "user",
            content: "Reply with exactly STREAM and nothing else.",
            timestamp: Date.now(),
          }],
        },
        {
          temperature: 0,
          maxTokens: 16,
        },
      )) {
        streamEvents.push(event.type);
        if (event.type === "text_delta") {
          streamedText += event.delta;
        }
        if (event.type === "error") {
          throw new Error(`stream error: ${event.error.errorMessage ?? "unknown error"}`);
        }
      }

      stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            url,
            model: resolvedModel.id,
            complete: {
              finishReason: completion.stopReason,
              text: completion.content
                .filter((part) => part.type === "text")
                .map((part) => part.text)
                .join(""),
              usage: completion.usage ?? null,
            },
            stream: {
              text: streamedText,
              eventTypes: streamEvents,
            },
          },
          null,
          2,
        )}\n`,
      );
      return;
    } catch (error) {
      errors.push({
        url,
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
        ...(error && typeof error === "object" && "code" in error ? { code: error.code } : {}),
        ...(error && typeof error === "object" && "status" in error ? { status: error.status } : {}),
        ...(error && typeof error === "object" && "details" in error && error.details
          ? { details: error.details }
          : {}),
        ...(error instanceof Error && error.cause
          ? {
              cause:
                error.cause instanceof Error
                  ? {
                      name: error.cause.name,
                      message: error.cause.message,
                    }
                  : String(error.cause),
            }
          : {}),
      });
    }
  }

  stdout.write(
    `${JSON.stringify(
      {
        ok: false,
        errors,
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
}

async function discoverModel(baseUrl, apiKey, requestedModel) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      headers: {
        authorization: `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      return requestedModel;
    }

    const body = await response.json();
    const ids = Array.isArray(body?.data)
      ? body.data
          .map((item) => (item && typeof item.id === "string" ? item.id : null))
          .filter(Boolean)
      : [];

    if (!ids.length) {
      return requestedModel;
    }

    if (ids.includes(requestedModel)) {
      return requestedModel;
    }

    const preferred = [
      "gpt-5.4",
      "gpt-5",
      "gpt-5.4-pro",
      "gpt-5-mini",
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4.1-mini",
      "gpt-4.1",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
    ].find((id) => ids.includes(id));

    const selected = preferred ?? ids[0];
    return selected;
  } catch {
    return requestedModel;
  }
}

await main();
