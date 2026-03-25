import { access, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCustomMessage } from "../src/core/messages.js";
import { SessionManager } from "../src/core/session-manager.js";

const tempDirs: string[] = [];

async function createTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), "mypi-session-manager-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

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

describe("SessionManager", () => {
	it("creates, appends, reopens, lists, and forks persisted sessions", async () => {
		const sessionDir = await createTempDir();
		const cwd = path.join(sessionDir, "project");
		const manager = await SessionManager.create({ cwd, sessionDir });

		await manager.appendSessionInfo({ name: "My Session" });
		await manager.appendThinkingLevelChange("low");
		await manager.appendModelChange({ provider: "openai", modelId: "gpt-4o-mini" });
		const userEntry = await manager.appendMessage({ role: "user", content: "hello", timestamp: Date.now() });
		const assistantEntry = await manager.appendMessage(createAssistantMessage("hi there"));
		await manager.appendCustomMessageEntry(createCustomMessage("remember this"));
		await manager.appendLabelChange(userEntry.id, "start");

		const filePath = manager.getSessionFile();
		expect(filePath).toBeTruthy();

		const reopened = await SessionManager.open(filePath!, { sessionDir });
		expect(reopened.getSessionName()).toBe("My Session");
		expect(reopened.getLabel(userEntry.id)).toBe("start");
		expect(reopened.getLeafId()).toBe(reopened.getEntries().at(-1)?.id ?? null);
		expect(reopened.getBranch().map((entry) => entry.id)).toContain(assistantEntry.id);

		const sessions = await SessionManager.list(cwd, sessionDir);
		expect(sessions).toHaveLength(1);
		expect(sessions[0]?.name).toBe("My Session");
		expect(sessions[0]?.messageCount).toBe(2);

		const allSessions = await SessionManager.listAll(sessionDir);
		expect(allSessions).toHaveLength(1);

		reopened.branch(userEntry.id);
		const altAssistant = await reopened.appendMessage(createAssistantMessage("branch answer"));
		expect(reopened.getChildren(userEntry.id).map((entry) => entry.id)).toEqual([assistantEntry.id, altAssistant.id]);

		const forked = await reopened.createBranchedSession({ fromId: altAssistant.id, cwd, sessionDir });
		expect(forked.getHeader().parentSession).toBe(reopened.getSessionId());
		const forkedBranchIds = forked.getBranch().map((entry) => entry.id);
		expect(forkedBranchIds.slice(-2)).toEqual([userEntry.id, altAssistant.id]);
		expect(forkedBranchIds).toContain(userEntry.id);
	});

	it("deletes persisted session files", async () => {
		const sessionDir = await createTempDir();
		const cwd = path.join(sessionDir, "project-delete");
		const manager = await SessionManager.create({ cwd, sessionDir });
		const filePath = manager.getSessionFile();
		expect(filePath).toBeTruthy();
		await SessionManager.deleteFile(filePath!, { sessionDir });
		await expect(access(filePath!)).rejects.toBeTruthy();
		expect(await SessionManager.list(cwd, sessionDir)).toHaveLength(0);
	});

	it("supports summary branching and reset leaf semantics", async () => {
		const manager = await SessionManager.inMemory("/virtual/project");
		const root = await manager.appendMessage({ role: "user", content: "root", timestamp: Date.now() });
		const branch = await manager.appendMessage(createAssistantMessage("branch one"));

		manager.resetLeaf();
		const detached = await manager.appendMessage({ role: "user", content: "new root", timestamp: Date.now() });
		expect(detached.parentId).toBeNull();

		manager.branch(root.id);
		const summary = await manager.branchWithSummary(root.id, "summary of other branch");
		expect(summary.fromId).toBe(root.id);
		expect(summary.parentId).toBe(root.id);
		expect(manager.getLeafId()).toBe(summary.id);
		expect(manager.getChildren(root.id).map((entry) => entry.id)).toEqual([branch.id, summary.id]);
	});
});
