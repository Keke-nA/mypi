import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const testDir = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(testDir, "../dist/cli/main.js");

async function createTempDir(prefix: string) {
	const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function runCli(args: string[], options: { cwd?: string; env?: Record<string, string | undefined> } = {}) {
	const result = spawnSync(process.execPath, [cliPath, ...args], {
		cwd: options.cwd ?? process.cwd(),
		env: { ...process.env, ...options.env },
		encoding: "utf8",
	});
	return {
		code: result.status ?? 1,
		stdout: result.stdout ?? "",
		stderr: result.stderr ?? "",
	};
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("cli flags", () => {
	it("shows resume flags and removes --new from help", async () => {
		const result = await runCli(["--help"]);
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("--resume");
		expect(result.stdout).toContain("--resume-latest");
		expect(result.stdout).not.toContain("--new");
	});

	it("defaults to startupMode new and continueRecent false", async () => {
		const homeDir = await createTempDir("mypi-home-");
		const cwd = await createTempDir("mypi-project-");
		await mkdir(path.join(cwd, ".mypi"), { recursive: true });
		const result = await runCli(["--print-config", "--cwd", cwd], {
			env: { HOME: homeDir },
		});
		expect(result.code).toBe(0);
		expect(result.stdout).toContain("continueRecent: false");
		expect(result.stdout).toContain("startupMode: new");
	});

	it("rejects combining --resume with --prompt", async () => {
		const result = await runCli(["--resume", "--prompt", "hello"]);
		expect(result.code).not.toBe(0);
		expect(result.stdout).toContain("--resume cannot be combined with --prompt");
	});

	it("rejects combining --resume-latest with --session-file", async () => {
		const result = await runCli(["--resume-latest", "--session-file", "/tmp/example.jsonl"]);
		expect(result.code).not.toBe(0);
		expect(result.stdout).toContain("--resume-latest cannot be combined with --session-file");
	});
});
