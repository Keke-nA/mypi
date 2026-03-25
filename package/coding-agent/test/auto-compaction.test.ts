import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	EventStream,
	getModel,
	type AssistantMessage,
	type AssistantMessageEvent,
	type Model,
} from "@mypi/ai";
import { Agent } from "@mypi/agent";
import { afterEach, describe, expect, it } from "vitest";
import { convertToLlm } from "../src/core/messages.js";
import { SessionRuntime } from "../src/core/session-runtime.js";

class MockAssistantStream extends EventStream<AssistantMessageEvent, AssistantMessage> {
	constructor() {
		super(
			(event) => event.type === "done" || event.type === "error",
			(event) => {
				if (event.type === "done") return event.message;
				if (event.type === "error") return event.error;
				throw new Error("Unexpected event type");
			},
		);
	}
}

const tempDirs: string[] = [];

async function createTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), "mypi-auto-compact-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createAssistantMessage(
	text: string,
	options: { totalTokens: number; stopReason?: "stop" | "error"; errorMessage?: string },
): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: "gpt-4o-mini",
		usage: {
			input: Math.max(0, options.totalTokens - 10),
			output: 10,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: options.totalTokens,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: options.stopReason ?? "stop",
		...(options.errorMessage === undefined ? {} : { errorMessage: options.errorMessage }),
		timestamp: Date.now(),
	};
}

function createQueuedAgent(responses: AssistantMessage[], model: Model<any>) {
	let index = 0;
	return new Agent({
		initialState: { model },
		convertToLlm,
		streamFn: async () => {
			const response = responses[index++];
			if (!response) {
				throw new Error("No queued response available");
			}
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				if (response.stopReason === "error") {
					stream.push({ type: "error", reason: "error", error: response });
				} else {
					stream.push({ type: "done", reason: response.stopReason, message: response });
				}
			});
			return stream;
		},
	});
}

describe("auto compaction", () => {
	it("runs threshold auto-compaction once context reaches 80%", async () => {
		const sessionDir = await createTempDir();
		const cwd = path.join(sessionDir, "project-threshold");
		const model = { ...getModel("openai", "gpt-4o-mini"), contextWindow: 100, maxTokens: 32 };
		const agent = createQueuedAgent(
			[
				createAssistantMessage("A".repeat(120), { totalTokens: 60 }),
				createAssistantMessage("ok", { totalTokens: 90 }),
			],
			model,
		);
		const runtime = await SessionRuntime.create({
			agent,
			cwd,
			sessionDir,
			resolveModel: async () => model,
			autoCompaction: {
				settings: { enabled: true, thresholdPercent: 80, keepRecentTokens: 10, reserveTokens: 16_384 },
				createSummaryGenerator: () => async () => ({ summary: "auto-threshold-summary" }),
			},
		});
		const events: string[] = [];
		runtime.subscribe((event) => {
			events.push(event.type === "auto_compaction_start" ? `start:${event.reason}` : `end:${event.reason}`);
		});

		await agent.prompt("x".repeat(120));
		await runtime.waitForSettled();
		await agent.prompt("follow-up");
		await runtime.waitForSettled();

		expect(events).toEqual(["start:threshold", "end:threshold"]);
		expect(runtime.getSessionManager().getEntries().some((entry) => entry.type === "compaction")).toBe(true);
		expect(agent.state.messages[0]).toMatchObject({ role: "compaction_summary", summary: "auto-threshold-summary" });
		expect(agent.state.messages.map((message) => message.role)).toEqual(["compaction_summary", "user", "assistant"]);
	});

	it("recovers from overflow by compacting and retrying once", async () => {
		const sessionDir = await createTempDir();
		const cwd = path.join(sessionDir, "project-overflow");
		const model = { ...getModel("openai", "gpt-4o-mini"), contextWindow: 100, maxTokens: 32 };
		const agent = createQueuedAgent(
			[
				createAssistantMessage("B".repeat(120), { totalTokens: 60 }),
				createAssistantMessage("", {
					totalTokens: 0,
					stopReason: "error",
					errorMessage: "model_context_window_exceeded",
				}),
				createAssistantMessage("retry-ok", { totalTokens: 70 }),
			],
			model,
		);
		const runtime = await SessionRuntime.create({
			agent,
			cwd,
			sessionDir,
			resolveModel: async () => model,
			autoCompaction: {
				settings: { enabled: true, thresholdPercent: 80, keepRecentTokens: 10, retryOnOverflow: true, reserveTokens: 16_384 },
				createSummaryGenerator: () => async () => ({ summary: "overflow-summary" }),
			},
		});
		const events: string[] = [];
		runtime.subscribe((event) => {
			if (event.type === "auto_compaction_start") {
				events.push(`start:${event.reason}`);
				return;
			}
			events.push(`end:${event.reason}:${event.willRetry ? "retry" : "noretry"}`);
		});

		await agent.prompt("y".repeat(120));
		await runtime.waitForSettled();
		await agent.prompt("retry this");
		await runtime.waitForSettled();

		expect(events).toEqual(["start:overflow", "end:overflow:retry"]);
		const entries = runtime.getSessionManager().getEntries();
		expect(entries.some((entry) => entry.type === "compaction")).toBe(true);
		expect(
			entries.some(
				(entry) =>
					entry.type === "message" &&
					entry.message.role === "assistant" &&
					entry.message.stopReason === "error",
			),
		).toBe(false);
		expect(agent.state.messages.map((message) => message.role)).toEqual(["compaction_summary", "user", "assistant"]);
		expect(agent.state.messages[2]).toMatchObject({ role: "assistant" });
	});
});
