import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { logInfo, logWarning } from "./log.js";
import type { Attachment, ChannelStore, SlackFile } from "./store.js";
import { isClearCommandText } from "./clear.js";

export interface SlackEvent {
  type: "mention" | "dm";
  channel: string;
  ts: string;
  user: string;
  text: string;
  files?: SlackFile[];
  attachments: Attachment[];
}

export interface SlackUser {
  id: string;
  userName: string;
  displayName: string;
}

export interface SlackChannel {
  id: string;
  name: string;
}

export interface MomHandler {
  isRunning(channelId: string): boolean;
  handleEvent(event: SlackEvent, slack: SlackBot): Promise<void>;
  handleFollowUp(event: SlackEvent, slack: SlackBot): Promise<void>;
  handleStop(channelId: string, slack: SlackBot): Promise<void>;
  handleClear(channelId: string, slack: SlackBot): Promise<void>;
}

interface AppMentionPayload {
  event: {
    text: string;
    channel: string;
    user: string;
    ts: string;
    files?: SlackFile[];
  };
  ack(): Promise<void>;
}

interface MessagePayload {
  event: {
    text?: string;
    channel: string;
    user?: string;
    ts: string;
    channel_type?: string;
    subtype?: string;
    bot_id?: string;
    files?: SlackFile[];
  };
  ack(): Promise<void>;
}

interface HistoryMessage {
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  subtype?: string;
  files?: SlackFile[];
}

interface BackfillResult {
  loggedCount: number;
  replayEvents: SlackEvent[];
}

type QueuedWork = () => Promise<void>;
type BufferedLiveWork = () => Promise<void>;

class ChannelQueue {
  private readonly queue: QueuedWork[] = [];
  private readonly idleResolvers: Array<() => void> = [];
  private processing = false;
  private pendingCount = 0;

  enqueue(work: QueuedWork): void {
    this.pendingCount += 1;
    this.queue.push(async () => {
      try {
        await work();
      } finally {
        this.pendingCount -= 1;
        this.resolveIdleWaiters();
      }
    });
    void this.processNext();
  }

  size(): number {
    return this.queue.length;
  }

