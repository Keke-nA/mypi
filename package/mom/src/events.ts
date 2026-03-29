import { Cron } from "croner";
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync, watch, type FSWatcher } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { logInfo, logWarning } from "./log.js";
import type { SlackBot, SlackEvent } from "./slack.js";

export interface ImmediateEvent {
  type: "immediate";
  channelId: string;
  text: string;
}

export interface OneShotEvent {
  type: "one-shot";
  channelId: string;
  text: string;
  at: string;
}

export interface PeriodicEvent {
  type: "periodic";
  channelId: string;
  text: string;
  schedule: string;
  timezone: string;
}

export type MomEvent = ImmediateEvent | OneShotEvent | PeriodicEvent;

const DEBOUNCE_MS = 100;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 100;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export class EventsWatcher {
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly crons = new Map<string, Cron>();
  private readonly debounceTimers = new Map<string, NodeJS.Timeout>();
  private readonly knownFiles = new Set<string>();
  private readonly startTime = Date.now();
  private watcher: FSWatcher | null = null;

  constructor(
    private readonly eventsDir: string,
    private readonly slack: SlackBot,
  ) {}

  start(): void {
    if (!existsSync(this.eventsDir)) {
      mkdirSync(this.eventsDir, { recursive: true });
    }

    this.scanExisting();
    this.watcher = watch(this.eventsDir, (_eventType, filename) => {
      if (!filename || !filename.endsWith(".json")) {
        return;
      }
      this.debounce(filename, () => {
        void this.handleFileChange(filename);
      });
    });

    logInfo("Events watcher started", this.eventsDir);
  }

  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();

    for (const cron of this.crons.values()) {
      cron.stop();
    }
    this.crons.clear();
    this.knownFiles.clear();
  }

  private debounce(filename: string, fn: () => void): void {
    const existing = this.debounceTimers.get(filename);
    if (existing) {
      clearTimeout(existing);
    }

    this.debounceTimers.set(
      filename,
      setTimeout(() => {
        this.debounceTimers.delete(filename);
        fn();
      }, DEBOUNCE_MS),
    );
  }

  private scanExisting(): void {
    let files: string[];
    try {
      files = readdirSync(this.eventsDir).filter((file) => file.endsWith(".json"));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning("Failed to scan events directory", message);
      return;
    }

    for (const file of files) {
      void this.handleFile(file);
    }
  }

  private async handleFileChange(filename: string): Promise<void> {
    const filePath = path.join(this.eventsDir, filename);

    if (!existsSync(filePath)) {
      this.handleDelete(filename);
      return;
    }

    if (this.knownFiles.has(filename)) {
      this.cancelScheduled(filename);
    }

    await this.handleFile(filename);
  }

  private handleDelete(filename: string): void {
    this.cancelScheduled(filename);
    this.knownFiles.delete(filename);
  }

  private cancelScheduled(filename: string): void {
    const timer = this.timers.get(filename);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(filename);
    }

    const cron = this.crons.get(filename);
    if (cron) {
      cron.stop();
      this.crons.delete(filename);
    }
  }

  private async handleFile(filename: string): Promise<void> {
    const filePath = path.join(this.eventsDir, filename);

    let event: MomEvent | null = null;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      try {
        const content = await readFile(filePath, "utf8");
        event = this.parseEvent(content, filename);
        break;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < MAX_RETRIES - 1) {
          await this.sleep(RETRY_BASE_MS * 2 ** attempt);
        }
      }
    }

    if (!event) {
      logWarning(`Failed to parse event file after ${MAX_RETRIES} retries`, `${filename}: ${lastError?.message ?? "unknown error"}`);
      this.deleteFile(filename);
      return;
    }

    this.knownFiles.add(filename);

    switch (event.type) {
      case "immediate":
        this.handleImmediate(filename, event);
        return;
      case "one-shot":
        this.handleOneShot(filename, event);
        return;
      case "periodic":
        this.handlePeriodic(filename, event);
        return;
    }
  }

  private parseEvent(content: string, filename: string): MomEvent {
    const parsed = JSON.parse(content) as Record<string, unknown>;

    if (!isNonEmptyString(parsed.type) || !isNonEmptyString(parsed.channelId) || !isNonEmptyString(parsed.text)) {
      throw new Error(`Missing required string fields in ${filename}`);
    }

    switch (parsed.type) {
      case "immediate":
        return {
          type: "immediate",
          channelId: parsed.channelId,
          text: parsed.text,
        };
      case "one-shot":
        if (!isNonEmptyString(parsed.at)) {
          throw new Error(`Missing 'at' field in ${filename}`);
        }
        return {
          type: "one-shot",
          channelId: parsed.channelId,
          text: parsed.text,
          at: parsed.at,
        };
      case "periodic":
        if (!isNonEmptyString(parsed.schedule) || !isNonEmptyString(parsed.timezone)) {
          throw new Error(`Missing 'schedule' or 'timezone' field in ${filename}`);
        }
        return {
          type: "periodic",
          channelId: parsed.channelId,
          text: parsed.text,
          schedule: parsed.schedule,
          timezone: parsed.timezone,
        };
      default:
        throw new Error(`Unknown event type '${parsed.type}' in ${filename}`);
    }
  }

  private handleImmediate(filename: string, event: ImmediateEvent): void {
    const filePath = path.join(this.eventsDir, filename);

    try {
      const stats = statSync(filePath);
      if (stats.mtimeMs < this.startTime) {
        this.deleteFile(filename);
        return;
      }
    } catch {
      return;
    }

    this.execute(filename, event);
  }

  private handleOneShot(filename: string, event: OneShotEvent): void {
    const targetTime = new Date(event.at).getTime();
    const now = Date.now();
    if (!Number.isFinite(targetTime)) {
      logWarning("Invalid one-shot event time", `${filename}: ${event.at}`);
      this.deleteFile(filename);
      return;
    }

    if (targetTime <= now) {
      this.deleteFile(filename);
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(filename);
      this.execute(filename, event);
    }, targetTime - now);

    this.timers.set(filename, timer);
  }

  private handlePeriodic(filename: string, event: PeriodicEvent): void {
    try {
      const cron = new Cron(event.schedule, { timezone: event.timezone }, () => {
        this.execute(filename, event, false);
      });
      this.crons.set(filename, cron);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logWarning("Invalid periodic event schedule", `${filename}: ${message}`);
      this.deleteFile(filename);
    }
  }

  private execute(filename: string, event: MomEvent, deleteAfter = true): void {
    const scheduleInfo =
      event.type === "immediate" ? "immediate" : event.type === "one-shot" ? event.at : `${event.schedule}@${event.timezone}`;

    const syntheticEvent: SlackEvent = {
      type: "mention",
      channel: event.channelId,
      ts: (Date.now() / 1000).toFixed(6),
      user: "EVENT",
      text: `[EVENT:${filename}:${event.type}:${scheduleInfo}] ${event.text}`,
      attachments: [],
    };

    const queued = this.slack.enqueueEvent(syntheticEvent);
    if (deleteAfter) {
      this.deleteFile(filename);
    }

    if (!queued) {
      logWarning("Event queue full, discarded event", filename);
    }
  }

  private deleteFile(filename: string): void {
    const filePath = path.join(this.eventsDir, filename);
    try {
      unlinkSync(filePath);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code !== "ENOENT") {
        logWarning("Failed to delete event file", `${filename}: ${String(error)}`);
      }
    }
    this.cancelScheduled(filename);
    this.knownFiles.delete(filename);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}

export function createEventsWatcher(workspaceDir: string, slack: SlackBot): EventsWatcher {
  return new EventsWatcher(path.join(workspaceDir, "events"), slack);
}
