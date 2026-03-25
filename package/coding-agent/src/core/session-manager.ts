import { randomUUID, createHash } from "node:crypto";
import { appendFile, mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Message } from "@mypi/ai";
import type {
	BranchSummaryEntry,
	CompactionEntry,
	CustomEntry,
	CustomMessageEntry,
	LabelEntry,
	ModelChangeEntry,
	SessionCreateOptions,
	SessionEntry,
	SessionForkOptions,
	SessionHeader,
	SessionInfo,
	SessionInfoEntry,
	SessionInjectedMessage,
	SessionManagerSnapshot,
	SessionModelRef,
	SessionOpenOptions,
	SessionThinkingLevel,
	SessionTreeNode,
	SessionMessageEntry,
	ThinkingLevelChangeEntry,
} from "./session-types.js";
import { messageToText } from "./messages.js";
import { getBranchEntries, indexEntries } from "./session-context.js";
import { createBranchSummaryMessage } from "./messages.js";
import { SESSION_FILE_VERSION } from "./session-types.js";
import { getAgentDir } from "../config/config.js";

const SESSION_EXTENSION = ".jsonl";

function defaultSessionDir(): string {
	return path.join(getAgentDir(), "sessions");
}

function normalizeCwd(input: string): string {
	return path.resolve(input);
}

function cwdToDirectoryName(cwd: string): string {
	const normalized = normalizeCwd(cwd).replace(/^[A-Za-z]:/, (value) => value.toLowerCase()).replace(/[\\/]+/g, "-");
	const safe = normalized.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	const hash = createHash("sha1").update(cwd).digest("hex").slice(0, 10);
	return `--${safe || "root"}--${hash}`;
}

