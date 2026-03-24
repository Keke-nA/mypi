import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkspaceTools } from "../src/tools/workspace-tools.js";

const tempDirs: string[] = [];

async function createTempDir() {
	const dir = await mkdtemp(path.join(os.tmpdir(), "mypi-workspace-tools-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("workspace tools", () => {
	it("reads, writes, edits, and runs bash in workspace", async () => {
		const workspace = await createTempDir();
		const [readTool, writeTool, editTool, bashTool] = createWorkspaceTools(workspace);

		await writeTool.execute("1", { path: "notes.txt", content: "hello\nworld" });
		const readResult = await readTool.execute("2", { path: "notes.txt" });
		expect(readResult.content[0]?.text).toContain("1| hello");
		expect(readResult.content[0]?.text).toContain("2| world");

		await editTool.execute("3", { path: "notes.txt", oldText: "world", newText: "mypi" });
		expect(await readFile(path.join(workspace, "notes.txt"), "utf8")).toBe("hello\nmypi");

		const bashResult = await bashTool.execute("4", { command: "pwd && ls" });
		expect(bashResult.content[0]?.text).toContain(workspace);
		expect(bashResult.content[0]?.text).toContain("notes.txt");
	});

	it("rejects file paths outside workspace for file tools", async () => {
		const workspace = await createTempDir();
		const [readTool] = createWorkspaceTools(workspace);
		await expect(readTool.execute("1", { path: "../outside.txt" })).rejects.toThrow(/outside workspace/);
	});
});
