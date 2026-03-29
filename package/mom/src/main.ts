#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { configureAI } from "@mypi/ai";
import { loadAgentConfig, type LoadedAgentConfig, type WorkspaceToolName } from "@mypi/coding-agent";
import { disposeRunner, type AgentRunner, getOrCreateRunner, type MomAgentConfig } from "./agent.js";
import { clearChannelConversationFiles } from "./clear.js";
import { applyMomWorkspaceSettings, loadMomWorkspaceSettings } from "./context.js";
import { createEventsWatcher } from "./events.js";
import { logError, logInfo, logWarning } from "./log.js";
import { parseSandboxArg, type SandboxConfig, validateSandbox } from "./sandbox.js";
import { type SlackBot, SlackBot as SlackBotClass, type SlackEvent } from "./slack.js";
import { type Attachment, ChannelStore, type ResolvedAttachment } from "./store.js";

interface ParsedArgs {
  workingDir?: string;
  sandbox: SandboxConfig;
}

interface ChannelState {
  running: boolean;
  runner?: AgentRunner;
  runnerPromise?: Promise<AgentRunner>;
  runnerKey?: string;
  stopRequested: boolean;
  stopMessageTs: string | undefined;
  followUpPromise: Promise<void>;
}

interface SlackContext {
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

function parseArgs(): ParsedArgs {
  const args = process.argv.slice(2);
  let workingDir: string | undefined;
  let sandbox: SandboxConfig = { type: "host" };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg) {
      continue;
    }
    if (arg.startsWith("--sandbox=")) {
      sandbox = parseSandboxArg(arg.slice("--sandbox=".length));
      continue;
    }
    if (arg === "--sandbox") {
      const value = args[index + 1];
      if (!value) {
        throw new Error("Missing value for --sandbox");
      }
      sandbox = parseSandboxArg(value);
      index += 1;
      continue;
    }
    if (!arg.startsWith("-")) {
      workingDir = path.resolve(arg);
    }
  }

  return {
    ...(workingDir ? { workingDir } : {}),
    sandbox,
  };
}

function usage(): string {
  return [
    "mom - Slack coding assistant for mypi",
    "",
    "Usage:",
    "  mom [--sandbox=host|docker:<name>] <working-directory>",
    "",
    "Environment:",
    "  MOM_SLACK_APP_TOKEN",
    "  MOM_SLACK_BOT_TOKEN",
    "  OPENAI_API_KEY / ANTHROPIC_API_KEY",
  ].join("\n");
}

function createSlackContext(event: SlackEvent, slack: SlackBot, store: ChannelStore): SlackContext {
  const user = slack.getUser(event.user);
  let messageTs: string | null = null;
  const threadMessageTs: string[] = [];

  const ensureMessageTs = async (): Promise<string> => {
    if (messageTs) {
      return messageTs;
    }
    messageTs = await slack.postMessage(event.channel, "_Thinking..._");
    return messageTs;
  };

  return {
    message: {
      text: event.text,
      user: event.user,
      ...(user?.userName ? { userName: user.userName } : {}),
      channel: event.channel,
      ts: event.ts,
      attachments: event.attachments,
    },

    async setTyping(isTyping: boolean): Promise<void> {
      if (!isTyping) {
        return;
      }
      await ensureMessageTs();
    },

    async replaceMessage(text: string, shouldLog = false): Promise<void> {
      const ts = await ensureMessageTs();
      await slack.updateMessage(event.channel, ts, text);
      if (shouldLog) {
        await store.logBotResponse(event.channel, text, ts);
      }
    },

    async deleteMessage(): Promise<void> {
      if (!messageTs) {
        return;
      }
      await slack.deleteMessage(event.channel, messageTs);
      messageTs = null;
    },

    async postThreadMessage(text: string): Promise<void> {
      const ts = await ensureMessageTs();
      const threadTs = await slack.postThreadMessage(event.channel, ts, text);
      if (threadTs.length > 0) {
        threadMessageTs.push(threadTs);
      }
    },

    async deleteThreadMessages(): Promise<void> {
      while (threadMessageTs.length > 0) {
        const threadTs = threadMessageTs.pop();
        if (!threadTs) {
          continue;
        }
        try {
          await slack.deleteMessage(event.channel, threadTs);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          logWarning("Failed to delete Slack thread message", `${event.channel}:${threadTs}: ${message}`);
        }
      }
    },

    async uploadFile(filePath: string, title?: string): Promise<void> {
      await slack.uploadFile(event.channel, filePath, title);
    },

    async resolveAttachments(): Promise<ResolvedAttachment[]> {
      return store.resolveAttachments(event.attachments);
    },
  };
}