  onIdle(): Promise<void> {
    if (!this.processing && this.queue.length === 0 && this.pendingCount === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdleWaiters(): void {
    if (this.processing || this.queue.length > 0 || this.pendingCount > 0) {
      return;
    }

    const waiters = this.idleResolvers.splice(0, this.idleResolvers.length);
    for (const waiter of waiters) {
      waiter();
    }
  }

  private async processNext(): Promise<void> {
    if (this.processing || this.queue.length === 0) {
      this.resolveIdleWaiters();
      return;
    }
    this.processing = true;
    const work = this.queue.shift();
    if (!work) {
      this.processing = false;
      this.resolveIdleWaiters();
      return;
    }
    try {
      await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning("Unhandled channel queue error", message);
    } finally {
      this.processing = false;
      this.resolveIdleWaiters();
      void this.processNext();
    }
  }
}

function normalizeSlackText(text: string | undefined): string {
  return (text || "").replace(/<@[A-Z0-9]+>/gi, "").trim();
}

export class SlackBot {
  private readonly socketClient: SocketModeClient;
  private readonly webClient: WebClient;
  private readonly queues = new Map<string, ChannelQueue>();
  private readonly users = new Map<string, SlackUser>();
  private readonly channels = new Map<string, SlackChannel>();
  private readonly processedTriggerKeys = new Set<string>();
  private readonly bufferedLiveWorks: BufferedLiveWork[] = [];
  private replayingStartupBacklog = false;
  private botUserId: string | null = null;

  constructor(
    private readonly handler: MomHandler,
    private readonly config: { appToken: string; botToken: string; workingDir: string; store: ChannelStore },
  ) {
    this.socketClient = new SocketModeClient({ appToken: config.appToken });
    this.webClient = new WebClient(config.botToken);
  }

  async start(): Promise<void> {
    const auth = await this.webClient.auth.test();
    this.botUserId = typeof auth.user_id === "string" ? auth.user_id : null;
    await Promise.all([this.fetchUsers(), this.fetchChannels()]);
    const replayEvents = await this.backfillAllChannels();
    this.replayingStartupBacklog = replayEvents.length > 0;
    this.setupEventHandlers();
    await this.socketClient.start();

    try {
      await this.replayBackfilledEvents(replayEvents);
    } finally {
      this.replayingStartupBacklog = false;
      await this.flushBufferedLiveWorks();
    }
  }

  getUser(userId: string): SlackUser | undefined {
    return this.users.get(userId);
  }

  getChannel(channelId: string): SlackChannel | undefined {
    return this.channels.get(channelId);
  }

  async postMessage(channel: string, text: string): Promise<string> {
    const result = await this.webClient.chat.postMessage({ channel, text });
    return typeof result.ts === "string" ? result.ts : "";
  }

  async updateMessage(channel: string, ts: string, text: string): Promise<void> {
    await this.webClient.chat.update({ channel, ts, text });
  }

  async deleteMessage(channel: string, ts: string): Promise<void> {
    await this.webClient.chat.delete({ channel, ts });
  }

  async postThreadMessage(channel: string, threadTs: string, text: string): Promise<string> {
    const result = await this.webClient.chat.postMessage({ channel, thread_ts: threadTs, text });
    return typeof result.ts === "string" ? result.ts : "";
  }

  async uploadFile(channel: string, filePath: string, title?: string): Promise<void> {
    const file = await readFile(filePath);
    await this.webClient.files.uploadV2({
      channel_id: channel,
      file,
      filename: title || filePath.split("/").pop() || "attachment",
      ...(title ? { title } : {}),
    });
  }

  enqueueEvent(event: SlackEvent): boolean {
    const queue = this.getQueue(event.channel);
    if (queue.size() >= 5) {
      logWarning("Event queue full, discarded synthetic event", `${event.channel}: ${event.text.slice(0, 80)}`);
      return false;
    }

    queue.enqueue(() => this.handler.handleEvent(event, this));
    return true;
  }

  private getQueue(channelId: string): ChannelQueue {
    let queue = this.queues.get(channelId);
    if (!queue) {
      queue = new ChannelQueue();
      this.queues.set(channelId, queue);
    }
    return queue;
  }

  private createTriggerKey(channelId: string, ts: string): string {
    return `${channelId}:${ts}`;
  }

  private rememberTrigger(channelId: string, ts: string): boolean {
    const key = this.createTriggerKey(channelId, ts);
    if (this.processedTriggerKeys.has(key)) {
      return false;
    }
    this.processedTriggerKeys.add(key);
    return true;
  }

  private setupEventHandlers(): void {
    this.socketClient.on("app_mention", async (payload) => {
      const { event, ack } = payload as AppMentionPayload;
      const text = normalizeSlackText(event.text);
      if (text.length === 0 && (!event.files || event.files.length === 0)) {
        await ack();
        return;
      }

      const slackEvent: SlackEvent = {
        type: "mention",
        channel: event.channel,
        ts: event.ts,
        user: event.user,
        text,
        ...(event.files ? { files: event.files } : {}),
        attachments: [],
      };

      if (!this.rememberTrigger(slackEvent.channel, slackEvent.ts)) {
        await ack();
        return;
      }

      const work = () => this.processMentionEvent(slackEvent);
      if (this.replayingStartupBacklog) {
        this.bufferedLiveWorks.push(work);
        await ack();
        return;
      }

      await work();
      await ack();
    });

    this.socketClient.on("message", async (payload) => {
      const { event, ack } = payload as MessagePayload;
      if (!event.user || event.bot_id || event.user === this.botUserId) {
        await ack();
        return;
      }
      if (event.subtype !== undefined && event.subtype !== "file_share") {
        await ack();
        return;
      }

      const text = normalizeSlackText(event.text);
      if (text.length === 0 && (!event.files || event.files.length === 0)) {
        await ack();
        return;
      }

      const isDm = event.channel_type === "im";
      const isBotMention = this.botUserId ? (event.text || "").includes(`<@${this.botUserId}>`) : false;
      if (!isDm && isBotMention) {
        await ack();
        return;
      }

      const slackEvent: SlackEvent = {
        type: isDm ? "dm" : "mention",
        channel: event.channel,
        ts: event.ts,
        user: event.user,
        text,
        ...(event.files ? { files: event.files } : {}),
        attachments: [],
      };

      if (isDm && !this.rememberTrigger(slackEvent.channel, slackEvent.ts)) {
        await ack();
        return;
      }

      const work = () => this.processMessageEvent(slackEvent, isDm);
      if (this.replayingStartupBacklog) {
        this.bufferedLiveWorks.push(work);
        await ack();
        return;
      }

      await work();
      await ack();
    });
  }

  private async processMentionEvent(event: SlackEvent): Promise<void> {
    await this.logUserMessage(event);

    if (event.text.toLowerCase() === "stop") {
      await this.handler.handleStop(event.channel, this);
      return;
    }

    if (isClearCommandText(event.text)) {
      await this.handler.handleClear(event.channel, this);
      return;
    }

    if (this.handler.isRunning(event.channel)) {
      await this.handler.handleFollowUp(event, this);
      return;
    }

    this.getQueue(event.channel).enqueue(() => this.handler.handleEvent(event, this));
  }

  private async processMessageEvent(event: SlackEvent, isDm: boolean): Promise<void> {
    await this.logUserMessage(event);

    if (!isDm) {
      return;
    }

    if (event.text.toLowerCase() === "stop") {
      await this.handler.handleStop(event.channel, this);
      return;
    }

    if (isClearCommandText(event.text)) {
      await this.handler.handleClear(event.channel, this);
      return;
    }

    if (this.handler.isRunning(event.channel)) {
      await this.handler.handleFollowUp(event, this);
      return;
    }

    this.getQueue(event.channel).enqueue(() => this.handler.handleEvent(event, this));
  }

  private async logUserMessage(event: SlackEvent): Promise<void> {
    const user = this.users.get(event.user);
    const attachments = event.files ? this.config.store.processAttachments(event.channel, event.files, event.ts) : [];
    event.attachments = attachments;

    await this.config.store.logMessage(event.channel, {
      date: new Date(Number.parseFloat(event.ts) * 1000).toISOString(),
      ts: event.ts,
      user: event.user,
      ...(user?.userName ? { userName: user.userName } : {}),
      ...(user?.displayName ? { displayName: user.displayName } : {}),
      text: event.text,
      attachments,
      isBot: false,
    });
  }

  private async flushBufferedLiveWorks(): Promise<void> {
    if (this.bufferedLiveWorks.length === 0) {
      return;
    }

    const works = this.bufferedLiveWorks.splice(0, this.bufferedLiveWorks.length);
    logInfo("Processing buffered live Slack events", `${works.length} event(s)`);

    for (const work of works) {
      try {
        await work();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarning("Failed to process buffered live Slack event", message);
      }
    }
  }

  private async backfillAllChannels(): Promise<SlackEvent[]> {
    const channelIds = await this.getChannelsToBackfill();
    if (channelIds.length === 0) {
      return [];
    }

    logInfo("Starting Slack backfill", `${channelIds.length} channel(s)`);
    let totalMessages = 0;
    const replayEvents: SlackEvent[] = [];

    for (const channelId of channelIds) {
      try {
        const result = await this.backfillChannel(channelId);
        if (result.loggedCount > 0) {
          const channelName = this.channels.get(channelId)?.name || channelId;
          logInfo("Backfilled Slack history", `${channelName}: ${result.loggedCount} message(s)`);
          totalMessages += result.loggedCount;
        }
        replayEvents.push(...result.replayEvents);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logWarning("Failed to backfill Slack history", `${channelId}: ${message}`);
      }
    }

    logInfo("Slack backfill complete", `${totalMessages} message(s)`);
    return replayEvents;
  }

  private async getChannelsToBackfill(): Promise<string[]> {
    const channelIds: string[] = [];

    for (const channelId of this.channels.keys()) {
      try {
        await access(path.join(this.config.workingDir, channelId, "log.jsonl"));
        channelIds.push(channelId);
      } catch {
        // Ignore channels without existing logs.
      }
    }

    return channelIds;
  }

  private async getExistingTimestamps(channelId: string): Promise<Set<string>> {
    const timestamps = new Set<string>();
    let content: string;
    try {
      content = await readFile(path.join(this.config.workingDir, channelId, "log.jsonl"), "utf8");
    } catch {
      return timestamps;
    }

    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as { ts?: unknown };
        if (typeof parsed.ts === "string") {
          timestamps.add(parsed.ts);
        }
      } catch {
        // Ignore malformed lines.
      }
    }

    return timestamps;
  }

