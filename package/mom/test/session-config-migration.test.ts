import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager, type WorkspaceToolName } from "@mypi/coding-agent";
import { disposeRunner, getOrCreateRunner } from "../src/agent.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mypi-mom-runner-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mom runner config migration", () => {
  it("switches persisted model and thinking level for an existing channel context", async () => {
    const workingDir = await createTempDir();
    const channelId = "C_TEST";
    const channelDir = path.join(workingDir, channelId);
    const contextFile = path.join(channelDir, "context.jsonl");
    const activeTools: WorkspaceToolName[] = ["read", "write", "edit", "bash"];

    await mkdir(channelDir, { recursive: true });
    const manager = await SessionManager.create({
      cwd: channelDir,
      sessionDir: workingDir,
      filePath: contextFile,
    });
    await manager.appendModelChange({ provider: "openai", modelId: "gpt-5.4" });
    await manager.appendThinkingLevelChange("off");

    const runner = await getOrCreateRunner(
      channelId,
      {
        workingDir,
        sandbox: { type: "host" },
        provider: "anthropic",
        apiKey: "test-key",
        baseUrl: "https://api.kimi.com/coding/",
        modelId: "kimi-k2.5",
        thinkingLevel: "minimal",
        activeTools,
        compaction: {
          enabled: true,
          thresholdPercent: 80,
          reserveTokens: 20_000,
          keepRecentTokens: 12_000,
          retryOnOverflow: true,
          showUsageInUi: true,
        },
      },
      "anthropic-kimi-k2.5",
    );

    runner.dispose();
    await disposeRunner(channelId);

    const entries = (await readFile(contextFile, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; model?: { provider: string; modelId: string }; level?: string });

    const modelChanges = entries.filter((entry) => entry.type === "model_change");
    const thinkingChanges = entries.filter((entry) => entry.type === "thinking_level_change");

    expect(modelChanges.at(-1)?.model).toEqual({ provider: "anthropic", modelId: "kimi-k2.5" });
    expect(thinkingChanges.at(-1)?.level).toBe("minimal");
  });
});
