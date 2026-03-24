import type { AgentMessage } from "@mypi/agent";
import { createCompactionSummaryMessage } from "./messages.js";
import { buildSessionContext, getBranchEntries, indexEntries } from "./session-context.js";
import type { BranchSummaryResult, SessionEntry } from "./session-types.js";

export interface BranchSummaryGeneratorInput {
	entries: SessionEntry[];
	messages: AgentMessage[];
	fromId: string | null;
	targetId: string | null;
	signal?: AbortSignal;
}

export type BranchSummaryGenerator = (
	input: BranchSummaryGeneratorInput,
) => Promise<BranchSummaryResult | string> | BranchSummaryResult | string;

export function collectEntriesForBranchSummary(
	entries: readonly SessionEntry[],
	fromId: string | null,
	targetId: string | null,
	byId: ReadonlyMap<string, SessionEntry> = indexEntries(entries),
): SessionEntry[] {
	if (!fromId || fromId === targetId) {
		return [];
	}

	const fromBranch = getBranchEntries(byId, fromId);
	const targetBranch = getBranchEntries(byId, targetId);
	let commonIndex = -1;
	const length = Math.min(fromBranch.length, targetBranch.length);
	for (let index = 0; index < length; index++) {
		if (fromBranch[index]?.id !== targetBranch[index]?.id) {
			break;
		}
		commonIndex = index;
	}
	return fromBranch.slice(commonIndex + 1);
}

export function prepareBranchEntries(entries: readonly SessionEntry[]): AgentMessage[] {
	const messages: AgentMessage[] = [];
	for (const entry of entries) {
		switch (entry.type) {
			case "message":
				messages.push(entry.message);
				break;
			case "custom_message":
				messages.push(entry.message);
				break;
			case "branch_summary":
			case "custom":
			case "label":
			case "session_info":
			case "model_change":
			case "thinking_level_change":
				break;
			case "compaction":
				messages.push(
					createCompactionSummaryMessage(entry.summary, {
						sourceEntryId: entry.id,
						timestamp: Date.parse(entry.timestamp) || Date.now(),
						...(entry.details === undefined ? {} : { details: entry.details }),
					}),
				);
				break;
		}
	}
	return messages;
}

export async function generateBranchSummary(input: {
	entries: readonly SessionEntry[];
	fromId: string | null;
	targetId: string | null;
	generate: BranchSummaryGenerator;
	signal?: AbortSignal;
}): Promise<BranchSummaryResult | null> {
	const branchEntries = collectEntriesForBranchSummary(input.entries, input.fromId, input.targetId);
	if (branchEntries.length === 0) {
		return null;
	}
	const messages = prepareBranchEntries(branchEntries);
	const result = await input.generate({
		entries: branchEntries,
		messages,
		fromId: input.fromId,
		targetId: input.targetId,
		...(input.signal === undefined ? {} : { signal: input.signal }),
	});
	return typeof result === "string" ? { summary: result } : result;
}

export function buildTargetBranchContext(entries: readonly SessionEntry[], targetId: string | null) {
	return buildSessionContext(entries, { leafId: targetId });
}
