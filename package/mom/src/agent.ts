import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Agent, type AgentMessage } from "@mypi/agent";
import type { AssistantMessage, ImageContent, Model } from "@mypi/ai";
import {
  AgentSession,
  createCodingSystemPrompt,
  createCompactionSummaryGenerator,
  resolveModel,
  resolvePersistedModel,
  SessionManager,
  type ContextUsageSnapshot,
  type SessionThinkingLevel,
  type WorkspaceToolName,
} from "@mypi/coding-agent";
import { syncLogToSessionManager } from "./context.js";
import { logInfo, logWarning } from "./log.js";
import { formatSkillsForPrompt, loadMomSkills, type LoadedSkill } from "./skills.js";
import { createExecutor, type SandboxConfig } from "./sandbox.js";
import type { Attachment, ResolvedAttachment } from "./store.js";
import { createMomTools } from "./tools/index.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

export interface MomAgentConfig {
  workingDir: string;
  sandbox: SandboxConfig;
  provider: string;
  apiKey: string;
  baseUrl?: string;
  modelId: string;
  thinkingLevel: SessionThinkingLevel;
  activeTools: WorkspaceToolName[];
  systemPromptAppend?: string;
  compaction: {
    enabled: boolean;
    thresholdPercent: number;
    reserveTokens: number;
    keepRecentTokens: number;
    retryOnOverflow: boolean;
    showUsageInUi: boolean;
  };
}

export interface RunnerContext {
  message: {
    text: string;
    user: string;
    userName?: string;
    channel: string;
    ts: string;
    attachments: Attachment[];
  };
  setTyping(isTyping: boolean): Promise<void>;
  replaceMessage(text: string, shouldLog?: boolean): Promise<void>;
  deleteMessage(): Promise<void>;
  postThreadMessage(text: string): Promise<void>;
  deleteThreadMessages(): Promise<void>;
  uploadFile(filePath: string, title?: string): Promise<void>;
  resolveAttachments(): Promise<ResolvedAttachment[]>;
}

export interface AgentRunner {
  run(ctx: RunnerContext): Promise<{ stopReason: string; errorMessage?: string }>;
  followUp(ctx: RunnerContext): Promise<boolean>;
  abort(): void;
  dispose(): void;
}

const runners = new Map<string, { configKey: string; promise: Promise<AgentRunner> }>();

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readOptionalFile(filePath: string): Promise<string | null> {
  try {
    return (await readFile(filePath, "utf8")).trim();
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSessionHeaderLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.type === "session" &&
    typeof value.version === "number" &&
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    typeof value.cwd === "string"
  );
}

