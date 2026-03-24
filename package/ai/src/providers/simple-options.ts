import type { Api, Model, SimpleStreamOptions, StreamOptions, ThinkingBudgets, ThinkingLevel } from "../types.js";

export function buildBaseOptions(model: Model<Api>, options?: SimpleStreamOptions, apiKey?: string): StreamOptions {
	const resolvedApiKey = apiKey || options?.apiKey;

	return {
		maxTokens: options?.maxTokens || Math.min(model.maxTokens, 32000),
		...(typeof options?.temperature === "number" ? { temperature: options.temperature } : {}),
		...(options?.signal ? { signal: options.signal } : {}),
		...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
		...(options?.cacheRetention ? { cacheRetention: options.cacheRetention } : {}),
		...(options?.sessionId ? { sessionId: options.sessionId } : {}),
		...(options?.headers ? { headers: options.headers } : {}),
		...(options?.onPayload ? { onPayload: options.onPayload } : {}),
		...(typeof options?.maxRetryDelayMs === "number" ? { maxRetryDelayMs: options.maxRetryDelayMs } : {}),
		...(options?.metadata ? { metadata: options.metadata } : {}),
	};
}

export function clampReasoning(effort: ThinkingLevel | undefined): Exclude<ThinkingLevel, "xhigh"> | undefined {
	return effort === "xhigh" ? "high" : effort;
}

export function adjustMaxTokensForThinking(
	baseMaxTokens: number,
	modelMaxTokens: number,
	reasoningLevel: ThinkingLevel,
	customBudgets?: ThinkingBudgets,
): { maxTokens: number; thinkingBudget: number } {
	const defaultBudgets: ThinkingBudgets = {
		minimal: 1024,
		low: 2048,
		medium: 8192,
		high: 16384,
	};
	const budgets = { ...defaultBudgets, ...customBudgets };

	const minOutputTokens = 1024;
	const level = clampReasoning(reasoningLevel)!;
	let thinkingBudget = budgets[level]!;
	const maxTokens = Math.min(baseMaxTokens + thinkingBudget, modelMaxTokens);

	if (maxTokens <= thinkingBudget) {
		thinkingBudget = Math.max(0, maxTokens - minOutputTokens);
	}

	return { maxTokens, thinkingBudget };
}