  private async backfillChannel(channelId: string): Promise<BackfillResult> {
    const existingTimestamps = await this.getExistingTimestamps(channelId);
    let latestTimestamp: string | undefined;
    for (const timestamp of existingTimestamps) {
      if (!latestTimestamp || Number.parseFloat(timestamp) > Number.parseFloat(latestTimestamp)) {
        latestTimestamp = timestamp;
      }
    }

    const fetchedMessages: HistoryMessage[] = [];
    let cursor: string | undefined;
    let pages = 0;
    const maxPages = 3;

    do {
      const result = await this.webClient.conversations.history({
        channel: channelId,
        limit: 200,
        ...(latestTimestamp ? { oldest: latestTimestamp, inclusive: false } : {}),
        ...(cursor ? { cursor } : {}),
      });
      const messages = result.messages as HistoryMessage[] | undefined;
      if (messages) {
        fetchedMessages.push(...messages);
      }
      cursor = result.response_metadata?.next_cursor || undefined;
      pages += 1;
    } while (cursor && pages < maxPages);

    const relevantMessages = fetchedMessages.filter((message) => {
      if (!message.ts || existingTimestamps.has(message.ts)) {
        return false;
      }

      if (message.user === this.botUserId) {
        return true;
      }

      if (message.bot_id) {
        return false;
      }

      if (message.subtype !== undefined && message.subtype !== "file_share") {
        return false;
      }

      if (!message.user) {
        return false;
      }

      return normalizeSlackText(message.text).length > 0 || Boolean(message.files && message.files.length > 0);
    });

    relevantMessages.reverse();

    const replayEvents: SlackEvent[] = [];

    for (const message of relevantMessages) {
      if (!message.ts) {
        continue;
      }

      const isBotMessage = message.user === this.botUserId;
      const normalizedText = normalizeSlackText(message.text);
      const user = message.user ? this.users.get(message.user) : undefined;
      const attachments = message.files ? this.config.store.processAttachments(channelId, message.files, message.ts) : [];

      await this.config.store.logMessage(channelId, {
        date: new Date(Number.parseFloat(message.ts) * 1000).toISOString(),
        ts: message.ts,
        user: isBotMessage ? "bot" : (message.user || "unknown"),
        ...(!isBotMessage && user?.userName ? { userName: user.userName } : {}),
        ...(!isBotMessage && user?.displayName ? { displayName: user.displayName } : {}),
        text: normalizedText,
        attachments,
        isBot: isBotMessage,
      });

      if (!isBotMessage && this.isReplayableBackfillMessage(channelId, message, normalizedText)) {
        replayEvents.push({
          type: channelId.startsWith("D") ? "dm" : "mention",
          channel: channelId,
          ts: message.ts,
          user: message.user || "unknown",
          text: normalizedText,
          ...(message.files ? { files: message.files } : {}),
          attachments,
        });
      }
    }

    return {
      loggedCount: relevantMessages.length,
      replayEvents,
    };
  }

