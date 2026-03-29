import { access, appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { logWarning } from "./log.js";

export interface SlackFile {
  name?: string;
  mimetype?: string;
  url_private_download?: string;
  url_private?: string;
}

export interface Attachment {
  original: string;
  local: string;
  mimeType?: string;
}

export interface ResolvedAttachment extends Attachment {
  hostPath: string;
}

export interface LoggedMessage {
  date: string;
  ts: string;
  user: string;
  userName?: string;
  displayName?: string;
  text: string;
  attachments: Attachment[];
  isBot: boolean;
}

export interface ChannelStoreConfig {
  workingDir: string;
  botToken: string;
}

export class ChannelStore {
  private readonly downloadPromises = new Map<string, Promise<void>>();
  private readonly loggedTimestamps = new Map<string, Set<string>>();
  private readonly logCacheLoads = new Map<string, Promise<Set<string>>>();

  constructor(private readonly config: ChannelStoreConfig) {}

  clearChannelLogCache(channelId: string): void {
    this.loggedTimestamps.delete(channelId);
    this.logCacheLoads.delete(channelId);
  }

  async getChannelDir(channelId: string): Promise<string> {
    const dir = path.join(this.config.workingDir, channelId);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  getAbsolutePath(localPath: string): string {
    return path.join(this.config.workingDir, localPath);
  }

  processAttachments(channelId: string, files: SlackFile[], timestamp: string): Attachment[] {
    const attachments: Attachment[] = [];

    for (const file of files) {
      const url = file.url_private_download || file.url_private;
      if (!url || !file.name) {
        continue;
      }

      const filename = this.generateLocalFilename(file.name, timestamp);
      const localPath = `${channelId}/attachments/${filename}`;
      attachments.push({
        original: file.name,
        local: localPath,
        ...(file.mimetype ? { mimeType: file.mimetype } : {}),
      });
      this.ensureDownload(localPath, url);
    }

    return attachments;
  }

  async resolveAttachments(attachments: Attachment[]): Promise<ResolvedAttachment[]> {
    const resolved = await Promise.all(
      attachments.map(async (attachment) => {
        const pendingDownload = this.downloadPromises.get(attachment.local);
        if (pendingDownload) {
          await pendingDownload.catch(() => undefined);
        }

        const hostPath = this.getAbsolutePath(attachment.local);
        try {
          await access(hostPath);
          return { ...attachment, hostPath };
        } catch {
          return null;
        }
      }),
    );

    return resolved.filter((attachment): attachment is ResolvedAttachment => attachment !== null);
  }

  async hasLoggedTimestamp(channelId: string, ts: string): Promise<boolean> {
    const timestamps = await this.getLoggedTimestamps(channelId);
    return timestamps.has(ts);
  }

  async logMessage(channelId: string, message: LoggedMessage): Promise<boolean> {
    const channelDir = await this.getChannelDir(channelId);
    const logPath = path.join(channelDir, "log.jsonl");
    const timestamps = await this.getLoggedTimestamps(channelId);
    if (timestamps.has(message.ts)) {
      return false;
    }

    await appendFile(logPath, `${JSON.stringify(message)}\n`, "utf8");
    timestamps.add(message.ts);
    return true;
  }

  async logBotResponse(channelId: string, text: string, ts: string): Promise<void> {
    await this.logMessage(channelId, {
      date: new Date().toISOString(),
      ts,
      user: "bot",
      text,
      attachments: [],
      isBot: true,
    });
  }

  private async getLoggedTimestamps(channelId: string): Promise<Set<string>> {
    const cached = this.loggedTimestamps.get(channelId);
    if (cached) {
      return cached;
    }

    const pending = this.logCacheLoads.get(channelId);
    if (pending) {
      return pending;
    }

    const loadPromise = (async () => {
      const timestamps = new Set<string>();
      try {
        const channelDir = await this.getChannelDir(channelId);
        const logPath = path.join(channelDir, "log.jsonl");
        const content = await readFile(logPath, "utf8");
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
      } catch {
        // Ignore missing logs here.
      }

      this.loggedTimestamps.set(channelId, timestamps);
      this.logCacheLoads.delete(channelId);
      return timestamps;
    })();

    this.logCacheLoads.set(channelId, loadPromise);
    return loadPromise;
  }

  private generateLocalFilename(originalName: string, timestamp: string): string {
    const millis = Math.floor(Number.parseFloat(timestamp) * 1000);
    const sanitized = originalName.replace(/[^a-zA-Z0-9._-]+/g, "_");
    return `${millis}_${sanitized || "attachment"}`;
  }

  private ensureDownload(localPath: string, url: string): void {
    if (this.downloadPromises.has(localPath)) {
      return;
    }

    const downloadPromise = this.downloadAttachment(localPath, url)
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        logWarning("Failed to download Slack attachment", `${localPath}: ${message}`);
      })
      .finally(() => {
        this.downloadPromises.delete(localPath);
      });

    this.downloadPromises.set(localPath, downloadPromise);
  }

  private async downloadAttachment(localPath: string, url: string): Promise<void> {
    const hostPath = this.getAbsolutePath(localPath);
    try {
      await access(hostPath);
      return;
    } catch {
      // Download below.
    }

    await mkdir(path.dirname(hostPath), { recursive: true });

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.config.botToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(hostPath, buffer);
  }
}
