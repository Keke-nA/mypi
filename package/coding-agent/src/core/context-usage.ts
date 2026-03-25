import type { Model, Usage } from "@mypi/ai";
import type { AgentMessage } from "@mypi/agent";
import { buildSessionContext } from "./session-context.js";
import type { SessionEntry } from "./session-types.js";

export interface ContextUsageSnapshot {
	tokens: number | null;
	contextWindow: number;
	percent: number | null;
	source: "usage+estimate" | "estimate-only" | "unknown";
}

export interface EstimatedContextTokens {
	tokens: number;
	usageTokens: number;
	trailingTokens: number;
	lastUsageIndex: number | null;
}

export interface AutoCompactionSettings {
	enabled?: boolean;
	thresholdPercent?: number;
	reserveTokens?: number;
	keepRecentTokens?: number;
	retryOnOverflow?: boolean;
	showUsageInUi?: boolean;
}

export interface ResolvedAutoCompactionSettings {
	enabled: boolean;
	thresholdPercent: number;
	reserveTokens: number;
	keepRecentTokens: number;
	retryOnOverflow: boolean;
	showUsageInUi: boolean;
}

const DEFAULT_IMAGE_TOKENS = 1200;

function estimateTextTokens(text: string): number {
	return Math.ceil(text.length / 4);
}

function estimateContentArrayTokens(content: readonly { type: string }[]): number {
	let total = 0;
	for (const part of content) {
		if (part.type === "text" && "text" in part && typeof part.text === "string") {
			total += estimateTextTokens(part.text);
			continue;
		}
		if (part.type === "image") {
			total += DEFAULT_IMAGE_TOKENS;
		}
	}
	return total;
}

export function hasValidAssistantUsage(
	message: AgentMessage,
): message is Extract<AgentMessage, { role: "assistant" }> {
	return message.role === "assistant" && message.stopReason !== "error" && message.stopReason !== "aborted";
}

export function calculateContextTokens(usage: Usage): number {
	return usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
}

export function estimateMessageTokens(message: AgentMessage): number {
	switch (message.role) {
		case "user":
			return typeof message.content === "string" ? estimateTextTokens(message.content) : estimateContentArrayTokens(message.content);
		case "assistant": {
			let total = 0;
			for (const part of message.content) {
				if (part.type === "text") {
					total += estimateTextTokens(part.text);
					continue;
				}
				if (part.type === "thinking") {
					total += estimateTextTokens(part.thinking);
					continue;
				}
				total += estimateTextTokens(`${part.name}${JSON.stringify(part.arguments)}`);
			}
			return total;
		}
		case "toolResult":
			return estimateContentArrayTokens(message.content);
		case "branch_summary":
		case "compaction_summary":
			return estimateTextTokens(message.summary);
		case "custom_message":
			return typeof message.content === "string" ? estimateTextTokens(message.content) : estimateContentArrayTokens(message.content);
	}
	return 0;
}

export function estimateContextMessageTokens(messages: readonly AgentMessage[]): number {
	let total = 0;
	for (const message of messages) {
		total += estimateMessageTokens(message);
	}
	return total;
}

export function getLastAssistantUsageInfo(messages: readonly AgentMessage[]): { usage: Usage; index: number } | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || !hasValidAssistantUsage(message)) {
			continue;
		}
		return { usage: message.usage, index };
	}
	return undefined;
}

export function estimateContextTokens(messages: readonly AgentMessage[]): EstimatedContextTokens {
	const usageInfo = getLastAssistantUsageInfo(messages);
	if (!usageInfo) {
		const trailingTokens = estimateContextMessageTokens(messages);
		return {
			tokens: trailingTokens,
			usageTokens: 0,
			trailingTokens,
			lastUsageIndex: null,
		};
	}

	const usageTokens = calculateContextTokens(usageInfo.usage);
	let trailingTokens = 0;
	for (let index = usageInfo.index + 1; index < messages.length; index++) {
		const message = messages[index];
		if (!message) {
			continue;
		}
		trailingTokens += estimateMessageTokens(message);
	}
	return {
		tokens: usageTokens + trailingTokens,
		usageTokens,
		trailingTokens,
		lastUsageIndex: usageInfo.index,
	};
}

export function resolveAutoCompactionSettings(
	settings: AutoCompactionSettings | undefined,
): ResolvedAutoCompactionSettings {
	return {
		enabled: settings?.enabled !== false,
		thresholdPercent: settings?.thresholdPercent ?? 80,
		reserveTokens: settings?.reserveTokens ?? 16_384,
		keepRecentTokens: settings?.keepRecentTokens ?? 20_000,
		retryOnOverflow: settings?.retryOnOverflow !== false,
		showUsageInUi: settings?.showUsageInUi !== false,
	};
}

export function getAutoCompactionTriggerTokens(
	contextWindow: number,
	settings: AutoCompactionSettings | undefined,
): number {
	const resolved = resolveAutoCompactionSettings(settings);
	const percentThreshold = Math.floor((contextWindow * resolved.thresholdPercent) / 100);
	const reserveThreshold = contextWindow - resolved.reserveTokens;
	if (reserveThreshold <= 0) {
		return percentThreshold;
	}
	return Math.min(percentThreshold, reserveThreshold);
}

export function shouldAutoCompact(
	usage: ContextUsageSnapshot | undefined,
	settings: AutoCompactionSettings | undefined,
): boolean {
	const resolved = resolveAutoCompactionSettings(settings);
	if (!resolved.enabled || !usage || usage.tokens === null) {
		return false;
	}
	return usage.tokens >= getAutoCompactionTriggerTokens(usage.contextWindow, resolved);
}

export function getContextUsageSnapshot(options: {
	entries: readonly SessionEntry[];
	leafId: string | null;
	model: Model<any> | null | undefined;
}): ContextUsageSnapshot | undefined {
	const contextWindow = options.model?.contextWindow ?? 0;
	if (contextWindow <= 0) {
		return undefined;
	}

	const context = buildSessionContext(options.entries, { leafId: options.leafId });
	const latestCompactionIndex = context.branch.findLastIndex((entry) => entry.type === "compaction");
	if (latestCompactionIndex >= 0) {
		let hasPostCompactionUsage = false;
		for (let index = context.branch.length - 1; index > latestCompactionIndex; index--) {
			const entry = context.branch[index];
			if (entry?.type === "message" && hasValidAssistantUsage(entry.message)) {
				hasPostCompactionUsage = true;
				break;
			}
		}
		if (!hasPostCompactionUsage) {
			return {
				tokens: null,
				contextWindow,
				percent: null,
				source: "unknown",
			};
		}
	}

	const estimate = estimateContextTokens(context.messages);
	return {
		tokens: estimate.tokens,
		contextWindow,
		percent: (estimate.tokens / contextWindow) * 100,
		source: estimate.lastUsageIndex === null ? "estimate-only" : "usage+estimate",
	};
}

export function isContextOverflowError(errorMessage: string | undefined): boolean {
	if (!errorMessage) {
		return false;
	}
	return [
		/model_context_window_exceeded/i,
		/context(?: |_)?length(?: |_)?exceeded/i,
		/max(?:imum)? context length/i,
		/context window exceeded/i,
		/context overflow/i,
		/too many tokens/i,
		/input(?: token)?s?.*exceed/i,
	].some((pattern) => pattern.test(errorMessage));
}
