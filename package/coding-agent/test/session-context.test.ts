import { describe, expect, it } from "vitest";
import { createCustomMessage } from "../src/core/messages.js";
import { buildSessionContext } from "../src/core/session-context.js";
import { SessionManager } from "../src/core/session-manager.js";

function createAssistantMessage(text: string, model = "gpt-4o-mini") {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "openai-responses" as const,
		provider: "openai",
		model,
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

describe("buildSessionContext", () => {
	it("restores messages, model, thinking, and custom context entries", async () => {
		const manager = await SessionManager.inMemory("/ctx/project");
		await manager.appendThinkingLevelChange("medium");
		await manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		await manager.appendMessage(createAssistantMessage("hi", "gpt-5-mini"));
		await manager.appendCustomMessageEntry(createCustomMessage("injected context"));

		const context = buildSessionContext(manager.getEntries(), { leafId: manager.getLeafId() });
		expect(context.thinkingLevel).toBe("medium");
		expect(context.model).toEqual({ provider: "openai", modelId: "gpt-5-mini" });
		expect(context.messages.map((message) => message.role)).toEqual(["user", "assistant", "custom_message"]);
	});

	it("keeps sibling branches isolated", async () => {
		const manager = await SessionManager.inMemory("/ctx/branches");
		const user = await manager.appendMessage({ role: "user", content: "choose", timestamp: Date.now() });
		const left = await manager.appendMessage(createAssistantMessage("left"));
		manager.branch(user.id);
		const right = await manager.appendMessage(createAssistantMessage("right"));

		const leftContext = buildSessionContext(manager.getEntries(), { leafId: left.id });
		const rightContext = buildSessionContext(manager.getEntries(), { leafId: right.id });
		expect(leftContext.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "left" }] });
		expect(rightContext.messages.at(-1)).toMatchObject({ role: "assistant", content: [{ type: "text", text: "right" }] });
	});

	it("uses latest compaction only and preserves kept suffix", async () => {
		const manager = await SessionManager.inMemory("/ctx/compact");
		const user1 = await manager.appendMessage({ role: "user", content: "u1", timestamp: Date.now() });
		await manager.appendMessage(createAssistantMessage("a1"));
		const user2 = await manager.appendMessage({ role: "user", content: "u2", timestamp: Date.now() + 1 });
		await manager.appendMessage(createAssistantMessage("a2"));
		const compact1 = await manager.appendCompaction({
			summary: "summary-1",
			firstKeptEntryId: user2.id,
			tokensBefore: 100,
		});
		const user3 = await manager.appendMessage({ role: "user", content: "u3", timestamp: Date.now() + 2 });
		await manager.appendMessage(createAssistantMessage("a3"));
		await manager.appendCompaction({
			summary: "summary-2",
			firstKeptEntryId: user3.id,
			tokensBefore: 60,
		});

		const context = buildSessionContext(manager.getEntries(), { leafId: manager.getLeafId() });
		expect(context.messages.map((message) => message.role)).toEqual(["compaction_summary", "user", "assistant"]);
		expect(context.messages[0]).toMatchObject({ role: "compaction_summary", summary: "summary-2" });
		expect(context.messages.some((message) => message.role === "compaction_summary" && (message as any).summary === compact1.summary)).toBe(false);
		expect(user1.id).toBeTruthy();
	});

	it("includes branch summaries in rebuilt context", async () => {
		const manager = await SessionManager.inMemory("/ctx/tree");
		const root = await manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
		await manager.appendMessage(createAssistantMessage("branch a"));
		manager.branch(root.id);
		await manager.branchWithSummary(root.id, "branch a summary");

		const context = buildSessionContext(manager.getEntries(), { leafId: manager.getLeafId() });
		expect(context.messages.map((message) => message.role)).toEqual(["user", "branch_summary"]);
		expect(context.messages[1]).toMatchObject({ role: "branch_summary", summary: "branch a summary" });
	});
});
