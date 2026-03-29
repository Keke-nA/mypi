import { registerApiProvider } from "../api-registry.js";
import { streamAnthropic, streamSimpleAnthropic } from "./anthropic.js";
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from "./openai-responses.js";

registerApiProvider(
  {
    api: "openai-responses",
    stream: streamOpenAIResponses,
    streamSimple: streamSimpleOpenAIResponses,
  },
  "builtins",
);

registerApiProvider(
  {
    api: "anthropic-messages",
    stream: streamAnthropic,
    streamSimple: streamSimpleAnthropic,
  },
  "builtins",
);