function extractEmbeddedJsonObjects(text: string): string[] {
  const objects: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (!char) {
      continue;
    }

    if (start < 0) {
      if (char === "{") {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        objects.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function createBackupPath(filePath: string, suffix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${filePath}.${suffix}.${stamp}.bak`;
}

async function isValidContextFile(filePath: string, workspaceDir: string): Promise<boolean> {
  try {
    await SessionManager.open(filePath, { sessionDir: workspaceDir });
    return true;
  } catch {
    return false;
  }
}

async function repairPrettyPrintedContextFile(filePath: string): Promise<{ repaired: boolean; backupPath?: string }> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch {
    return { repaired: false };
  }

  const objects = extractEmbeddedJsonObjects(content);
  if (objects.length === 0) {
    return { repaired: false };
  }

  const parsedValues: Record<string, unknown>[] = [];
  for (const objectText of objects) {
    try {
      const parsed = JSON.parse(objectText) as unknown;
      if (isRecord(parsed) && typeof parsed.type === "string") {
        parsedValues.push(parsed);
      }
    } catch {
      // Ignore malformed fragments.
    }
  }

  if (parsedValues.length === 0 || !isSessionHeaderLike(parsedValues[0])) {
    return { repaired: false };
  }

  const rewritten = `${parsedValues.map((value) => JSON.stringify(value)).join("\n")}\n`;
  const backupPath = createBackupPath(filePath, "pretty-json");
  await copyFile(filePath, backupPath);
  await writeFile(filePath, rewritten, "utf8");
  return { repaired: true, backupPath };
}

async function recreateContextFile(
  workspaceDir: string,
  channelDir: string,
  contextFile: string,
  model: Model<any>,
  thinkingLevel: SessionThinkingLevel,
): Promise<string | undefined> {
  let backupPath: string | undefined;
  if (await fileExists(contextFile)) {
    backupPath = createBackupPath(contextFile, "invalid");
    await copyFile(contextFile, backupPath);
  }

  const manager = await SessionManager.create({
    cwd: channelDir,
    sessionDir: workspaceDir,
    filePath: contextFile,
  });
  await manager.appendModelChange({ provider: model.provider, modelId: model.id });
  await manager.appendThinkingLevelChange(thinkingLevel);
  return backupPath;
}

async function ensureContextFile(
  workspaceDir: string,
  channelDir: string,
  contextFile: string,
  model: Model<any>,
  thinkingLevel: SessionThinkingLevel,
): Promise<void> {
  await mkdir(channelDir, { recursive: true });

  if (!(await fileExists(contextFile))) {
    await recreateContextFile(workspaceDir, channelDir, contextFile, model, thinkingLevel);
    return;
  }

  if (await isValidContextFile(contextFile, workspaceDir)) {
    return;
  }

  const repaired = await repairPrettyPrintedContextFile(contextFile);
  if (repaired.repaired) {
    logInfo("Repaired pretty-printed context file", repaired.backupPath ? `${contextFile} (backup: ${repaired.backupPath})` : contextFile);
    if (await isValidContextFile(contextFile, workspaceDir)) {
      return;
    }
  }

  const backupPath = await recreateContextFile(workspaceDir, channelDir, contextFile, model, thinkingLevel);
  logWarning(
    "Recreated invalid context file",
    backupPath ? `${contextFile} (backup: ${backupPath})` : contextFile,
  );
}

async function loadMemory(workspaceDir: string, channelDir: string): Promise<string> {
  const parts: string[] = [];
  const workspaceMemory = await readOptionalFile(path.join(workspaceDir, "MEMORY.md"));
  if (workspaceMemory) {
    parts.push(`## Workspace Memory\n${workspaceMemory}`);
  }
  const channelMemory = await readOptionalFile(path.join(channelDir, "MEMORY.md"));
  if (channelMemory) {
    parts.push(`## Channel Memory\n${channelMemory}`);
  }
  return parts.join("\n\n");
}

export function isSilentResponseText(text: string): boolean {
  const trimmed = text.trim();
  return trimmed === "[SILENT]" || trimmed.startsWith("[SILENT]");
}

function buildSystemPrompt(
  workspacePath: string,
  hostWorkspacePath: string,
  channelId: string,
  memory: string,
  sandbox: SandboxConfig,
  skills: LoadedSkill[],
  systemPromptAppend?: string,
): string {
  const base = createCodingSystemPrompt(workspacePath);
  const channelPath = path.posix.join(workspacePath, channelId);
  const workspaceSkillsPath = path.posix.join(workspacePath, "skills");
  const channelSkillsPath = path.posix.join(channelPath, "skills");
  const eventsPath = path.posix.join(workspacePath, "events");
  const settingsPath = path.posix.join(workspacePath, "settings.json");
  const skillSummary = formatSkillsForPrompt(skills);

  const extra = [
    "You are mom, a Slack-based coding assistant.",
    `Current Slack channel: ${channelId}`,
    `Sandbox mode: ${sandbox.type === "host" ? "host" : `docker:${sandbox.container}`}`,
    "All Slack-visible files and history live under the workspace root.",
    `Sandbox workspace root: ${workspacePath}`,
    `Host workspace root: ${hostWorkspacePath}`,
    `Channel root: ${channelPath}`,
    `Channel log path: ${path.posix.join(channelPath, "log.jsonl")}`,
    `Channel context path: ${path.posix.join(channelPath, "context.jsonl")}`,
    `Workspace skills dir: ${workspaceSkillsPath}`,
    `Channel skills dir: ${channelSkillsPath}`,
    `Events dir: ${eventsPath}`,
    `Workspace settings path: ${settingsPath}`,
    sandbox.type === "docker"
      ? `All read/write/edit/bash tool calls run inside the docker sandbox. Inside the sandbox, the real workspace root is ${workspacePath}. Never use host paths like ${hostWorkspacePath}/... in tool calls. If older logs or replies mention host paths under ${hostWorkspacePath}, translate them to ${workspacePath}/... before using tools.`
      : `All read/write/edit/bash tool calls run directly on the host. The real workspace root is ${workspacePath}.`,
    `When mentioning paths in replies, prefer sandbox-visible paths under ${workspacePath} or relative paths from it.`,
    "When useful, preserve durable facts in MEMORY.md files.",
    "",
    "## Skills",
    "Create reusable CLI skills for recurring workflows.",
    "Each skill lives in its own directory and must include a SKILL.md file with YAML frontmatter:",
    "```markdown\n---\nname: skill-name\ndescription: Short description\n---\n\n# Skill Name\n\nUsage instructions. Scripts live under {baseDir}/\n```",
    "Workspace-level skills are shared across channels. Channel-level skills override workspace skills with the same name.",
    `Available skills:\n${skillSummary}`,
    "",
    "## Events",
    "You can schedule synthetic wake-up messages by writing JSON files into the events directory.",
    `Immediate: {"type":"immediate","channelId":"${channelId}","text":"Check new GitHub issues"}`,
    `One-shot: {"type":"one-shot","channelId":"${channelId}","text":"Remind me tomorrow","at":"2026-03-29T09:00:00+08:00"}`,
    `Periodic: {"type":"periodic","channelId":"${channelId}","text":"Daily standup summary","schedule":"0 9 * * 1-5","timezone":"${Intl.DateTimeFormat().resolvedOptions().timeZone}"}`,
    "Use unique filenames so events do not overwrite each other. Immediate and one-shot events are deleted after they fire. Periodic events keep running until the file is removed.",
    "For periodic or background checks where there is nothing actionable to report, respond with exactly [SILENT] and nothing else. The harness will delete the status message and post nothing to Slack.",
    memory ? `\n## Memory\n${memory}` : "",
    systemPromptAppend && systemPromptAppend.trim().length > 0 ? `\n## Workspace Settings Prompt Append\n${systemPromptAppend}` : "",
  ].filter((part) => part.length > 0);
  return `${base}\n\n${extra.join("\n")}`;
}

function extractLastAssistantMessage(session: AgentSession): AssistantMessage | null {
  const messages = session.agent.state.messages;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.role === "assistant") {
      return message;
    }
  }
  return null;
}

