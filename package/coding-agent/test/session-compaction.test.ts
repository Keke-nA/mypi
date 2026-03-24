import { describe, expect, it } from "vitest";
import { buildSessionContext } from "../src/core/session-context.js";
import {
	compact,
	findCutPoint,
	prepareCompaction,
} from "../src/core/session-compaction.js";
import { SessionManager } from "../src/core/session-manager.js";

function createAssistantMessage(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "openai-responses" as const,
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

const long = (value: string) => value.repeat(120);

describe("session compaction", () => {
	it("finds a cut point on turn boundaries", async () => {
		const manager = await SessionManager.inMemory("/compact/project");
		await manager.appendMessage({ role: "user", content: long("a"), timestamp: Date.now() });
		await manager.appendMessage(createAssistantMessage(long("b")));
		await manager.appendMessage({ role: "user", content: long("c"), timestamp: Date.now() + 1 });
		await manager.appendMessage(createAssistantMessage(long("d")));
		await manager.appendMessage({ role: "user", content: long("e"), timestamp: Date.now() + 2 });
		await manager.appendMessage(createAssistantMessage(long("f")));

		const branch = manager.getBranch();
		const cutPoint = findCutPoint(branch, 90);
		expect(cutPoint).toBe(4);
		const prepared = prepareCompaction(branch, { keepRecentTokens: 90 });
		expect(prepared.firstKeptEntryId).toBe(branch[4]?.id);
	});

	it("produces rolling summaries and rebuilds latest checkpoint only", async () => {
		const manager = await SessionManager.inMemory("/compact/rolling");
		await manager.appendMessage({ role: "user", content: long("1"), timestamp: Date.now() });
		await manager.appendMessage(createAssistantMessage(long("2")));
		await manager.appendMessage({ role: "user", content: long("3"), timestamp: Date.now() + 1 });
		await manager.appendMessage(createAssistantMessage(long("4")));
		await manager.appendMessage({ role: "user", content: long("5"), timestamp: Date.now() + 2 });
		await manager.appendMessage(createAssistantMessage(long("6")));

		const summaries: Array<string | undefined> = [];
		await compact(manager, {
			settings: { keepRecentTokens: 90 },
			generateSummary: ({ previousSummary, messages }) => {
				summaries.push(previousSummary);
				return { summary: `S1:${messages.length}` };
			},
		});

		await manager.appendMessage({ role: "user", content: long("7"), timestamp: Date.now() + 3 });
		await manager.appendMessage(createAssistantMessage(long("8")));
		await manager.appendMessage({ role: "user", content: long("9"), timestamp: Date.now() + 4 });
		await manager.appendMessage(createAssistantMessage(long("10")));

		await compact(manager, {
			settings: { keepRecentTokens: 90 },
			generateSummary: ({ previousSummary, messages }) => {
				summaries.push(previousSummary);
				return { summary: `S2:${previousSummary}:${messages.length}` };
			},
		});

		expect(summaries).toEqual([undefined, "S1:4"]);
		const context = buildSessionContext(manager.getEntries(), { leafId: manager.getLeafId() });
		expect(context.messages[0]).toMatchObject({ role: "compaction_summary", summary: "S2:S1:4:2" });
		expect(context.messages.map((message) => message.role)).toEqual(["compaction_summary", "user", "assistant"]);
	});
});
