import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isSilentResponseText } from "../src/agent.js";
import { applyMomWorkspaceSettings, loadMomWorkspaceSettings } from "../src/context.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mypi-mom-settings-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mom workspace settings", () => {
  it("loads workspace settings.json and merges it over base config", async () => {
    const workingDir = await createTempDir();
    await writeFile(
      path.join(workingDir, "settings.json"),
      JSON.stringify(
        {
          anthropic: {
            model: "kimi-k2.5",
            baseUrl: "https://api.kimi.com/coding/",
          },
          agent: {
            provider: "anthropic",
            thinkingLevel: "minimal",
            systemPromptAppend: "Prefer concise answers.",
            compaction: {
              enabled: true,
              thresholdPercent: 55,
              retryOnOverflow: true,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const loaded = await loadMomWorkspaceSettings(workingDir);
    expect(loaded).toEqual({
      provider: "anthropic",
      modelId: "kimi-k2.5",
      baseUrl: "https://api.kimi.com/coding/",
      thinkingLevel: "minimal",
      systemPromptAppend: "Prefer concise answers.",
      compaction: {
        enabled: true,
        thresholdPercent: 55,
        retryOnOverflow: true,
      },
    });

    const merged = applyMomWorkspaceSettings(
      {
        provider: "openai",
        modelId: "gpt-5.4",
        baseUrl: "https://base.example/v1",
        thinkingLevel: "off",
        systemPromptAppend: "Base instructions.",
        compaction: {
          enabled: false,
          thresholdPercent: 80,
          reserveTokens: 20_000,
          keepRecentTokens: 10_000,
          retryOnOverflow: false,
          showUsageInUi: true,
        },
      },
      loaded,
    );

    expect(merged.provider).toBe("anthropic");
    expect(merged.modelId).toBe("kimi-k2.5");
    expect(merged.baseUrl).toBe("https://api.kimi.com/coding/");
    expect(merged.thinkingLevel).toBe("minimal");
    expect(merged.systemPromptAppend).toBe("Prefer concise answers.");
    expect(merged.compaction).toEqual({
      enabled: true,
      thresholdPercent: 55,
      reserveTokens: 20_000,
      keepRecentTokens: 10_000,
      retryOnOverflow: true,
      showUsageInUi: true,
    });
  });

  it("ignores invalid settings.json", async () => {
    const workingDir = await createTempDir();
    await writeFile(path.join(workingDir, "settings.json"), "not-json", "utf8");
    await expect(loadMomWorkspaceSettings(workingDir)).resolves.toEqual({});
  });
});

describe("silent responses", () => {
  it("detects the [SILENT] completion marker", () => {
    expect(isSilentResponseText("[SILENT]")).toBe(true);
    expect(isSilentResponseText("  [SILENT]  ")).toBe(true);
    expect(isSilentResponseText("[SILENT]\nNo changes.")).toBe(true);
    expect(isSilentResponseText("No changes.")).toBe(false);
    expect(isSilentResponseText("silent")).toBe(false);
  });
});