function serializeRunnerConfig(config: MomAgentConfig): string {
  return JSON.stringify({
    provider: config.provider,
    modelId: config.modelId,
    baseUrl: config.baseUrl ?? null,
    thinkingLevel: config.thinkingLevel,
    systemPromptAppend: config.systemPromptAppend ?? null,
    compaction: config.compaction,
  });
}

async function resolveEffectiveAgentConfig(baseConfig: MomAgentConfig): Promise<{ config: MomAgentConfig; key: string }> {
  const workspaceSettings = await loadMomWorkspaceSettings(baseConfig.workingDir);
  const config = applyMomWorkspaceSettings(baseConfig, workspaceSettings);
  return {
    config,
    key: serializeRunnerConfig(config),
  };
}

async function loadMomAgentConfig(workingDir: string, sandbox: SandboxConfig): Promise<MomAgentConfig> {
  const loadedConfig: LoadedAgentConfig = await loadAgentConfig({ cwd: process.cwd() });
  const provider = loadedConfig.settings.provider;
  const apiKey = loadedConfig.settings.apiKey;
  if (!apiKey) {
    throw new Error(`Missing API key for provider ${provider}. Configure mypi agent config or provider env vars.`);
  }

  const baseUrl = loadedConfig.settings.baseUrl;
  configureAI({
    providers:
      provider === "anthropic"
        ? {
            anthropic: {
              apiKey,
              ...(baseUrl === undefined ? {} : { baseUrl }),
            },
          }
        : {
            openai: {
              apiKey,
              ...(baseUrl === undefined ? {} : { baseUrl }),
            },
          },
  });

  return {
    workingDir,
    sandbox,
    provider,
    apiKey,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    modelId: loadedConfig.settings.modelId,
    thinkingLevel: loadedConfig.settings.thinkingLevel ?? "off",
    activeTools: (loadedConfig.settings.activeTools ?? ["read", "write", "edit", "bash"]) as WorkspaceToolName[],
    ...(loadedConfig.settings.systemPromptAppend === undefined ? {} : { systemPromptAppend: loadedConfig.settings.systemPromptAppend }),
    compaction: loadedConfig.settings.compaction,
  };
}

async function logSyntheticEvent(store: ChannelStore, event: SlackEvent): Promise<void> {
  if (event.user !== "EVENT") {
    return;
  }

  await store.logMessage(event.channel, {
    date: new Date(Number.parseFloat(event.ts) * 1000).toISOString(),
    ts: event.ts,
    user: event.user,
    userName: "event",
    text: event.text,
    attachments: event.attachments,
    isBot: false,
  });
}

