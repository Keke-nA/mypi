import { registerApiProvider } from "../api-registry.js";
import { streamOpenAIResponses, type OpenAIResponsesOptions, streamSimpleOpenAIResponses } from "./openai-responses.js";

registerApiProvider({
  api: "openai-responses",
  stream: streamOpenAIResponses,
  streamSimple: streamSimpleOpenAIResponses,
}, "openai-only");
