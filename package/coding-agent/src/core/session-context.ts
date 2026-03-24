import type { AgentMessage } from "@mypi/agent";
import { createBranchSummaryMessage, createCompactionSummaryMessage } from "./messages.js";
import type {
	BranchSummaryEntry,
	CompactionEntry,
	SessionContext,
	SessionEntry,
	SessionModelRef,
	SessionThinkingLevel,
} from "./session-types.js";

export interface BuildSessionContextOptions {
	leafId?: string | null;
	byId?: ReadonlyMap<string, SessionEntry>;
	defaultThinkingLevel?: SessionThinkingLevel;
}

export function indexEntries(entries: readonly SessionEntry[]): Map<string, SessionEntry> {
	return new Map(entries.map((entry) => [entry.id, entry]));
}

export function getBranchEntries(
	byId: ReadonlyMap<string, SessionEntry>,
	leafId: string | null | undefined,
): SessionEntry[] {
	if (!leafId) {
		return [];
	}

	const branch: SessionEntry[] = [];
	const seen = new Set<string>();
	let currentId: string | null | undefined = leafId;

	while (currentId) {
		if (seen.has(currentId)) {
			break;
		}
		seen.add(currentId);
		const entry = byId.get(currentId);
		if (!entry) {
			break;
		}
		branch.push(entry);
		currentId = entry.parentId;
	}

	return branch.reverse();
}

function restoreModelFromMessage(entry: SessionEntry): SessionModelRef | null {
	if (entry.type !== "message" || entry.message.role !== "assistant") {
		return null;
	}
	return {
		provider: entry.message.provider,
		modelId: entry.message.model,
	};
}

function entryToMessages(entry: SessionEntry): AgentMessage[] {
	switch (entry.type) {
		case "message":
			return [entry.message];
		case "custom_message":
			return [entry.message];
		case "branch_summary":
			return [
				createBranchSummaryMessage(entry.summary, {
					fromEntryId: entry.fromId,
					timestamp: Date.parse(entry.timestamp) || Date.now(),
					...(entry.details === undefined ? {} : { details: entry.details }),
				}),
			];
		default:
			return [];
	}
}

function getLatestCompactionIndex(entries: readonly SessionEntry[]): number {
	for (let index = entries.length - 1; index >= 0; index--) {
		if (entries[index]?.type === "compaction") {
			return index;
		}
	}
	return -1;
}

function resolveLeafId(entries: readonly SessionEntry[], byId: ReadonlyMap<string, SessionEntry>, leafId?: string | null): string | null {
	if (leafId === null) {
		return null;
	}
	if (typeof leafId === "string") {
		return byId.has(leafId) ? leafId : (entries[entries.length - 1]?.id ?? null);
	}
	return entries[entries.length - 1]?.id ?? null;
}

export function buildSessionContext(
	entries: readonly SessionEntry[],
	options: BuildSessionContextOptions = {},
): SessionContext {
	const byId = options.byId ?? indexEntries(entries);
	const leafId = resolveLeafId(entries, byId, options.leafId);
	const branch = getBranchEntries(byId, leafId);
	let thinkingLevel: SessionThinkingLevel = options.defaultThinkingLevel ?? "off";
	let model: SessionModelRef | null = null;
	let fallbackModel: SessionModelRef | null = null;
	let hasExplicitModel = false;

	for (const entry of branch) {
		if (entry.type === "thinking_level_change") {
			thinkingLevel = entry.level;
			continue;
		}
		if (entry.type === "model_change") {
			model = entry.model;
			hasExplicitModel = true;
			continue;
		}
		const assistantModel = restoreModelFromMessage(entry);
		if (assistantModel) {
			fallbackModel = assistantModel;
		}
	}

	if (!hasExplicitModel) {
		model = fallbackModel;
	}

	const latestCompactionIndex = getLatestCompactionIndex(branch);
	const messages: AgentMessage[] = [];

	if (latestCompactionIndex >= 0) {
		const compaction = branch[latestCompactionIndex] as CompactionEntry;
		messages.push(
			createCompactionSummaryMessage(compaction.summary, {
				sourceEntryId: compaction.id,
				timestamp: Date.parse(compaction.timestamp) || Date.now(),
				...(compaction.details === undefined ? {} : { details: compaction.details }),
			}),
		);
		const keptStartIndex = branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId);
		const suffix = keptStartIndex >= 0 ? branch.slice(keptStartIndex) : branch.slice(latestCompactionIndex + 1);
		for (const entry of suffix) {
			if (entry.type === "compaction") {
				continue;
			}
			messages.push(...entryToMessages(entry));
		}
	} else {
		for (const entry of branch) {
			messages.push(...entryToMessages(entry));
		}
	}

	return {
		messages,
		thinkingLevel,
		model,
		leafId,
		branch,
	};
}

export function collectMessageEntries(entries: readonly SessionEntry[]): Array<BranchSummaryEntry | SessionEntry> {
	return entries.filter((entry) => {
		return (
			entry.type === "message" ||
			entry.type === "custom_message" ||
			entry.type === "branch_summary" ||
			entry.type === "compaction"
		);
		});
}
