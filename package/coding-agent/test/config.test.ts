import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatLoadedConfig, getAgentDir, loadAgentConfig } from "../src/config/config.js";

const tempDirs: string[] = [];

async function createTempDir(prefix: string) {
	const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent config", () => {
	it("loads global and project config, with project overrides", async () => {
		const homeDir = await createTempDir("mypi-home-");
		const cwd = await createTempDir("mypi-project-");
		const agentDir = getAgentDir(homeDir);
		await mkdir(agentDir, { recursive: true });
		await mkdir(path.join(cwd, ".mypi"), { recursive: true });

		await writeFile(
			path.join(agentDir, "config.json"),
			JSON.stringify({
				openai: { apiKey: "global-key", baseUrl: "https://global.example/v1", model: "gpt-5-mini" },
				agent: { thinkingLevel: "low", tools: ["read", "bash"], continueRecent: false },
				preset: "implement",
			}),
		);
		await writeFile(
			path.join(cwd, ".mypi", "config.json"),
			JSON.stringify({
				openai: { model: "gpt-5.4" },
				agent: { tools: { read: true, edit: true }, systemPromptAppend: "project prompt" },
			}),
		);
		await writeFile(
			path.join(agentDir, "presets.json"),
			JSON.stringify({
				implement: { model: "gpt-4o-mini", thinkingLevel: "medium", instructions: "preset instructions" },
			}),
		);

		const loaded = await loadAgentConfig({ cwd, homeDir, env: {} });
		expect(loaded.settings.apiKey).toBe("global-key");
		expect(loaded.settings.baseUrl).toBe("https://global.example/v1");
		expect(loaded.settings.modelId).toBe("gpt-4o-mini");
		expect(loaded.settings.thinkingLevel).toBe("medium");
		expect(loaded.settings.continueRecent).toBe(false);
		expect(loaded.settings.activeTools).toEqual(["read", "edit"]);
		expect(loaded.settings.systemPromptAppend).toBe("project prompt\n\npreset instructions");
		expect(loaded.activePreset?.name).toBe("implement");
	});

	it("supports explicit config and env overrides", async () => {
		const homeDir = await createTempDir("mypi-home-");
		const cwd = await createTempDir("mypi-project-");
		const agentDir = getAgentDir(homeDir);
		const explicitPath = path.join(cwd, "extra-config.json");
		await mkdir(agentDir, { recursive: true });
		await writeFile(
			explicitPath,
			JSON.stringify({
				openai: { baseUrl: "https://explicit.example/v1", model: "gpt-5-mini" },
				agent: { uiMode: "plain", sessionDir: "./sessions-cache", tools: ["read", "write"] },
				preset: "fast",
			}),
		);
		await writeFile(
			path.join(agentDir, "presets.json"),
			JSON.stringify({
				fast: { model: "gpt-4o-mini", tools: ["read"], instructions: "fast mode" },
			}),
		);

		const loaded = await loadAgentConfig({
			cwd,
			homeDir,
			explicitConfigPath: explicitPath,
			env: {
				OPENAI_API_KEY: "env-key",
				OPENAI_MODEL: "gpt-5.4",
				MYPI_UI_MODE: "tui",
			},
		});

		expect(loaded.settings.apiKey).toBe("env-key");
		expect(loaded.settings.modelId).toBe("gpt-5.4");
		expect(loaded.settings.baseUrl).toBe("https://explicit.example/v1");
		expect(loaded.settings.uiMode).toBe("tui");
		expect(loaded.settings.activeTools).toEqual(["read"]);
		expect(loaded.settings.sessionDir).toBe(path.resolve(cwd, "sessions-cache"));
		expect(formatLoadedConfig(loaded)).toContain("activePreset: fast");
	});
});