  private async replayBackfilledEvents(events: SlackEvent[]): Promise<void> {
    if (events.length === 0) {
      return;
    }

    logInfo("Replaying offline Slack triggers", `${events.length} event(s)`);
    const eventsByChannel = new Map<string, SlackEvent[]>();
    for (const event of events) {
      const existing = eventsByChannel.get(event.channel);
      if (existing) {
        existing.push(event);
      } else {
        eventsByChannel.set(event.channel, [event]);
      }
    }

    const replayStatusMessages = await this.postReplayStatusMessages(eventsByChannel);

    try {
      const idlePromises: Promise<void>[] = [];
      for (const [channelId, channelEvents] of eventsByChannel) {
        const queue = this.getQueue(channelId);
        for (const event of channelEvents) {
          if (!this.rememberTrigger(event.channel, event.ts)) {
            continue;
          }
          queue.enqueue(() => this.handler.handleEvent(event, this));
        }
        idlePromises.push(queue.onIdle());
      }

      await Promise.all(idlePromises);
    } finally {
      await this.clearReplayStatusMessages(replayStatusMessages);
    }
  }

  private async postReplayStatusMessages(eventsByChannel: Map<string, SlackEvent[]>): Promise<Map<string, string>> {
    const replayStatusMessages = new Map<string, string>();

    for (const [channelId, channelEvents] of eventsByChannel) {
      const count = channelEvents.length;
      const noun = count === 1 ? "message" : "messages";
      try {
        const messageTs = await this.postMessage(channelId, `_Replaying ${count} offline ${noun}..._`);
        if (messageTs.length > 0) {
          replayStatusMessages.set(channelId, messageTs);
        }
      } catch (error) {
        const channelName = this.channels.get(channelId)?.name || channelId;
        const message = error instanceof Error ? error.message : String(error);
        logWarning("Failed to post replay status message", `${channelName}: ${message}`);
      }
    }

    return replayStatusMessages;
  }

