import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ImageContent, UserMessage } from "@mypi/ai";
import {
  resolveAutoCompactionSettings,
  type AutoCompactionSettings,
  type ResolvedAutoCompactionSettings,
  type SessionEntry,
  type SessionManager,
  type SessionThinkingLevel,
} from "@mypi/coding-agent";
import { logWarning } from "./log.js";
import type { Attachment } from "./store.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

interface LogMessage {
  date?: string;
  ts?: string;
  user?: string;
  userName?: string;
  text?: string;
  attachments?: Attachment[];
  isBot?: boolean;
}

export interface MomWorkspaceSettingsFile {
  openai?: {
    model?: string;
    baseUrl?: string;
  };
  anthropic?: {
    model?: string;
    baseUrl?: string;
  };
  agent?: {
    provider?: string;
    thinkingLevel?: SessionThinkingLevel;
    systemPromptAppend?: string;
    compaction?: AutoCompactionSettings;
  };
}

export interface MomWorkspaceSettings {
  provider?: string;
  modelId?: string;
  baseUrl?: string;
  thinkingLevel?: SessionThinkingLevel;
  systemPromptAppend?: string;
  compaction?: AutoCompactionSettings;
}

export interface MomRuntimeSettingsTarget {
  provider: string;
  modelId: string;
  baseUrl?: string;
  thinkingLevel: SessionThinkingLevel;
  systemPromptAppend?: string;
  compaction: ResolvedAutoCompactionSettings;
}

