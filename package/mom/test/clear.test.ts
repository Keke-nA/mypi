import { access, mkdir, writeFile } from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearChannelConversationFiles, isClearCommandText } from "../src/clear.js";
import { ChannelStore } from "../src/store.js";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "mypi-mom-clear-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mom clear command", () => {
  it("detects the clear command exactly", () => {
    expect(isClearCommandText("clear")).toBe(true);
    expect(isClearCommandText("  CLEAR  ")).toBe(true);
    expect(isClearCommandText("clear now")).toBe(false);
    expect(isClearCommandText("please clear")).toBe(false);
  });

  it("removes log/context files and clears the cached log timestamps", async () => {
    const workingDir = await createTempDir();
    const channelId = "DTEST";
    const channelDir = path.join(workingDir, channelId);
    const logPath = path.join(channelDir, "log.jsonl");
    const contextPath = path.join(channelDir, "context.jsonl");

    await mkdir(channelDir, { recursive: true });
    await writeFile(
      logPath,
      `${JSON.stringify({
        date: new Date().toISOString(),
        ts: "123.456",
        user: "U123",
        text: "hello",
        attachments: [],
        isBot: false,
      })}\n`,
      "utf8",
    );
    await writeFile(contextPath, "not-important-for-clear\n", "utf8");

    const store = new ChannelStore({ workingDir, botToken: "test-token" });
    await expect(store.hasLoggedTimestamp(channelId, "123.456")).resolves.toBe(true);

    await expect(clearChannelConversationFiles(workingDir, channelId, store)).resolves.toEqual({
      removedLog: true,
      removedContext: true,
    });

    await expect(access(logPath)).rejects.toThrow();
    await expect(access(contextPath)).rejects.toThrow();
    await expect(store.hasLoggedTimestamp(channelId, "123.456")).resolves.toBe(false);
  });
});
