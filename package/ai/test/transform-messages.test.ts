import { describe, expect, it } from "vitest";
import { getModel } from "../src/models.js";
import { transformMessages } from "../src/providers/transform-messages.js";
import type { AssistantMessage, Message } from "../src/types.js";

function createUsage() {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

function createInterruptedAssistant(content: AssistantMessage["content"]): AssistantMessage {
	return {
		role: "assistant",
		content,
		api: "anthropic-messages",
		provider: "anthropic",
		model: "kimi-k2.5",
		usage: createUsage(),
		stopReason: "error",
		errorMessage: "401 invalidated oauth token",
		timestamp: Date.now(),
	};
}

describe("transformMessages", () => {
	it("replays interrupted assistant output as text-only assistant context", () => {
		const model = getModel("anthropic", "kimi-k2.5");
		const messages: Message[] = [
			{
				role: "user",
				content: "Explain the plan",
				timestamp: 1,
			},
			createInterruptedAssistant([
				{ type: "thinking", thinking: "hidden chain", thinkingSignature: "sig_1" },
				{ type: "text", text: "Step 1: inspect the repo." },
				{ type: "toolCall", id: "call_1", name: "read", arguments: { path: "README.md" } },
				{ type: "text", text: "Step 2: compare the files." },
			]),
			{
				role: "user",
				content: "继续",
				timestamp: 2,
			},
		];

		const transformed = transformMessages(messages, model);
		expect(transformed).toHaveLength(3);
		expect(transformed[1]).toMatchObject({
			role: "assistant",
			stopReason: "stop",
			content: [
				{ type: "text", text: "Step 1: inspect the repo." },
				{ type: "text", text: "Step 2: compare the files." },
			],
		});
		expect((transformed[1] as AssistantMessage).errorMessage).toBeUndefined();
		expect((transformed[1] as AssistantMessage).content.every((block) => block.type === "text")).toBe(true);
	});

	it("drops interrupted assistant messages that never produced user-visible text", () => {
		const model = getModel("anthropic", "kimi-k2.5");
		const messages: Message[] = [
			{
				role: "user",
				content: "Use a tool",
				timestamp: 1,
			},
			createInterruptedAssistant([
				{ type: "thinking", thinking: "considering...", thinkingSignature: "sig_1" },
				{ type: "toolCall", id: "call_1", name: "bash", arguments: { command: "pwd" } },
			]),
			{
				role: "user",
				content: "继续",
				timestamp: 2,
			},
		];

		const transformed = transformMessages(messages, model);
		expect(transformed.map((message) => message.role)).toEqual(["user", "user"]);
	});
});
