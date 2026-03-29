import { access, rm } from "node:fs/promises";
import path from "node:path";
import type { ChannelStore } from "./store.js";

export interface ClearChannelConversationResult {
  removedLog: boolean;
  removedContext: boolean;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function isClearCommandText(text: string): boolean {
  return text.trim().toLowerCase() === "clear";
}

export async function clearChannelConversationFiles(
  workingDir: string,
  channelId: string,
  store: ChannelStore,
): Promise<ClearChannelConversationResult> {
  const channelDir = path.join(workingDir, channelId);
  const logPath = path.join(channelDir, "log.jsonl");
  const contextPath = path.join(channelDir, "context.jsonl");

  const [removedLog, removedContext] = await Promise.all([
    pathExists(logPath),
    pathExists(contextPath),
  ]);

  await Promise.all([
    rm(logPath, { force: true }),
    rm(contextPath, { force: true }),
  ]);

  store.clearChannelLogCache(channelId);

  return {
    removedLog,
    removedContext,
  };
}