function extractAssistantText(message: AssistantMessage | null): string {
  if (!message) {
    return "";
  }
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("")
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

function formatUserPrompt(message: RunnerContext["message"], attachments: Attachment[], missingAttachments: number): string {
  let text = `[${message.userName || message.user}]: ${message.text}`;

  if (attachments.length > 0) {
    text += `\n\n<slack_attachments>\n${attachments.map((attachment) => attachment.local).join("\n")}\n</slack_attachments>`;
  }

  if (missingAttachments > 0) {
    text += `\n\n[Note: ${missingAttachments} Slack attachment${missingAttachments === 1 ? "" : "s"} failed to download.]`;
  }

  return text.trim();
}

async function createImageContents(attachments: ResolvedAttachment[]): Promise<ImageContent[]> {
  const images: ImageContent[] = [];

  for (const attachment of attachments) {
    const mimeType = getImageMimeType(attachment);
    if (!mimeType) {
      continue;
    }

    try {
      const buffer = await readFile(attachment.hostPath);
      images.push({
        type: "image",
        data: buffer.toString("base64"),
        mimeType,
      });
    } catch {
      // Ignore unreadable attachments.
    }
  }

  return images;
}

async function createPromptInput(ctx: RunnerContext): Promise<{ text: string; images: ImageContent[]; message: AgentMessage }> {
  const resolvedAttachments = await ctx.resolveAttachments();
  const missingAttachments = Math.max(0, ctx.message.attachments.length - resolvedAttachments.length);
  const text = formatUserPrompt(ctx.message, resolvedAttachments, missingAttachments);
  const images = await createImageContents(resolvedAttachments);

  return {
    text,
    images,
    message: {
      role: "user",
      content: [{ type: "text", text }, ...images],
      timestamp: Date.now(),
    },
  };
}

interface PendingToolExecution {
  toolName: string;
  label: string;
  args: Record<string, unknown>;
  startedAt: number;
  ctx: RunnerContext;
}

interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  cost: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    total: number;
  };
}