function createSessionFilename(id: string, timestamp: string): string {
	const compactTimestamp = timestamp.replace(/[-:.TZ]/g, "").slice(0, 14);
	return `${compactTimestamp}-${id}${SESSION_EXTENSION}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isSessionHeader(value: unknown): value is SessionHeader {
	return (
		isRecord(value) &&
		value.type === "session" &&
		typeof value.version === "number" &&
		typeof value.id === "string" &&
		typeof value.timestamp === "string" &&
		typeof value.cwd === "string"
	);
}

function isSessionEntry(value: unknown): value is SessionEntry {
	return (
		isRecord(value) &&
		typeof value.type === "string" &&
		value.type !== "session" &&
		typeof value.id === "string" &&
		(typeof value.parentId === "string" || value.parentId === null) &&
		typeof value.timestamp === "string"
	);
}

function toJsonLine(value: unknown): string {
	return `${JSON.stringify(value)}\n`;
}

async function ensureDirectory(dirPath: string): Promise<void> {
	await mkdir(dirPath, { recursive: true });
}

function timestampNow(): string {
	return new Date().toISOString();
}

async function collectSessionFiles(rootDir: string): Promise<string[]> {
	try {
		const dirents = await readdir(rootDir, { withFileTypes: true });
		const files: string[] = [];
		for (const dirent of dirents) {
			const fullPath = path.join(rootDir, dirent.name);
			if (dirent.isDirectory()) {
				files.push(...(await collectSessionFiles(fullPath)));
				continue;
			}
			if (dirent.isFile() && fullPath.endsWith(SESSION_EXTENSION)) {
				files.push(fullPath);
			}
		}
		return files;
	} catch {
		return [];
	}
}

async function removeEmptyParentDirs(startDir: string, stopDir: string): Promise<void> {
	let currentDir = startDir;
	const normalizedStop = path.resolve(stopDir);
	while (currentDir.startsWith(normalizedStop)) {
		if (path.resolve(currentDir) === normalizedStop) {
			break;
		}
		try {
			await rmdir(currentDir);
		} catch {
			break;
		}
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) {
			break;
		}
		currentDir = parentDir;
	}
}

function entryTimestamp(entry: SessionEntry): number {
	return Date.parse(entry.timestamp) || 0;
}

function sortEntriesByTimestamp(entries: SessionEntry[]): SessionEntry[] {
	return entries.slice().sort((left, right) => entryTimestamp(left) - entryTimestamp(right));
}

async function inspectSessionFile(filePath: string): Promise<SessionInfo | null> {
	try {
		const manager = await SessionManager.open(filePath);
		return manager.toSessionInfo();
	} catch {
		return null;
	}
}

export class SessionManager {
	static async create(options: SessionCreateOptions = {}): Promise<SessionManager> {
		const cwd = normalizeCwd(options.cwd ?? process.cwd());
		const sessionDir = options.sessionDir ?? defaultSessionDir();
		const timestamp = timestampNow();
		const header: SessionHeader = {
			type: "session",
			version: SESSION_FILE_VERSION,
			id: randomUUID(),
			timestamp,
			cwd,
			...(options.parentSession ? { parentSession: options.parentSession } : {}),
		};
		const projectDir = path.join(sessionDir, cwdToDirectoryName(cwd));
		const filePath = options.filePath ?? path.join(projectDir, createSessionFilename(header.id, timestamp));
		await ensureDirectory(path.dirname(filePath));
		await writeFile(filePath, toJsonLine(header), "utf8");
		return new SessionManager(header, [], filePath, sessionDir, null);
	}

	static async newSession(options: SessionCreateOptions = {}): Promise<SessionManager> {
		return SessionManager.create(options);
	}

	static async inMemory(cwd: string = process.cwd(), options: Pick<SessionCreateOptions, "parentSession" | "sessionDir"> = {}): Promise<SessionManager> {
		const header: SessionHeader = {
			type: "session",
			version: SESSION_FILE_VERSION,
			id: randomUUID(),
			timestamp: timestampNow(),
			cwd: normalizeCwd(cwd),
			...(options.parentSession ? { parentSession: options.parentSession } : {}),
		};
		return new SessionManager(header, [], undefined, options.sessionDir ?? defaultSessionDir(), null);
	}

	static async open(filePath: string, options: SessionOpenOptions = {}): Promise<SessionManager> {
		const text = await readFile(filePath, "utf8");
		const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
		if (lines.length === 0) {
			throw new Error(`Session file is empty: ${filePath}`);
		}

		let header: SessionHeader | undefined;
		const entries: SessionEntry[] = [];
		const seen = new Set<string>();

		for (let index = 0; index < lines.length; index++) {
			const line = lines[index]!;
			let value: unknown;
			try {
				value = JSON.parse(line);
			} catch {
				continue;
			}

			if (index === 0) {
				if (!isSessionHeader(value)) {
					throw new Error(`Invalid session header in ${filePath}`);
				}
				header = migrateHeader(value);
				continue;
			}

			if (!isSessionEntry(value)) {
				continue;
			}
			if (seen.has(value.id)) {
				continue;
			}
			seen.add(value.id);
			entries.push(value);
		}

		if (!header) {
			throw new Error(`Missing session header in ${filePath}`);
		}

		const sessionDir = options.sessionDir ?? path.dirname(path.dirname(filePath));
		const leafId = entries[entries.length - 1]?.id ?? null;
		return new SessionManager(header, entries, filePath, sessionDir, leafId);
	}

	static async continueRecent(cwd: string = process.cwd(), sessionDir: string = defaultSessionDir()): Promise<SessionManager | null> {
		const items = await SessionManager.list(cwd, sessionDir);
		if (items.length === 0) {
			return null;
		}
		return SessionManager.open(items[0]!.path, { sessionDir });
	}

	static async list(cwd: string = process.cwd(), sessionDir: string = defaultSessionDir()): Promise<SessionInfo[]> {
		const projectDir = path.join(sessionDir, cwdToDirectoryName(normalizeCwd(cwd)));
		const files = await collectSessionFiles(projectDir);
		const infos = await Promise.all(files.map((filePath) => inspectSessionFile(filePath)));
		return infos
			.filter((item): item is SessionInfo => item !== null)
			.sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
	}

	static async listAll(sessionDir: string = defaultSessionDir()): Promise<SessionInfo[]> {
		const files = await collectSessionFiles(sessionDir);
		const infos = await Promise.all(files.map((filePath) => inspectSessionFile(filePath)));
		return infos
			.filter((item): item is SessionInfo => item !== null)
			.sort((left, right) => Date.parse(right.modified) - Date.parse(left.modified));
	}

	static async deleteFile(filePath: string, options: { sessionDir?: string } = {}): Promise<void> {
		const resolvedFilePath = path.resolve(filePath);
		const sessionDir = path.resolve(options.sessionDir ?? defaultSessionDir());
		await rm(resolvedFilePath);
		await removeEmptyParentDirs(path.dirname(resolvedFilePath), sessionDir);
	}

	static async forkFrom(sourcePath: string, options: SessionForkOptions = {}): Promise<SessionManager> {
		const source = await SessionManager.open(sourcePath, {
			...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
		});
		return source.createBranchedSession(options);
	}

	private readonly header: SessionHeader;
	private readonly entries: SessionEntry[];
	private readonly byId: Map<string, SessionEntry>;
	private readonly sessionDir: string;
	private filePath: string | undefined;
	private leafId: string | null;

	private constructor(
		header: SessionHeader,
		entries: SessionEntry[],
		filePath: string | undefined,
		sessionDir: string,
		leafId: string | null,
	) {
		this.header = header;
		this.entries = entries.slice();
		this.byId = indexEntries(this.entries);
		this.filePath = filePath;
		this.sessionDir = sessionDir;
		this.leafId = leafId ?? this.entries[this.entries.length - 1]?.id ?? null;
	}

	getHeader(): SessionHeader {
		return this.header;
	}

	getSessionDir(): string {
		return this.filePath ? path.dirname(this.filePath) : path.join(this.sessionDir, cwdToDirectoryName(this.header.cwd));
	}

	getStorageRoot(): string {
		return this.sessionDir;
	}

	getSessionId(): string {
		return this.header.id;
	}

	getSessionFile(): string | undefined {
		return this.filePath;
	}

	getEntries(): SessionEntry[] {
		return this.entries.slice();
	}

	getLeafId(): string | null {
		return this.leafId;
	}

	getLeafEntry(): SessionEntry | undefined {
		return this.leafId ? this.byId.get(this.leafId) : undefined;
	}

	getEntry(id: string): SessionEntry | undefined {
		return this.byId.get(id);
	}

	getChildren(parentId: string | null): SessionEntry[] {
		return this.entries
			.filter((entry) => entry.parentId === parentId)
			.sort((left, right) => entryTimestamp(left) - entryTimestamp(right));
	}

	getLabel(targetId: string | null): string | null {
		let label: string | null = null;
		for (const entry of this.entries) {
			if (entry.type === "label" && entry.targetId === targetId) {
				label = entry.label;
			}
		}
		return label;
	}

	getSessionName(): string | null {
		let name: string | null = null;
		for (const entry of this.entries) {
			if (entry.type === "session_info" && Object.hasOwn(entry, "name")) {
				name = entry.name ?? null;
			}
		}
		return name;
	}

	getBranch(fromId: string | null = this.leafId): SessionEntry[] {
		return getBranchEntries(this.byId, fromId);
	}

	getTree(): SessionTreeNode {
		const build = (entry: SessionEntry | null): SessionTreeNode => {
			const children = this.getChildren(entry?.id ?? null).map((child) => build(child));
			return {
				entryId: entry?.id ?? null,
				entry,
				label: this.getLabel(entry?.id ?? null),
				children,
				isLeaf: (entry?.id ?? null) === this.leafId,
			};
		};
		return build(null);
	}

	branch(targetId: string): void {
		if (!this.byId.has(targetId)) {
			throw new Error(`Unknown session entry: ${targetId}`);
		}
		this.leafId = targetId;
	}

	resetLeaf(): void {
		this.leafId = null;
	}

	async branchWithSummary(targetId: string | null, summary: string, details?: unknown): Promise<BranchSummaryEntry> {
		const fromId = this.leafId;
		if (targetId !== null && !this.byId.has(targetId)) {
			throw new Error(`Unknown session entry: ${targetId}`);
		}
		const entry: BranchSummaryEntry = {
			type: "branch_summary",
			id: randomUUID(),
			parentId: targetId,
			timestamp: timestampNow(),
			fromId,
			summary,
			...(details === undefined ? {} : { details }),
		};
		await this.appendEntry(entry);
		return entry;
	}

	async createBranchedSession(options: SessionForkOptions = {}): Promise<SessionManager> {
		const fromId = options.fromId === undefined ? this.leafId : options.fromId;
		const branch = this.getBranch(fromId);
		const manager = options.inMemory
			? await SessionManager.inMemory(options.cwd ?? this.header.cwd, {
				parentSession: this.header.id,
				sessionDir: options.sessionDir ?? this.sessionDir,
			})
			: await SessionManager.create({
				cwd: options.cwd ?? this.header.cwd,
				sessionDir: options.sessionDir ?? this.sessionDir,
				parentSession: this.header.id,
				...(options.filePath === undefined ? {} : { filePath: options.filePath }),
			});

		for (const entry of branch) {
			await manager.appendExistingEntry(entry);
		}

		manager.leafId = fromId ?? null;
		return manager;
	}

	async setSessionFile(filePath: string): Promise<void> {
		await ensureDirectory(path.dirname(filePath));
		this.filePath = filePath;
		await this.rewriteFile();
	}

	async appendMessage(message: Message): Promise<SessionMessageEntry> {
		const entry: SessionMessageEntry = {
			type: "message",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			message,
		};
		await this.appendEntry(entry);
		return entry;
	}

	async appendThinkingLevelChange(level: SessionThinkingLevel): Promise<ThinkingLevelChangeEntry> {
		const entry: ThinkingLevelChangeEntry = {
			type: "thinking_level_change",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			level,
		};
		await this.appendEntry(entry);
		return entry;
	}

	async appendModelChange(model: SessionModelRef): Promise<ModelChangeEntry> {
		const entry: ModelChangeEntry = {
			type: "model_change",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			model,
		};
		await this.appendEntry(entry);
		return entry;
	}

	async appendCompaction(input: {
		summary: string;
		firstKeptEntryId: string;
		tokensBefore: number;
		details?: unknown;
	}): Promise<CompactionEntry> {
		if (!this.byId.has(input.firstKeptEntryId)) {
			throw new Error(`Unknown kept entry: ${input.firstKeptEntryId}`);
		}
		const entry: CompactionEntry = {
			type: "compaction",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			summary: input.summary,
			firstKeptEntryId: input.firstKeptEntryId,
			tokensBefore: input.tokensBefore,
			...(input.details === undefined ? {} : { details: input.details }),
		};
		await this.appendEntry(entry);
		return entry;
	}

	async appendCustomEntry(name: string, data: unknown): Promise<CustomEntry> {
		const entry: CustomEntry = {
			type: "custom",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			name,
			data,
		};
		await this.appendEntry(entry);
		return entry;
	}

	async appendCustomMessageEntry(message: SessionInjectedMessage): Promise<CustomMessageEntry> {
		const entry: CustomMessageEntry = {
			type: "custom_message",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			message,
		};
		await this.appendEntry(entry);
		return entry;
	}

	async appendLabelChange(targetId: string | null, label: string | null): Promise<LabelEntry> {
		if (targetId !== null && !this.byId.has(targetId)) {
			throw new Error(`Unknown label target: ${targetId}`);
		}
		const entry: LabelEntry = {
			type: "label",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			targetId,
			label,
		};
		await this.appendEntry(entry);
		return entry;
	}

	async appendSessionInfo(input: { name?: string | null }): Promise<SessionInfoEntry> {
		const entry: SessionInfoEntry = {
			type: "session_info",
			id: randomUUID(),
			parentId: this.leafId,
			timestamp: timestampNow(),
			...(Object.hasOwn(input, "name") ? { name: input.name ?? null } : {}),
		};
		await this.appendEntry(entry);
		return entry;
	}

	toSnapshot(): SessionManagerSnapshot {
		return {
			header: this.header,
			entries: this.getEntries(),
			leafId: this.leafId,
			...(this.filePath === undefined ? {} : { filePath: this.filePath }),
			sessionDir: this.sessionDir,
		};
	}

	toSessionInfo(): SessionInfo {
		const messageEntries = this.entries.filter((entry) => entry.type === "message");
		const messageTexts = messageEntries.map((entry) => messageToText(entry.message)).filter((text) => text.length > 0);
		const modified = this.entries[this.entries.length - 1]?.timestamp ?? this.header.timestamp;
		return {
			path: this.filePath ?? "",
			id: this.header.id,
			cwd: this.header.cwd,
			name: this.getSessionName(),
			created: this.header.timestamp,
			modified,
			messageCount: messageEntries.length,
			firstMessage: messageTexts[0] ?? null,
			allMessagesText: messageTexts.join("\n\n"),
			parentSession: this.header.parentSession ?? null,
		};
	}

	private async appendExistingEntry(entry: SessionEntry): Promise<void> {
		await this.appendEntry({ ...entry });
	}

	private async appendEntry(entry: SessionEntry): Promise<void> {
		if (this.byId.has(entry.id)) {
			throw new Error(`Duplicate session entry id: ${entry.id}`);
		}
		if (entry.parentId !== null && !this.byId.has(entry.parentId)) {
			throw new Error(`Unknown parent entry: ${entry.parentId}`);
		}
		this.entries.push(entry);
		this.byId.set(entry.id, entry);
		this.leafId = entry.id;
		if (this.filePath) {
			await appendFile(this.filePath, toJsonLine(entry), "utf8");
		}
	}

	private async rewriteFile(): Promise<void> {
		if (!this.filePath) {
			return;
		}
		const body = [toJsonLine(this.header), ...this.entries.map((entry) => toJsonLine(entry))].join("");
		await writeFile(this.filePath, body, "utf8");
	}
}

function migrateHeader(header: SessionHeader): SessionHeader {
	if (header.version >= SESSION_FILE_VERSION) {
		return header;
	}
	return {
		...header,
		version: SESSION_FILE_VERSION,
	};
}

export function getDefaultSessionDir(): string {
	return defaultSessionDir();
}

export function getProjectSessionDir(cwd: string, sessionDir: string = defaultSessionDir()): string {
	return path.join(sessionDir, cwdToDirectoryName(normalizeCwd(cwd)));
}

export function extractUserMessageText(entry: SessionEntry | undefined): string | null {
	if (!entry || entry.type !== "message" || entry.message.role !== "user") {
		return null;
	}
	return messageToText(entry.message);
}

export function createBranchSummaryEntryPreview(entry: BranchSummaryEntry) {
	return createBranchSummaryMessage(entry.summary, {
		fromEntryId: entry.fromId,
		timestamp: Date.parse(entry.timestamp) || Date.now(),
		...(entry.details === undefined ? {} : { details: entry.details }),
	});
}
