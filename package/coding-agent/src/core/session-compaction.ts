import type { AgentMessage } from "@mypi/agent";
import { buildSessionContext } from "./session-context.js";
import type { CompactionEntry, CompactionSummaryResult, SessionEntry } from "./session-types.js";
import { SessionManager } from "./session-manager.js";

export interface CompactionSettings {
	keepRecentTokens?: number;
	reserveTokens?: number;
	enabled?: boolean;
}

export interface PreparedCompaction {
	pathEntries: SessionEntry[];
	entriesToCompact: SessionEntry[];
	keptEntries: SessionEntry[];
	firstKeptEntryId: string;
	tokensBefore: number;
	previousSummary?: string;
	latestCompaction?: CompactionEntry;
}

export interface CompactionGeneratorInput {
	entries: SessionEntry[];
	messages: AgentMessage[];
	previousSummary?: string;
	keptEntries: SessionEntry[];
	tokensBefore: number;
	signal?: AbortSignal;
}

export type CompactionSummaryGenerator = (
	input: CompactionGeneratorInput,
) => Promise<CompactionSummaryResult | string> | CompactionSummaryResult | string;

export function estimateTokens(messages: readonly AgentMessage[]): number {
	let total = 0;
	for (const message of messages) {
		switch (message.role) {
			case "user": {
				const text = typeof message.content === "string"
					? message.content
					: message.content.map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`)).join("\n");
				total += Math.ceil(text.length / 4);
				break;
			}
			case "assistant": {
				const text = message.content
					.map((part) => {
						if (part.type === "text") return part.text;
						if (part.type === "thinking") return part.thinking;
						return JSON.stringify(part.arguments);
					})
					.join("\n");
				total += Math.ceil(text.length / 4);
				break;
			}
			case "toolResult":
				total += Math.ceil(message.content.map((part) => (part.type === "text" ? part.text : "[image]")).join("\n").length / 4);
				break;
			case "branch_summary":
			case "compaction_summary":
				total += Math.ceil(message.summary.length / 4);
				break;
			case "custom_message": {
				const text = typeof message.content === "string"
					? message.content
					: message.content.map((part) => (part.type === "text" ? part.text : `[image:${part.mimeType}]`)).join("\n");
				total += Math.ceil(text.length / 4);
				break;
			}
		}
	}
	return total;
}

function entryMessages(entry: SessionEntry): AgentMessage[] {
	const context = buildSessionContext([entry], { leafId: entry.id });
	return context.messages;
}

function estimateEntryTokens(entry: SessionEntry): number {
	return estimateTokens(entryMessages(entry));
}

function isTurnStartEntry(entry: SessionEntry): boolean {
	if (entry.type === "message") {
		return entry.message.role === "user";
	}
	return entry.type === "branch_summary" || entry.type === "custom_message";
}

export function findValidCutPoints(entries: readonly SessionEntry[]): number[] {
	const points: number[] = [];
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		if (entry && isTurnStartEntry(entry)) {
			points.push(index);
		}
	}
	return points;
}

export function findTurnStartIndex(entries: readonly SessionEntry[], index: number): number {
	for (let current = index; current >= 0; current--) {
		const entry = entries[current];
		if (entry && isTurnStartEntry(entry)) {
			return current;
		}
	}
	return 0;
}

function estimateEntriesTokens(entries: readonly SessionEntry[]): number {
	let total = 0;
	for (const entry of entries) {
		total += estimateEntryTokens(entry);
	}
	return total;
}

export function findCutPoint(entries: readonly SessionEntry[], keepRecentTokens: number): number | null {
	if (entries.length < 2) {
		return null;
	}

	for (let index = 1; index < entries.length; index++) {
		const candidate = findTurnStartIndex(entries, index);
		if (candidate <= 0) {
			continue;
		}
		if (!isTurnStartEntry(entries[candidate]!)) {
			continue;
		}
		const suffixTokens = estimateEntriesTokens(entries.slice(candidate));
		if (suffixTokens <= keepRecentTokens) {
			return candidate;
		}
	}

	return null;
}

export function prepareCompaction(
	pathEntries: readonly SessionEntry[],
	settings: CompactionSettings = {},
): PreparedCompaction {
	if (pathEntries.length === 0) {
		throw new Error("Cannot compact an empty session branch");
	}
	if (pathEntries[pathEntries.length - 1]?.type === "compaction") {
		throw new Error("Already compacted at current leaf");
	}

	const keepRecentTokens = settings.keepRecentTokens ?? 20_000;
	const latestCompactionIndex = pathEntries.findLastIndex((entry) => entry.type === "compaction");
	const latestCompaction = latestCompactionIndex >= 0 ? (pathEntries[latestCompactionIndex] as CompactionEntry) : undefined;
	const tailEntries = latestCompactionIndex >= 0 ? pathEntries.slice(latestCompactionIndex + 1) : pathEntries.slice();
	if (tailEntries.length < 2) {
		throw new Error("Not enough new entries to compact");
	}

	const cutPoint = findCutPoint(tailEntries, keepRecentTokens);
	if (cutPoint === null || cutPoint <= 0) {
		throw new Error("No valid compaction cut point found");
	}

	const entriesToCompact = tailEntries.slice(0, cutPoint);
	const keptEntries = tailEntries.slice(cutPoint);
	const firstKept = keptEntries[0];
	if (!firstKept) {
		throw new Error("Compaction must keep at least one entry");
	}

	const currentContext = buildSessionContext(pathEntries, { leafId: pathEntries[pathEntries.length - 1]?.id ?? null });
	return {
		pathEntries: pathEntries.slice(),
		entriesToCompact,
		keptEntries,
		firstKeptEntryId: firstKept.id,
		tokensBefore: estimateTokens(currentContext.messages),
		...(latestCompaction ? { latestCompaction, previousSummary: latestCompaction.summary } : {}),
	};
}

function messagesForCompaction(entries: readonly SessionEntry[]): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const entry of entries) {
		const context = buildSessionContext([entry], { leafId: entry.id });
		messages.push(...context.messages);
	}
	return messages;
}

export async function compact(
	manager: SessionManager,
	options: {
		generateSummary: CompactionSummaryGenerator;
		leafId?: string | null;
		settings?: CompactionSettings;
		signal?: AbortSignal;
	},
): Promise<CompactionEntry> {
	const leafId = options.leafId === undefined ? manager.getLeafId() : options.leafId;
	const pathEntries = manager.getBranch(leafId);
	const prepared = prepareCompaction(pathEntries, options.settings);
	const result = await options.generateSummary({
		entries: prepared.entriesToCompact,
		messages: messagesForCompaction(prepared.entriesToCompact),
		...(prepared.previousSummary === undefined ? {} : { previousSummary: prepared.previousSummary }),
		keptEntries: prepared.keptEntries,
		tokensBefore: prepared.tokensBefore,
		...(options.signal === undefined ? {} : { signal: options.signal }),
	});
	const summary = typeof result === "string" ? { summary: result } : result;
	return manager.appendCompaction({
		summary: summary.summary,
		firstKeptEntryId: prepared.firstKeptEntryId,
		tokensBefore: prepared.tokensBefore,
		...(summary.details === undefined ? {} : { details: summary.details }),
	});
}

export function shouldCompact(
	messages: readonly AgentMessage[],
	contextWindow: number,
	settings: CompactionSettings = {},
): boolean {
	if (settings.enabled === false) {
		return false;
	}
	const reserveTokens = settings.reserveTokens ?? 16_384;
	return estimateTokens(messages) > contextWindow - reserveTokens;
}