  private async clearReplayStatusMessages(replayStatusMessages: Map<string, string>): Promise<void> {
    for (const [channelId, messageTs] of replayStatusMessages) {
      try {
        await this.deleteMessage(channelId, messageTs);
      } catch (error) {
        const channelName = this.channels.get(channelId)?.name || channelId;
        const message = error instanceof Error ? error.message : String(error);
        logWarning("Failed to clear replay status message", `${channelName}: ${message}`);
      }
    }
  }

  private isReplayableBackfillMessage(channelId: string, message: HistoryMessage, normalizedText: string): boolean {
    if (!message.user || message.user === this.botUserId || message.bot_id) {
      return false;
    }

    const hasFiles = Boolean(message.files && message.files.length > 0);
    if (normalizedText.length === 0 && !hasFiles) {
      return false;
    }

    if (normalizedText.toLowerCase() === "stop") {
      return false;
    }

    if (channelId.startsWith("D")) {
      return true;
    }

    if (!this.botUserId) {
      return false;
    }

    return (message.text || "").includes(`<@${this.botUserId}>`);
  }

  private async fetchUsers(): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await this.webClient.users.list({
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const members = result.members as Array<{ id?: string; name?: string; real_name?: string; deleted?: boolean }> | undefined;
      if (members) {
        for (const member of members) {
          if (member.id && member.name && !member.deleted) {
            this.users.set(member.id, {
              id: member.id,
              userName: member.name,
              displayName: member.real_name || member.name,
            });
          }
        }
      }
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }

  private async fetchChannels(): Promise<void> {
    let cursor: string | undefined;
    do {
      const result = await this.webClient.conversations.list({
        types: "public_channel,private_channel",
        exclude_archived: true,
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const channels = result.channels as Array<{ id?: string; name?: string; is_member?: boolean }> | undefined;
      if (channels) {
        for (const channel of channels) {
          if (channel.id && channel.name && channel.is_member) {
            this.channels.set(channel.id, { id: channel.id, name: channel.name });
          }
        }
      }
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    cursor = undefined;
    do {
      const result = await this.webClient.conversations.list({
        types: "im",
        limit: 200,
        ...(cursor ? { cursor } : {}),
      });
      const channels = result.channels as Array<{ id?: string; user?: string }> | undefined;
      if (channels) {
        for (const channel of channels) {
          if (!channel.id) {
            continue;
          }
          const user = channel.user ? this.users.get(channel.user) : undefined;
          this.channels.set(channel.id, {
            id: channel.id,
            name: user ? `DM:${user.userName}` : `DM:${channel.id}`,
          });
        }
      }
      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);
  }
}
