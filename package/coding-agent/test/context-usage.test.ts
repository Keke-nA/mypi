import { describe, expect, it } from "vitest";
import { getModel, type AssistantMessage } from "@mypi/ai";
import {
	estimateContextTokens,
	getContextUsageSnapshot,
	isContextOverflowError,
	resolveAutoCompactionSettings,
	shouldAutoCompact,
} from "../src/core/context-usage.js";
import { compact } from "../src/core/session-compaction.js";
import { SessionManager } from "../src/core/session-manager.js";

function createAssistantMessage(text: string, totalTokens: number): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: totalTokens - 10,
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

const model = getModel("openai", "gpt-4o-mini");

describe("context usage", () => {
	it("uses last assistant usage plus trailing estimate", async () => {
		const manager = await SessionManager.inMemory("/usage/project");
		await manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		await manager.appendMessage(createAssistantMessage("world", 100));
		await manager.appendMessage({ role: "user", content: "x".repeat(40), timestamp: Date.now() + 1 });

		const usage = getContextUsageSnapshot({
			entries: manager.getEntries(),
			leafId: manager.getLeafId(),
			model,
		});

		expect(usage).toMatchObject({ tokens: 110, source: "usage+estimate", contextWindow: model.contextWindow });
		expect(usage?.percent).toBeCloseTo((110 / model.contextWindow) * 100, 6);
	});

	it("falls back to estimate-only when no assistant usage exists", () => {
		const estimate = estimateContextTokens([
			{ role: "user", content: "abcd".repeat(5), timestamp: Date.now() },
		]);
		expect(estimate.tokens).toBe(5);
		expect(estimate.lastUsageIndex).toBeNull();
		const settings = resolveAutoCompactionSettings({ thresholdPercent: 80, reserveTokens: 16 });
		expect(
			shouldAutoCompact(
				{ tokens: 90, contextWindow: 100, percent: 90, source: "estimate-only" },
				settings,
			),
		).toBe(true);
	});

	it("reports unknown after compaction until a new assistant usage exists", async () => {
		const manager = await SessionManager.inMemory("/usage/compacted");
		await manager.appendMessage({ role: "user", content: "a".repeat(240), timestamp: Date.now() });
		await manager.appendMessage(createAssistantMessage("b".repeat(240), 140));
		await manager.appendMessage({ role: "user", content: "c".repeat(24), timestamp: Date.now() + 1 });
		await manager.appendMessage(createAssistantMessage("d".repeat(24), 150));
		await compact(manager, {
			settings: { keepRecentTokens: 20 },
			generateSummary: () => ({ summary: "summary-1" }),
		});

		const usage = getContextUsageSnapshot({
			entries: manager.getEntries(),
			leafId: manager.getLeafId(),
			model,
		});

		expect(usage).toEqual({
			tokens: null,
			contextWindow: model.contextWindow,
			percent: null,
			source: "unknown",
		});
	});

	it("recognizes common overflow errors", () => {
		expect(isContextOverflowError("model_context_window_exceeded")).toBe(true);
		expect(isContextOverflowError("Maximum context length exceeded for this model")).toBe(true);
		expect(isContextOverflowError("Too many tokens in request")).toBe(true);
		expect(isContextOverflowError("429 rate limit exceeded")).toBe(false);
	});
});
