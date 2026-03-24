import type { ImageContent, TextContent } from "@mypi/ai";
import type { AgentMessage, ThinkingLevel } from "@mypi/agent";

export const SESSION_FILE_VERSION = 1;

export type SessionThinkingLevel = ThinkingLevel | "off";

export interface SessionModelRef {
	provider: string;
	modelId: string;
}

export interface SessionHeader {
	type: "session";
	version: number;
	id: string;
	timestamp: string;
	cwd: string;
	parentSession?: string;
}

export interface SessionEntryBase<TType extends string = string> {
	type: TType;
	id: string;
	parentId: string | null;
	timestamp: string;
}

export interface SessionMessageEntry extends SessionEntryBase<"message"> {
	message: Extract<AgentMessage, { role: "user" | "assistant" | "toolResult" }>;
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase<"thinking_level_change"> {
	level: SessionThinkingLevel;
}

export interface ModelChangeEntry extends SessionEntryBase<"model_change"> {
	model: SessionModelRef;
}

export interface CompactionEntry extends SessionEntryBase<"compaction"> {
	summary: string;
	firstKeptEntryId: string;
	tokensBefore: number;
	details?: unknown;
}

export interface BranchSummaryEntry extends SessionEntryBase<"branch_summary"> {
	fromId: string | null;
	summary: string;
	details?: unknown;
}

export interface CustomEntry extends SessionEntryBase<"custom"> {
	name: string;
	data: unknown;
}

export interface CustomContextMessage {
	role: "custom_message";
	content: string | (TextContent | ImageContent)[];
	timestamp: number;
	name?: string;
	metadata?: unknown;
}

export interface CompactionSummaryMessage {
	role: "compaction_summary";
	summary: string;
	timestamp: number;
	sourceEntryId: string;
	details?: unknown;
}

export interface BranchSummaryMessage {
	role: "branch_summary";
	summary: string;
	fromEntryId: string | null;
	timestamp: number;
	details?: unknown;
}

export type SessionInjectedMessage = CustomContextMessage | CompactionSummaryMessage | BranchSummaryMessage;

export interface CustomMessageEntry extends SessionEntryBase<"custom_message"> {
	message: SessionInjectedMessage;
}

export interface LabelEntry extends SessionEntryBase<"label"> {
	targetId: string | null;
	label: string | null;
}

export interface SessionInfoEntry extends SessionEntryBase<"session_info"> {
	name?: string | null;
}

export type SessionEntry =
	| SessionMessageEntry
	| ThinkingLevelChangeEntry
	| ModelChangeEntry
	| CompactionEntry
	| BranchSummaryEntry
	| CustomEntry
	| CustomMessageEntry
	| LabelEntry
	| SessionInfoEntry;

export type FileEntry = SessionHeader | SessionEntry;

export interface SessionTreeNode {
	entryId: string | null;
	entry: SessionEntry | null;
	label: string | null;
	children: SessionTreeNode[];
	isLeaf: boolean;
}

export interface SessionContext {
	messages: AgentMessage[];
	thinkingLevel: SessionThinkingLevel;
	model: SessionModelRef | null;
	leafId: string | null;
	branch: SessionEntry[];
}

export interface SessionInfo {
	path: string;
	id: string;
	cwd: string;
	name: string | null;
	created: string;
	modified: string;
	messageCount: number;
	firstMessage: string | null;
	allMessagesText: string;
	parentSession: string | null;
}

export interface BranchSummaryResult {
	summary: string;
	details?: unknown;
}

export interface CompactionSummaryResult {
	summary: string;
	details?: unknown;
}

export interface SessionListOptions {
	cwd?: string;
	sessionDir?: string;
}

export interface SessionCreateOptions {
	cwd?: string;
	sessionDir?: string;
	parentSession?: string;
	filePath?: string;
}

export interface SessionOpenOptions {
	sessionDir?: string;
}

export interface SessionForkOptions extends SessionCreateOptions {
	fromId?: string | null;
	inMemory?: boolean;
}

export interface SessionManagerSnapshot {
	header: SessionHeader;
	entries: SessionEntry[];
	leafId: string | null;
	filePath?: string;
	sessionDir: string;
}