function createEmptyUsageTotals(): UsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0,
    },
  };
}

function cloneUsageTotals(usage: UsageTotals): UsageTotals {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    totalTokens: usage.totalTokens,
    cost: {
      input: usage.cost.input,
      output: usage.cost.output,
      cacheRead: usage.cost.cacheRead,
      cacheWrite: usage.cost.cacheWrite,
      total: usage.cost.total,
    },
  };
}

function addUsageTotals(target: UsageTotals, usage: AssistantMessage["usage"]): void {
  target.input += usage.input;
  target.output += usage.output;
  target.cacheRead += usage.cacheRead;
  target.cacheWrite += usage.cacheWrite;
  target.totalTokens += usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  target.cost.input += usage.cost.input;
  target.cost.output += usage.cost.output;
  target.cost.cacheRead += usage.cost.cacheRead;
  target.cost.cacheWrite += usage.cost.cacheWrite;
  target.cost.total += usage.cost.total;
}

function hasMeaningfulUsage(usage: UsageTotals): boolean {
  return usage.totalTokens > 0 || usage.cost.total > 0;
}

function formatContextUsage(contextUsage: ContextUsageSnapshot | undefined): string | null {
  if (!contextUsage) {
    return null;
  }

  const windowLabel = contextUsage.contextWindow.toLocaleString();
  if (contextUsage.tokens === null || contextUsage.percent === null) {
    return `?/${windowLabel} (${contextUsage.source})`;
  }

  return `${contextUsage.percent.toFixed(1)}%/${windowLabel} (${contextUsage.tokens.toLocaleString()} tokens, ${contextUsage.source})`;
}