function extractUserText(entry: SessionEntry): string | null {
  if (entry.type !== "message") {
    return null;
  }
  if (entry.message.role !== "user") {
    return null;
  }
  if (typeof entry.message.content === "string") {
    return entry.message.content;
  }
  return entry.message.content
    .filter((part): part is Extract<(typeof entry.message.content)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function getImageMimeType(attachment: Attachment): string | null {
  if (attachment.mimeType?.startsWith("image/")) {
    return attachment.mimeType;
  }

  const candidates = [attachment.original, attachment.local];
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    for (const [extension, mimeType] of Object.entries(IMAGE_MIME_TYPES)) {
      if (lower.endsWith(extension)) {
        return mimeType;
      }
    }
  }

  return null;
}

function buildUserText(message: LogMessage): string {
  let text = `[${message.userName || message.user || "unknown"}]: ${message.text || ""}`;
  const attachments = message.attachments ?? [];
  if (attachments.length > 0) {
    text += `\n\n<slack_attachments>\n${attachments.map((attachment) => attachment.local).join("\n")}\n</slack_attachments>`;
  }
  return text.trim();
}

async function createImageContents(workingDir: string, attachments: Attachment[]): Promise<ImageContent[]> {
  const images: ImageContent[] = [];

  for (const attachment of attachments) {
    const mimeType = getImageMimeType(attachment);
    if (!mimeType) {
      continue;
    }

    try {
      const buffer = await readFile(path.join(workingDir, attachment.local));
      images.push({
        type: "image",
        data: buffer.toString("base64"),
        mimeType,
      });
    } catch {
      // Ignore missing attachments here; the text path still remains.
    }
  }

  return images;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionThinkingLevel(value: unknown): value is SessionThinkingLevel {
  return value === "off" || value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh";
}

function sanitizeCompactionSettings(value: unknown): AutoCompactionSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const next: AutoCompactionSettings = {};

  if (typeof value.enabled === "boolean") {
    next.enabled = value.enabled;
  }
  if (typeof value.thresholdPercent === "number" && Number.isFinite(value.thresholdPercent)) {
    next.thresholdPercent = value.thresholdPercent;
  }
  if (typeof value.reserveTokens === "number" && Number.isFinite(value.reserveTokens)) {
    next.reserveTokens = value.reserveTokens;
  }
  if (typeof value.keepRecentTokens === "number" && Number.isFinite(value.keepRecentTokens)) {
    next.keepRecentTokens = value.keepRecentTokens;
  }
  if (typeof value.retryOnOverflow === "boolean") {
    next.retryOnOverflow = value.retryOnOverflow;
  }
  if (typeof value.showUsageInUi === "boolean") {
    next.showUsageInUi = value.showUsageInUi;
  }

  return Object.keys(next).length > 0 ? next : undefined;
}

async function createUserMessage(workingDir: string, message: LogMessage): Promise<UserMessage | null> {
  if (!message.date || !message.ts) {
    return null;
  }

  const attachments = message.attachments ?? [];
  const text = buildUserText(message);
  const images = await createImageContents(workingDir, attachments);
  const timestamp = Date.parse(message.date) || Date.now();

  return {
    role: "user",
    content: [{ type: "text", text }, ...images],
    timestamp,
  };
}

export function getMomSettingsPath(workingDir: string): string {
  return path.join(workingDir, "settings.json");
}

export async function loadMomWorkspaceSettings(workingDir: string): Promise<MomWorkspaceSettings> {
  let content: string;
  try {
    content = await readFile(getMomSettingsPath(workingDir), "utf8");
  } catch {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    logWarning("Ignoring invalid workspace settings.json", getMomSettingsPath(workingDir));
    return {};
  }

  if (!isRecord(parsed)) {
    logWarning("Ignoring non-object workspace settings.json", getMomSettingsPath(workingDir));
    return {};
  }

  const openai = isRecord(parsed.openai) ? parsed.openai : undefined;
  const anthropic = isRecord(parsed.anthropic) ? parsed.anthropic : undefined;
  const agent = isRecord(parsed.agent) ? parsed.agent : undefined;
  const compaction = sanitizeCompactionSettings(agent?.compaction);
  const provider = typeof agent?.provider === "string" ? agent.provider.trim() : "";
  const activeProvider = provider === "anthropic" ? "anthropic" : provider === "openai" ? "openai" : anthropic && !openai ? "anthropic" : "openai";
  const providerSettings = activeProvider === "anthropic" ? anthropic : openai;

  return {
    ...(provider.length > 0 ? { provider: activeProvider } : anthropic && !openai ? { provider: "anthropic" as const } : {}),
    ...(typeof providerSettings?.model === "string" && providerSettings.model.trim().length > 0 ? { modelId: providerSettings.model.trim() } : {}),
    ...(typeof providerSettings?.baseUrl === "string" && providerSettings.baseUrl.trim().length > 0 ? { baseUrl: providerSettings.baseUrl.trim() } : {}),
    ...(isSessionThinkingLevel(agent?.thinkingLevel) ? { thinkingLevel: agent.thinkingLevel } : {}),
    ...(typeof agent?.systemPromptAppend === "string" ? { systemPromptAppend: agent.systemPromptAppend } : {}),
    ...(compaction ? { compaction } : {}),
  };
}

export function applyMomWorkspaceSettings<T extends MomRuntimeSettingsTarget>(
  base: T,
  settings: MomWorkspaceSettings,
): T {
  const mergedCompaction = settings.compaction
    ? resolveAutoCompactionSettings({
        ...base.compaction,
        ...settings.compaction,
      })
    : base.compaction;

  return {
    ...base,
    ...(settings.provider === undefined ? {} : { provider: settings.provider }),
    ...(settings.modelId === undefined ? {} : { modelId: settings.modelId }),
    ...(settings.baseUrl === undefined ? {} : { baseUrl: settings.baseUrl }),
    ...(settings.thinkingLevel === undefined ? {} : { thinkingLevel: settings.thinkingLevel }),
    ...(settings.systemPromptAppend === undefined ? {} : { systemPromptAppend: settings.systemPromptAppend }),
    compaction: mergedCompaction,
  };
}

export async function syncLogToSessionManager(
  sessionManager: SessionManager,
  channelDir: string,
  excludeSlackTs?: string,
): Promise<number> {
  const logPath = path.join(channelDir, "log.jsonl");
  let content: string;
  try {
    content = await readFile(logPath, "utf8");
  } catch {
    return 0;
  }

  const existingMessages = new Set<string>();
  for (const entry of sessionManager.getEntries()) {
    const text = extractUserText(entry);
    if (text) {
      existingMessages.add(text);
    }
  }

  const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const pending: UserMessage[] = [];
  const workingDir = path.dirname(channelDir);

  for (const line of lines) {
    let message: LogMessage;
    try {
      message = JSON.parse(line) as LogMessage;
    } catch {
      continue;
    }

    if (message.isBot) {
      continue;
    }
    if (!message.ts || !message.date) {
      continue;
    }
    if (excludeSlackTs && message.ts === excludeSlackTs) {
      continue;
    }

    const text = buildUserText(message);
    if (existingMessages.has(text)) {
      continue;
    }

    const userMessage = await createUserMessage(workingDir, message);
    if (!userMessage) {
      continue;
    }

    pending.push(userMessage);
    existingMessages.add(text);
  }

  for (const message of pending) {
    await sessionManager.appendMessage(message);
  }

  return pending.length;
}
