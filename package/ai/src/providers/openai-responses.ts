import OpenAI from "openai";
import type { ResponseCreateParamsStreaming } from "openai/resources/responses/responses.js";
import { getEnvApiKey } from "../env-api-keys.js";
import { supportsXhigh } from "../models.js";
import { getAIConfig, resolveOpenAIConfig } from "../config.js";
import type { OpenAIConfig } from "../config.js";
import type {
	Api,
	AssistantMessage,
	CacheRetention,
	Context,
	Model,
	SimpleStreamOptions,
	StreamFunction,
	StreamOptions,
	Usage,
} from "../types.js";
import { AssistantMessageEventStream } from "../utils/event-stream.js";
import { convertResponsesMessages, convertResponsesTools, processResponsesStream } from "./openai-responses-shared.js";
import { buildBaseOptions, clampReasoning } from "./simple-options.js";

const OPENAI_TOOL_CALL_PROVIDERS = new Set(["openai"]);

/**
 * Resolve cache retention preference.
 * Defaults to "short" and uses PI_CACHE_RETENTION for backward compatibility.
 */
function resolveCacheRetention(cacheRetention?: CacheRetention): CacheRetention {
	if (cacheRetention) {
		return cacheRetention;
	}
	if (typeof process !== "undefined" && process.env.PI_CACHE_RETENTION === "long") {
		return "long";
	}
	return "short";
}

/**
 * Get prompt cache retention based on cacheRetention and base URL.
 * Only applies to direct OpenAI API calls (api.openai.com).
 */
function getPromptCacheRetention(baseUrl: string, cacheRetention: CacheRetention): "24h" | undefined {
	if (cacheRetention !== "long") {
		return undefined;
	}
	if (baseUrl.includes("api.openai.com")) {
		return "24h";
	}
	return undefined;
}

// OpenAI Responses-specific options
export interface OpenAIResponsesOptions extends StreamOptions {
	reasoningEffort?: "minimal" | "low" | "medium" | "high" | "xhigh";
	reasoningSummary?: "auto" | "detailed" | "concise" | null;
	serviceTier?: ResponseCreateParamsStreaming["service_tier"];
}

/**
 * Generate function for OpenAI Responses API
 */
export const streamOpenAIResponses: StreamFunction<"openai-responses", OpenAIResponsesOptions> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: OpenAIResponsesOptions,
): AssistantMessageEventStream => {
	const stream = new AssistantMessageEventStream();

	// Start async processing
	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api as Api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "stop",
			timestamp: Date.now(),
		};

		try {
			// Create OpenAI client
			const apiKey = options?.apiKey || getEnvApiKey(model.provider) || "";
			const client = createClient(model, apiKey, options?.headers);
			let params = buildParams(model, context, options);
			const nextParams = await options?.onPayload?.(params, model);
			if (nextParams !== undefined) {
				params = nextParams as ResponseCreateParamsStreaming;
			}
			const openaiStream = await client.responses.create(
				params,
				options?.signal ? { signal: options.signal } : undefined,
			);
			stream.push({ type: "start", partial: output });

			await processResponsesStream(openaiStream, output, stream, model, {
				serviceTier: options?.serviceTier,
				applyServiceTierPricing,
			});

			if (options?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			if (output.stopReason === "aborted" || output.stopReason === "error") {
				throw new Error("An unknown error occurred");
			}

			stream.push({ type: "done", reason: output.stopReason, message: output });
			stream.end();
		} catch (error) {
			for (const block of output.content) delete (block as { index?: number }).index;
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
};

export const streamSimpleOpenAIResponses: StreamFunction<"openai-responses", SimpleStreamOptions> = (
	model: Model<"openai-responses">,
	context: Context,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream => {
	const apiKey = options?.apiKey || getEnvApiKey(model.provider);
	if (!apiKey) {
		throw new Error(`No API key for provider: ${model.provider}`);
	}

	const base = buildBaseOptions(model, options, apiKey);
	const reasoningEffort = supportsXhigh(model) ? options?.reasoning : clampReasoning(options?.reasoning);

	return streamOpenAIResponses(model, context, {
		...base,
		...(reasoningEffort ? { reasoningEffort } : {}),
	});
};

function createClient(
	model: Model<"openai-responses">,
	apiKey?: string,
	optionsHeaders?: Record<string, string>,
) {
	const highLevelConfig = getAIConfig();
	const headers = {
		...(model.headers ?? {}),
		...(optionsHeaders ?? {}),
	};
	const resolvedApiKey = apiKey ?? highLevelConfig.providers?.openai?.apiKey ?? getEnvApiKey(model.provider);
	const providerConfig: OpenAIConfig = {
		...highLevelConfig.providers?.openai,
		baseUrl: highLevelConfig.providers?.openai?.baseUrl ?? model.baseUrl,
		defaultHeaders: headers,
		...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
	};
	const runtime = resolveOpenAIConfig(highLevelConfig, providerConfig);

	return new OpenAI({
		apiKey: runtime.apiKey,
		baseURL: runtime.baseUrl,
		dangerouslyAllowBrowser: true,
		defaultHeaders: runtime.defaultHeaders,
		fetch: runtime.fetch,
	});
}

function buildParams(model: Model<"openai-responses">, context: Context, options?: OpenAIResponsesOptions) {
	const messages = convertResponsesMessages(model, context, OPENAI_TOOL_CALL_PROVIDERS);

	const cacheRetention = resolveCacheRetention(options?.cacheRetention);
	const promptCacheRetention = getPromptCacheRetention(model.baseUrl, cacheRetention);
	const params: ResponseCreateParamsStreaming = {
		model: model.id,
		input: messages,
		stream: true,
		store: false,
		...(cacheRetention !== "none" && options?.sessionId
			? { prompt_cache_key: options.sessionId }
			: {}),
		...(promptCacheRetention
			? { prompt_cache_retention: promptCacheRetention }
			: {}),
	};

	if (options?.maxTokens) {
		params.max_output_tokens = options?.maxTokens;
	}

	if (options?.temperature !== undefined) {
		params.temperature = options?.temperature;
	}

	if (options?.serviceTier !== undefined) {
		params.service_tier = options.serviceTier;
	}

	if (context.tools) {
		params.tools = convertResponsesTools(context.tools);
	}

	if (model.reasoning) {
		if (options?.reasoningEffort || options?.reasoningSummary) {
			params.reasoning = {
				effort: options?.reasoningEffort || "medium",
				summary: options?.reasoningSummary || "auto",
			};
			params.include = ["reasoning.encrypted_content"];
		} else {
			if (model.name.startsWith("gpt-5")) {
				// Jesus Christ, see https://community.openai.com/t/need-reasoning-false-option-for-gpt-5/1351588/7
				messages.push({
					role: "developer",
					content: [
						{
							type: "input_text",
							text: "# Juice: 0 !important",
						},
					],
				});
			}
		}
	}

	return params;
}

function getServiceTierCostMultiplier(serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined): number {
	switch (serviceTier) {
		case "flex":
			return 0.5;
		case "priority":
			return 2;
		default:
			return 1;
	}
}

function applyServiceTierPricing(usage: Usage, serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined) {
	const multiplier = getServiceTierCostMultiplier(serviceTier);
	if (multiplier === 1) return;

	usage.cost.input *= multiplier;
	usage.cost.output *= multiplier;
	usage.cost.cacheRead *= multiplier;
	usage.cost.cacheWrite *= multiplier;
	usage.cost.total = usage.cost.input + usage.cost.output + usage.cost.cacheRead + usage.cost.cacheWrite;
}
