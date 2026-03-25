import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	EventStream,
	getModel,
	type AssistantMessage,
	type AssistantMessageEvent,
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
	const dir = await mkdtemp(path.join(os.tmpdir(), "mypi-session-runtime-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createAssistantMessage(text: string, modelId = "gpt-4o-mini"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		api: "openai-responses",
		provider: "openai",
		model: modelId,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function createAgent() {
	return new Agent({
		convertToLlm,
		streamFn: (_model, _context, _options) => {
			const stream = new MockAssistantStream();
			queueMicrotask(() => {
				stream.push({ type: "done", reason: "stop", message: createAssistantMessage("ok") });
			});
			return stream;
		},
	});
}

describe("SessionRuntime", () => {
	it("persists agent events and restores session state on reopen", async () => {
		const sessionDir = await createTempDir();
		const cwd = path.join(sessionDir, "project");
		const agent = createAgent();
		const runtime = await SessionRuntime.create({ agent, cwd, sessionDir });

		await agent.prompt("hello runtime");
		await runtime.waitForSettled();
		await runtime.setThinkingLevel("low");
		await runtime.setModel(getModel("openai", "gpt-5-mini"));

		const filePath = runtime.getSessionManager().getSessionFile();
		expect(filePath).toBeTruthy();
		expect(runtime.getSessionManager().getEntries().map((entry) => entry.type)).toEqual([
			"model_change",
			"thinking_level_change",
			"message",
			"message",
			"thinking_level_change",
			"model_change",
		]);

		const resumedAgent = createAgent();
		const resumed = await SessionRuntime.create({ agent: resumedAgent, sessionFile: filePath!, sessionDir });
		expect(resumedAgent.state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
		expect(resumedAgent.state.thinkingLevel).toBe("low");
		expect(resumedAgent.state.model.id).toBe("gpt-5-mini");
	});

	it("deletes sessions and falls back to the remaining recent session", async () => {
		const sessionDir = await createTempDir();
		const cwd = path.join(sessionDir, "project-delete");
		const agent = createAgent();
		const runtime = await SessionRuntime.create({ agent, cwd, sessionDir });

		await agent.prompt("first session");
		await runtime.waitForSettled();
		const firstFile = runtime.getSessionManager().getSessionFile();
		expect(firstFile).toBeTruthy();

		await runtime.newSession({ cwd });
		await agent.prompt("second session");
		await runtime.waitForSettled();
		const secondFile = runtime.getSessionManager().getSessionFile();
		expect(secondFile).toBeTruthy();
		expect(secondFile).not.toBe(firstFile);

		const deletedOther = await runtime.deleteSession(firstFile!);
		expect(deletedOther.currentDeleted).toBe(false);
		expect(runtime.getSessionManager().getSessionFile()).toBe(secondFile);

		const deletedCurrent = await runtime.deleteSession();
		expect(deletedCurrent.currentDeleted).toBe(true);
		expect(runtime.getSessionManager().getSessionFile()).not.toBe(secondFile);
		expect(runtime.getSessionManager().getEntries().some((entry) => entry.type === "message")).toBe(false);
		const sessions = await runtime.listSessions();
		expect(sessions).toHaveLength(1);
	});

	it("navigates trees, forks sessions, and compacts runtime context", async () => {
		const sessionDir = await createTempDir();
		const cwd = path.join(sessionDir, "project");
		const agent = createAgent();
		const runtime = await SessionRuntime.create({ agent, cwd, sessionDir });

		await agent.prompt("first");
		await runtime.waitForSettled();
		const [modelChange, thinkingChange, userEntry] = runtime.getSessionManager().getEntries();
		expect(modelChange?.type).toBe("model_change");
		expect(thinkingChange?.type).toBe("thinking_level_change");
		expect(userEntry?.type).toBe("message");

		const navigated = await runtime.navigateTree(userEntry?.id ?? null);
		expect(navigated.editorText).toBe("first");
		expect(agent.state.messages).toHaveLength(0);

		await agent.prompt("second branch");
		await runtime.waitForSettled();
		const forked = await runtime.fork({ fromId: userEntry?.id ?? null, cwd, sessionDir });
		expect(forked.editorText).toBe("first");
		expect(forked.session.getHeader().parentSession).toBeTruthy();
		expect(forked.session.getLeafId()).toBe(thinkingChange?.id ?? null);
		expect(agent.state.messages).toHaveLength(0);

		await agent.prompt("fork continuation");
		await runtime.waitForSettled();
		await runtime.compact({
			settings: { keepRecentTokens: 50 },
			generateSummary: ({ previousSummary, messages }) => ({
				summary: `compact:${previousSummary ?? "none"}:${messages.length}`,
			}),
		});
		expect(agent.state.messages[0]).toMatchObject({ role: "compaction_summary" });
	});
});