function formatUsageSummary(usage: UsageTotals, contextUsage: ContextUsageSnapshot | undefined): string {
  const totalTokens = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
  const lines = [
    "*Usage summary*",
    `- input: ${usage.input.toLocaleString()}`,
    `- output: ${usage.output.toLocaleString()}`,
    `- cache read: ${usage.cacheRead.toLocaleString()}`,
    `- cache write: ${usage.cacheWrite.toLocaleString()}`,
    `- total: ${totalTokens.toLocaleString()} tokens`,
    `- cost: $${usage.cost.total.toFixed(6)}`,
  ];

  const contextText = formatContextUsage(contextUsage);
  if (contextText) {
    lines.push(`- context: ${contextText}`);
  }

  return lines.join("\n");
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sanitizeForCodeBlock(text: string): string {
  return text.replace(/```/g, "'''");
}

function truncateForThread(
  text: string,
  options: { maxChars: number; maxLines: number },
): string {
  const normalized = text.replace(/\r\n/g, "\n").trimEnd();
  const lines = normalized.length > 0 ? normalized.split("\n") : ["(empty)"];

  let visible = lines.slice(0, options.maxLines).join("\n");
  let truncated = lines.length > options.maxLines;

  if (visible.length > options.maxChars) {
    visible = `${visible.slice(0, Math.max(0, options.maxChars - 3)).trimEnd()}...`;
    truncated = true;
  }

  const safeVisible = sanitizeForCodeBlock(visible.length > 0 ? visible : "(empty)");
  if (!truncated) {
    return safeVisible;
  }

  return `${safeVisible}\n\n[truncated for Slack thread]`;
}

function formatToolArgs(args: Record<string, unknown>): string {
  const filteredEntries = Object.entries(args).filter(([key]) => key !== "label");
  if (filteredEntries.length === 0) {
    return "(no args)";
  }
  return truncateForThread(stringifyUnknown(Object.fromEntries(filteredEntries)), {
    maxChars: 700,
    maxLines: 16,
  });
}

function extractToolResultText(result: unknown): string {
  if (!result || typeof result !== "object") {
    return truncateForThread(stringifyUnknown(result), {
      maxChars: 1000,
      maxLines: 20,
    });
  }

  const content = "content" in result ? (result as { content?: unknown }).content : undefined;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      if (!item || typeof item !== "object" || !("type" in item)) {
        parts.push(stringifyUnknown(item));
        continue;
      }
      const type = (item as { type?: unknown }).type;
      if (type === "text") {
        const text = (item as { text?: unknown }).text;
        if (typeof text === "string") {
          parts.push(text);
          continue;
        }
      }
      if (type === "image") {
        parts.push("[image]");
        continue;
      }
      parts.push(stringifyUnknown(item));
    }
    const joined = parts.join("\n").trim();
    if (joined.length > 0) {
      return truncateForThread(joined, {
        maxChars: 1000,
        maxLines: 20,
      });
    }
  }

  const details = "details" in result ? (result as { details?: unknown }).details : undefined;
  if (details !== undefined) {
    return truncateForThread(stringifyUnknown(details), {
      maxChars: 1000,
      maxLines: 20,
    });
  }

  return truncateForThread(stringifyUnknown(result), {
    maxChars: 1000,
    maxLines: 20,
  });
}

async function createRunner(channelId: string, config: MomAgentConfig): Promise<AgentRunner> {
  const channelDir = path.join(config.workingDir, channelId);
  const contextFile = path.join(channelDir, "context.jsonl");
  const model = resolveModel(config.provider, config.modelId, config.baseUrl);
  const executor = createExecutor(config.sandbox, config.workingDir);
  const workspacePath = executor.getWorkspacePath();

  await ensureContextFile(config.workingDir, channelDir, contextFile, model, config.thinkingLevel);

  let uploadHandler = async (_filePath: string, _title?: string): Promise<void> => {
    throw new Error("Upload function is not configured.");
  };
  let activeRun = false;
  let responseChain: Promise<void> = Promise.resolve();
  let threadChain: Promise<void> = Promise.resolve();
  let lastResult: { stopReason: string; errorMessage?: string } = { stopReason: "stop" };
  let activeReplyUsage = createEmptyUsageTotals();
  let session!: AgentSession;
  const pendingReplyContexts: RunnerContext[] = [];
  const pendingFollowUps: RunnerContext[] = [];
  const pendingTools = new Map<string, PendingToolExecution>();
  const pendingUsageSummaries: Array<{ ctx: RunnerContext; usage: UsageTotals }> = [];

  const queueResponseUpdate = (ctx: RunnerContext, message: AssistantMessage): void => {
    responseChain = responseChain.then(
      async () => {
        const stopReason = message.stopReason ?? "stop";
        const errorMessage = message.errorMessage;
        lastResult = {
          stopReason,
          ...(errorMessage === undefined ? {} : { errorMessage }),
        };

        if (stopReason === "aborted") {
          await ctx.replaceMessage("_Stopped_", false);
          return;
        }

        if (stopReason === "error") {
          await ctx.replaceMessage("Sorry, something went wrong.", true);
          return;
        }

        const finalText = extractAssistantText(message) || "(empty response)";
        if (isSilentResponseText(finalText)) {
          await threadChain;
          await ctx.deleteThreadMessages();
          await ctx.deleteMessage();
          return;
        }

        await ctx.replaceMessage(finalText, true);
      },
      async () => {
        const stopReason = message.stopReason ?? "stop";
        const errorMessage = message.errorMessage;
        lastResult = {
          stopReason,
          ...(errorMessage === undefined ? {} : { errorMessage }),
        };

        if (stopReason === "aborted") {
          await ctx.replaceMessage("_Stopped_", false);
          return;
        }

        if (stopReason === "error") {
          await ctx.replaceMessage("Sorry, something went wrong.", true);
          return;
        }

        const finalText = extractAssistantText(message) || "(empty response)";
        if (isSilentResponseText(finalText)) {
          await threadChain;
          await ctx.deleteThreadMessages();
          await ctx.deleteMessage();
          return;
        }

        await ctx.replaceMessage(finalText, true);
      },
    );
  };

  const queueThreadMessage = (ctx: RunnerContext, text: string): void => {
    threadChain = threadChain.then(
      async () => {
        await ctx.postThreadMessage(text);
      },
      async () => {
        await ctx.postThreadMessage(text);
      },
    );
  };

  const waitForResponseUpdates = async (): Promise<void> => {
    await responseChain;
  };

  const waitForThreadUpdates = async (): Promise<void> => {
    await threadChain;
  };

  const flushUsageSummaries = async (): Promise<void> => {
    const pending = pendingUsageSummaries.splice(0);
    if (pending.length === 0) {
      return;
    }

    const contextUsage = session.getContextUsage();
    for (const summary of pending) {
      if (!hasMeaningfulUsage(summary.usage)) {
        continue;
      }
      queueThreadMessage(summary.ctx, formatUsageSummary(summary.usage, contextUsage));
    }
    await waitForThreadUpdates();
  };

  const flushPendingReplyContexts = async (text: string): Promise<void> => {
    await waitForResponseUpdates();
    await waitForThreadUpdates();
    const pending = pendingReplyContexts.splice(0);
    for (const pendingContext of pending) {
      await pendingContext.replaceMessage(text, false);
    }
  };

  const agent = new Agent({
    initialState: {
      model,
      thinkingLevel: config.thinkingLevel,
    },
    getApiKey: async () => config.apiKey,
  });
  agent.setFollowUpMode("one-at-a-time");
  agent.setTools(
    createMomTools(executor, async (filePath: string, title?: string) => {
      await uploadHandler(filePath, title);
    }),
  );

  agent.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      const ctx = pendingReplyContexts[0];
      if (!ctx) {
        return;
      }

      const argsValue = event.args;
      const args = argsValue && typeof argsValue === "object" ? (argsValue as Record<string, unknown>) : {};
      const labelValue = args.label;
      const label = typeof labelValue === "string" && labelValue.trim().length > 0 ? labelValue.trim() : event.toolName;

      pendingTools.set(event.toolCallId, {
        toolName: event.toolName,
        label,
        args,
        startedAt: Date.now(),
        ctx,
      });

      const argsText = formatToolArgs(args);
      queueThreadMessage(ctx, `*→ ${event.toolName}* — ${label}\n\n\
\`\`\`\n${argsText}\n\`\`\``);
      return;
    }

    if (event.type === "tool_execution_end") {
      const pendingTool = pendingTools.get(event.toolCallId);
      pendingTools.delete(event.toolCallId);
      const ctx = pendingTool?.ctx ?? pendingReplyContexts[0];
      if (!ctx) {
        return;
      }

      const durationMs = pendingTool ? Date.now() - pendingTool.startedAt : 0;
      const duration = `${(durationMs / 1000).toFixed(1)}s`;
      const header = `${event.isError ? "*✗" : "*✓"} ${event.toolName}*${pendingTool ? ` — ${pendingTool.label}` : ""} (${duration})`;
      const resultText = extractToolResultText(event.result);
      queueThreadMessage(ctx, `${header}\n\n\
\`\`\`\n${resultText}\n\`\`\``);
      return;
    }

    if (event.type !== "turn_end") {
      return;
    }

    if (event.message.role === "assistant") {
      addUsageTotals(activeReplyUsage, event.message.usage);
      if (event.message.stopReason !== "toolUse") {
        const summaryContext = pendingReplyContexts[0];
        const assistantText = extractAssistantText(event.message);
        if (summaryContext && hasMeaningfulUsage(activeReplyUsage) && !isSilentResponseText(assistantText)) {
          pendingUsageSummaries.push({
            ctx: summaryContext,
            usage: cloneUsageTotals(activeReplyUsage),
          });
        }
        activeReplyUsage = createEmptyUsageTotals();
      }
    }

    if (event.message.role !== "assistant") {
      return;
    }
    if (event.message.stopReason === "toolUse") {
      return;
    }

    const ctx = pendingReplyContexts.shift();
    if (!ctx) {
      return;
    }
    queueResponseUpdate(ctx, event.message);
  });

  session = await AgentSession.create({
    agent,
    cwd: config.workingDir,
    sessionFile: contextFile,
    resolveModel: (modelRef) =>
      resolvePersistedModel(modelRef, {
        provider: config.provider,
        ...(config.baseUrl === undefined ? {} : { baseUrl: config.baseUrl }),
      }),
    autoCompaction: {
      settings: config.compaction,
      createSummaryGenerator: (currentModel) => createCompactionSummaryGenerator(currentModel as Model<any>),
    },
  });

  return {
    async run(ctx: RunnerContext): Promise<{ stopReason: string; errorMessage?: string }> {
      if (activeRun) {
        throw new Error(`Runner for ${channelId} is already active.`);
      }
      activeRun = true;
      lastResult = { stopReason: "stop" };
      activeReplyUsage = createEmptyUsageTotals();
      pendingUsageSummaries.length = 0;
      pendingReplyContexts.push(ctx);

      try {
        await mkdir(channelDir, { recursive: true });
        const synced = await syncLogToSessionManager(session.runtime.getSessionManager(), channelDir, ctx.message.ts);
        if (synced > 0) {
          logInfo(`Synced ${synced} log messages into context`, `${channelId}`);
          await session.switchSession(contextFile);
        }

        const [memory, skills] = await Promise.all([
          loadMemory(config.workingDir, channelDir),
          loadMomSkills(config.workingDir, channelId, workspacePath),
        ]);
        session.agent.setSystemPrompt(
          buildSystemPrompt(
            workspacePath,
            config.workingDir,
            channelId,
            memory,
            config.sandbox,
            skills,
            config.systemPromptAppend,
          ),
        );
        uploadHandler = async (filePath: string, title?: string) => {
          await ctx.uploadFile(executor.toHostPath(filePath), title);
        };

        const initialPrompt = await createPromptInput(ctx);
        await ctx.setTyping(true);
        await session.prompt(initialPrompt.text, initialPrompt.images.length > 0 ? initialPrompt.images : undefined);
        await flushUsageSummaries();

        let idlePasses = 0;
        while (idlePasses < 2) {
          await waitForResponseUpdates();
          await waitForThreadUpdates();

          const nextFollowUp = pendingFollowUps.shift();
          if (nextFollowUp) {
            const promptInput = await createPromptInput(nextFollowUp);
            session.agent.followUp(promptInput.message);
          }

          await Promise.resolve();
          if (!session.agent.hasQueuedMessages()) {
            idlePasses += 1;
            continue;
          }
          idlePasses = 0;
          await session.continue();
          await flushUsageSummaries();
        }

        await flushUsageSummaries();
        await waitForResponseUpdates();
        await waitForThreadUpdates();
        const assistantMessage = extractLastAssistantMessage(session);
        const stopReason = assistantMessage?.stopReason ?? lastResult.stopReason;
        const errorMessage = assistantMessage?.errorMessage ?? lastResult.errorMessage;
        return {
          stopReason,
          ...(errorMessage === undefined ? {} : { errorMessage }),
        };
      } finally {
        activeRun = false;
        pendingFollowUps.length = 0;
        pendingTools.clear();
        pendingUsageSummaries.length = 0;
        activeReplyUsage = createEmptyUsageTotals();
        if (pendingReplyContexts.length > 0) {
          await flushPendingReplyContexts(lastResult.stopReason === "aborted" ? "_Stopped_" : "_Cancelled_");
        }
      }
    },

    async followUp(ctx: RunnerContext): Promise<boolean> {
      if (!activeRun) {
        return false;
      }

      pendingReplyContexts.push(ctx);
      pendingFollowUps.push(ctx);
      await ctx.setTyping(true);
      logInfo(`Queued follow-up`, `${channelId}:${ctx.message.ts}`);
      return true;
    },

    abort(): void {
      session.abort();
    },

    dispose(): void {
      session.dispose();
    },
  };
}

export async function disposeRunner(channelId: string): Promise<void> {
  const cached = runners.get(channelId);
  if (!cached) {
    return;
  }

  runners.delete(channelId);
  await cached.promise.then(
    (runner) => runner.dispose(),
    () => undefined,
  );
}

export function getOrCreateRunner(channelId: string, config: MomAgentConfig, configKey: string): Promise<AgentRunner> {
  const cached = runners.get(channelId);
  if (cached && cached.configKey === configKey) {
    return cached.promise;
  }
  if (cached && cached.configKey !== configKey) {
    void cached.promise.then(
      (runner) => runner.dispose(),
      () => undefined,
    );
  }

  const created = createRunner(channelId, config).catch((error) => {
    const current = runners.get(channelId);
    if (current?.promise === created) {
      runners.delete(channelId);
    }
    throw error;
  });
  runners.set(channelId, { configKey, promise: created });
  return created;
}