async function main(): Promise<void> {
  const parsed = parseArgs();
  if (!parsed.workingDir) {
    console.log(usage());
    process.exitCode = 1;
    return;
  }

  const appToken = process.env.MOM_SLACK_APP_TOKEN;
  const botToken = process.env.MOM_SLACK_BOT_TOKEN;
  if (!appToken || !botToken) {
    throw new Error("Missing MOM_SLACK_APP_TOKEN or MOM_SLACK_BOT_TOKEN.");
  }

  const workingDir = parsed.workingDir;
  await validateSandbox(parsed.sandbox);
  const baseAgentConfig = await loadMomAgentConfig(workingDir, parsed.sandbox);
  const sharedStore = new ChannelStore({ workingDir, botToken });
  const channelStates = new Map<string, ChannelState>();

  const getState = (channelId: string): ChannelState => {
    let state = channelStates.get(channelId);
    if (!state) {
      state = {
        running: false,
        stopRequested: false,
        stopMessageTs: undefined,
        followUpPromise: Promise.resolve(),
      };
      channelStates.set(channelId, state);
    }
    return state;
  };

  const ensureRunner = async (channelId: string): Promise<AgentRunner> => {
    const state = getState(channelId);
    if (state.running && state.runner) {
      return state.runner;
    }

    const effective = await resolveEffectiveAgentConfig(baseAgentConfig);
    if (state.runner && state.runnerKey === effective.key) {
      return state.runner;
    }
    if (state.runnerPromise && state.runnerKey === effective.key) {
      return state.runnerPromise;
    }

    if (state.runner && state.runnerKey && state.runnerKey !== effective.key) {
      state.runner.dispose();
      delete state.runner;
      logInfo("Reloaded mom runner with updated workspace settings", `${channelId}`);
    }

    state.runnerKey = effective.key;
    state.runnerPromise = getOrCreateRunner(channelId, effective.config, effective.key).then((runner) => {
      state.runner = runner;
      return runner;
    });
    return state.runnerPromise;
  };

  const runFreshEvent = async (event: SlackEvent, slack: SlackBot): Promise<void> => {
    const state = getState(event.channel);
    const runner = await ensureRunner(event.channel);
    const ctx = createSlackContext(event, slack, sharedStore);
    state.running = true;
    state.stopRequested = false;

    try {
      const result = await runner.run(ctx);
      if (result.stopReason === "aborted" && state.stopRequested) {
        if (state.stopMessageTs) {
          await slack.updateMessage(event.channel, state.stopMessageTs, "_Stopped_");
          state.stopMessageTs = undefined;
        } else {
          await slack.postMessage(event.channel, "_Stopped_");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logError(`Failed to handle Slack event for ${event.channel}`, message);
      await slack.postMessage(event.channel, `_Error: ${message}_`);
    } finally {
      state.running = false;
    }
  };

  const handler = {
    isRunning(channelId: string): boolean {
      return getState(channelId).running;
    },

    async handleStop(channelId: string, slack: SlackBot): Promise<void> {
      const state = getState(channelId);
      if (!state.running) {
        await slack.postMessage(channelId, "_Nothing running_");
        return;
      }
      state.stopRequested = true;
      const runner = await ensureRunner(channelId);
      runner.abort();
      state.stopMessageTs = await slack.postMessage(channelId, "_Stopping..._");
    },

    async handleClear(channelId: string, slack: SlackBot): Promise<void> {
      const state = getState(channelId);
      if (state.running) {
        await slack.postMessage(channelId, "_Cannot clear while running. Send `stop` first._");
        return;
      }

      await disposeRunner(channelId);
      delete state.runner;
      delete state.runnerPromise;
      delete state.runnerKey;
      state.stopRequested = false;
      state.stopMessageTs = undefined;
      state.followUpPromise = Promise.resolve();

      const result = await clearChannelConversationFiles(workingDir, channelId, sharedStore);
      const message = result.removedLog || result.removedContext ? "_Cleared channel context_" : "_Channel context was already empty_";
      await slack.postMessage(channelId, message);
    },

    async handleEvent(event: SlackEvent, slack: SlackBot): Promise<void> {
      await logSyntheticEvent(sharedStore, event);
      await runFreshEvent(event, slack);
    },

    async handleFollowUp(event: SlackEvent, slack: SlackBot): Promise<void> {
      const state = getState(event.channel);
      state.followUpPromise = state.followUpPromise.then(
        async () => {
          const runner = await ensureRunner(event.channel);
          const ctx = createSlackContext(event, slack, sharedStore);
          const accepted = await runner.followUp(ctx);
          if (!accepted) {
            await runFreshEvent(event, slack);
          }
        },
        async () => {
          const runner = await ensureRunner(event.channel);
          const ctx = createSlackContext(event, slack, sharedStore);
          const accepted = await runner.followUp(ctx);
          if (!accepted) {
            await runFreshEvent(event, slack);
          }
        },
      );
      await state.followUpPromise;
    },
  };

  const slack = new SlackBotClass(handler, {
    appToken,
    botToken,
    workingDir,
    store: sharedStore,
  });

  logInfo("Starting mom", `${workingDir} (${parsed.sandbox.type === "host" ? "host" : `docker:${parsed.sandbox.container}`})`);
  await slack.start();
  logInfo("Slack bot connected", workingDir);

  const eventsWatcher = createEventsWatcher(workingDir, slack);
  eventsWatcher.start();
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  logError("Fatal", message);
  process.exitCode = 1;
});
