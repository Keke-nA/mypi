import { getModels, getProviders, type Model } from "@mypi/ai";
import type { Agent, AgentEvent, ThinkingLevel } from "@mypi/agent";
import { buildSessionContext } from "./session-context.js";
import {
	getContextUsageSnapshot,
	isContextOverflowError,
	resolveAutoCompactionSettings,
	shouldAutoCompact,
	type AutoCompactionSettings,
	type ContextUsageSnapshot,
} from "./context-usage.js";
import {
	extractUserMessageText,
	getDefaultSessionDir,
	SessionManager,
} from "./session-manager.js";
import type {
	BranchSummaryResult,
	CompactionEntry,
	SessionForkOptions,
	SessionInfo,
	SessionModelRef,
	SessionThinkingLevel,
	SessionTreeNode,
} from "./session-types.js";
import { compact, type CompactionSettings, type CompactionSummaryGenerator } from "./session-compaction.js";
import {
	generateBranchSummary,
	type BranchSummaryGenerator,
} from "./branch-summarization.js";

export interface SessionRuntimeState {
	sessionId: string;
	sessionFile?: string;
	sessionName: string | null;
	cwd: string;
	leafId: string | null;
	tree: SessionTreeNode;
	isCompacting: boolean;
	isStreaming: boolean;
}

export interface SessionAutoCompactionOptions {
	settings?: AutoCompactionSettings;
	createSummaryGenerator?: (model: Model<any>) => CompactionSummaryGenerator;
}

export interface SessionRuntimeCreateOptions {
	agent: Agent;
	cwd?: string;
	sessionDir?: string;
	sessionFile?: string;
	continueRecent?: boolean;
	inMemory?: boolean;
	resolveModel?: (model: SessionModelRef) => Promise<Model<any> | null | undefined> | Model<any> | null | undefined;
	defaultThinkingLevel?: SessionThinkingLevel;
	autoCompaction?: SessionAutoCompactionOptions;
}

export type SessionRuntimeEvent =
	| { type: "auto_compaction_start"; reason: "threshold" | "overflow" }
	| {
			type: "auto_compaction_end";
			reason: "threshold" | "overflow";
			result?: CompactionEntry;
			aborted: boolean;
			willRetry: boolean;
			errorMessage?: string;
	  };

async function resolveRegisteredModel(modelRef: SessionModelRef): Promise<Model<any> | null> {
	for (const provider of getProviders()) {
		if (provider !== modelRef.provider) {
			continue;
		}
		const model = getModels(provider).find((candidate) => candidate.id === modelRef.modelId);
		if (model) {
			return model;
		}
	}
	return null;
}

function toModelRef(model: Model<any>): SessionModelRef {
	return { provider: model.provider, modelId: model.id };
}

function isPersistableMessage(message: unknown): message is Parameters<SessionManager["appendMessage"]>[0] {
	return Boolean(
		message &&
			typeof message === "object" &&
			"role" in message &&
			((message as { role?: string }).role === "user" ||
				(message as { role?: string }).role === "assistant" ||
				(message as { role?: string }).role === "toolResult"),
	);
}

export class SessionRuntime {
	static async create(options: SessionRuntimeCreateOptions): Promise<SessionRuntime> {
		let manager: SessionManager;
		let createdFresh = false;
		if (options.sessionFile) {
			manager = await SessionManager.open(options.sessionFile, {
				...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
			});
		} else if (options.inMemory) {
			manager = await SessionManager.inMemory(options.cwd ?? process.cwd(), {
				...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
			});
			createdFresh = true;
		} else if (options.continueRecent) {
			manager =
				(await SessionManager.continueRecent(options.cwd ?? process.cwd(), options.sessionDir ?? getDefaultSessionDir())) ??
				(await SessionManager.create({
					...(options.cwd === undefined ? {} : { cwd: options.cwd }),
					...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
				}));
			createdFresh = manager.getEntries().length === 0;
		} else {
			manager = await SessionManager.create({
				...(options.cwd === undefined ? {} : { cwd: options.cwd }),
				...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
			});
			createdFresh = true;
		}

		const runtime = new SessionRuntime(options.agent, manager, {
			...(options.resolveModel === undefined ? {} : { resolveModel: options.resolveModel }),
			...(options.defaultThinkingLevel === undefined ? {} : { defaultThinkingLevel: options.defaultThinkingLevel }),
			...(options.autoCompaction === undefined ? {} : { autoCompaction: options.autoCompaction }),
		});
		if (createdFresh) {
			await runtime.initializeSessionState();
		}
		await runtime.restoreIntoAgent();
		return runtime;
	}

	private readonly agent: Agent;
	private readonly defaultThinkingLevel: SessionThinkingLevel;
	private readonly resolveModel: NonNullable<SessionRuntimeCreateOptions["resolveModel"]>;
	private manager: SessionManager;
	private isCompacting = false;
	private readonly unsubscribe: () => void;
	private readonly runtimeListeners = new Set<(event: SessionRuntimeEvent) => void>();
	private readonly autoCompactionSettings: ReturnType<typeof resolveAutoCompactionSettings>;
	private readonly createAutoCompactionSummaryGenerator?: SessionAutoCompactionOptions["createSummaryGenerator"];
	private eventQueue: Promise<void> = Promise.resolve();
	private pendingAutoCompaction: { reason: "threshold" | "overflow"; willRetry: boolean } | null = null;

	constructor(
		agent: Agent,
		manager: SessionManager,
		options: {
			resolveModel?: SessionRuntimeCreateOptions["resolveModel"];
			defaultThinkingLevel?: SessionThinkingLevel;
			autoCompaction?: SessionAutoCompactionOptions;
		} = {},
	) {
		this.agent = agent;
		this.manager = manager;
		this.defaultThinkingLevel = options.defaultThinkingLevel ?? "off";
		this.resolveModel = options.resolveModel ?? resolveRegisteredModel;
		this.autoCompactionSettings = resolveAutoCompactionSettings(options.autoCompaction?.settings);
		this.createAutoCompactionSummaryGenerator = options.autoCompaction?.createSummaryGenerator;
		this.unsubscribe = this.agent.subscribe((event) => {
			this.eventQueue = this.eventQueue.then(
				() => this.handleAgentEvent(event),
				async () => this.handleAgentEvent(event),
			);
		});
	}

	dispose(): void {
		this.unsubscribe();
	}

	subscribe(listener: (event: SessionRuntimeEvent) => void): () => void {
		this.runtimeListeners.add(listener);
		return () => this.runtimeListeners.delete(listener);
	}

	async waitForSettled(): Promise<void> {
		await this.eventQueue;
	}

	getSessionManager(): SessionManager {
		return this.manager;
	}

	getState(): SessionRuntimeState {
		const sessionFile = this.manager.getSessionFile();
		return {
			sessionId: this.manager.getSessionId(),
			...(sessionFile === undefined ? {} : { sessionFile }),
			sessionName: this.manager.getSessionName(),
			cwd: this.manager.getHeader().cwd,
			leafId: this.manager.getLeafId(),
			tree: this.manager.getTree(),
			isCompacting: this.isCompacting,
			isStreaming: this.agent.state.isStreaming,
		};
	}

	getContextUsage(): ContextUsageSnapshot | undefined {
		return getContextUsageSnapshot({
			entries: this.manager.getEntries(),
			leafId: this.manager.getLeafId(),
			model: this.agent.state.model,
		});
	}

	getAutoCompactionSettings() {
		return this.autoCompactionSettings;
	}

	async newSession(options: { cwd?: string; inMemory?: boolean } = {}): Promise<SessionManager> {
		await this.pauseAgent();
		this.pendingAutoCompaction = null;
		this.manager = options.inMemory
			? await SessionManager.inMemory(options.cwd ?? this.manager.getHeader().cwd, {
				sessionDir: this.manager.getStorageRoot(),
			})
			: await SessionManager.create({
				cwd: options.cwd ?? this.manager.getHeader().cwd,
				sessionDir: this.manager.getStorageRoot(),
			});
		await this.initializeSessionState();
		await this.restoreIntoAgent();
		return this.manager;
	}

	async switchSession(session: string | SessionManager): Promise<SessionManager> {
		await this.pauseAgent();
		this.pendingAutoCompaction = null;
		this.manager = typeof session === "string" ? await SessionManager.open(session, { sessionDir: this.manager.getStorageRoot() }) : session;
		await this.restoreIntoAgent();
		return this.manager;
	}

	async fork(options: SessionForkOptions = {}): Promise<{ session: SessionManager; editorText: string | null }> {
		await this.pauseAgent();
		this.pendingAutoCompaction = null;
		const sourceId = options.fromId === undefined ? this.manager.getLeafId() : options.fromId;
		const resolvedTarget = this.resolveEditableTarget(sourceId);
		const session = await this.manager.createBranchedSession({
			...options,
			fromId: resolvedTarget.leafId,
		});
		this.manager = session;
		await this.restoreIntoAgent();
		return { session, editorText: resolvedTarget.editorText };
	}

	async navigateTree(
		targetId: string | null,
		options: {
			summarize?: boolean;
			generateSummary?: BranchSummaryGenerator;
			summary?: BranchSummaryResult;
			signal?: AbortSignal;
		} = {},
	): Promise<{ leafId: string | null; editorText: string | null }> {
		await this.pauseAgent();
		this.pendingAutoCompaction = null;
		const resolvedTarget = this.resolveEditableTarget(targetId);
		if (options.summarize) {
			const summaryResult =
				options.summary ??
				(options.generateSummary
					? await generateBranchSummary({
						entries: this.manager.getEntries(),
						fromId: this.manager.getLeafId(),
						targetId: resolvedTarget.leafId,
						generate: options.generateSummary,
						...(options.signal === undefined ? {} : { signal: options.signal }),
					})
					: null);
			if (summaryResult) {
				await this.manager.branchWithSummary(resolvedTarget.leafId, summaryResult.summary, summaryResult.details);
			} else if (resolvedTarget.leafId === null) {
				this.manager.resetLeaf();
			} else {
				this.manager.branch(resolvedTarget.leafId);
			}
		} else if (resolvedTarget.leafId === null) {
			this.manager.resetLeaf();
		} else {
			this.manager.branch(resolvedTarget.leafId);
		}

		await this.restoreIntoAgent();
		return {
			leafId: this.manager.getLeafId(),
			editorText: resolvedTarget.editorText,
		};
	}

	async compact(options: {
		generateSummary: CompactionSummaryGenerator;
		settings?: CompactionSettings;
		signal?: AbortSignal;
	}): Promise<CompactionEntry> {
		await this.pauseAgent();
		this.isCompacting = true;
		try {
			const entry = await compact(this.manager, {
				generateSummary: options.generateSummary,
				...(options.settings === undefined ? {} : { settings: options.settings }),
				...(options.signal === undefined ? {} : { signal: options.signal }),
			});
			await this.restoreIntoAgent();
			return entry;
		} finally {
			this.isCompacting = false;
		}
	}

	async setModel(model: Model<any>): Promise<void> {
		this.agent.setModel(model);
		await this.manager.appendModelChange(toModelRef(model));
	}

	async setThinkingLevel(level: SessionThinkingLevel): Promise<void> {
		this.agent.setThinkingLevel(level as ThinkingLevel);
		await this.manager.appendThinkingLevelChange(level);
	}

	async setSessionName(name: string | null): Promise<void> {
		await this.manager.appendSessionInfo({ name });
	}

	async setLabel(targetId: string | null, label: string | null): Promise<void> {
		await this.manager.appendLabelChange(targetId, label);
	}

	async listSessions(cwd: string = this.manager.getHeader().cwd): Promise<SessionInfo[]> {
		return SessionManager.list(cwd, this.manager.getStorageRoot());
	}

	private emitRuntimeEvent(event: SessionRuntimeEvent): void {
		for (const listener of this.runtimeListeners) {
			listener(event);
		}
	}

	private resolveEditableTarget(targetId: string | null): { leafId: string | null; editorText: string | null } {
		if (targetId === null) {
			return { leafId: null, editorText: null };
		}
		const entry = this.manager.getEntry(targetId);
		const editorText = extractUserMessageText(entry);
		if (editorText !== null && entry) {
			return {
				leafId: entry.parentId,
				editorText,
			};
		}
		return {
			leafId: targetId,
			editorText: null,
		};
	}

	private shouldSuppressMessagePersistence(message: Parameters<SessionManager["appendMessage"]>[0]): boolean {
		return Boolean(
			this.autoCompactionSettings.enabled &&
				this.autoCompactionSettings.retryOnOverflow &&
				message.role === "assistant" &&
				message.stopReason === "error" &&
				isContextOverflowError(message.errorMessage),
		);
	}

	private resolvePendingAutoCompaction(message: Extract<Parameters<SessionManager["appendMessage"]>[0], { role: "assistant" }>) {
		if (!this.autoCompactionSettings.enabled || this.isCompacting || message.stopReason === "aborted") {
			return null;
		}
		if (message.stopReason === "error" && this.autoCompactionSettings.retryOnOverflow && isContextOverflowError(message.errorMessage)) {
			return { reason: "overflow" as const, willRetry: true };
		}
		const usage = this.getContextUsage();
		if (shouldAutoCompact(usage, this.autoCompactionSettings)) {
			return { reason: "threshold" as const, willRetry: false };
		}
		return null;
	}

	private async handleAgentEvent(event: AgentEvent): Promise<void> {
		if (event.type === "message_end") {
			if (!isPersistableMessage(event.message)) {
				return;
			}
			if (this.shouldSuppressMessagePersistence(event.message)) {
				return;
			}
			await this.manager.appendMessage(event.message);
			return;
		}

		if (event.type === "turn_end" && event.message.role === "assistant") {
			this.pendingAutoCompaction = this.resolvePendingAutoCompaction(event.message);
			return;
		}

		if (event.type === "agent_end") {
			const pending = this.pendingAutoCompaction;
			this.pendingAutoCompaction = null;
			if (pending) {
				await this.runAutoCompaction(pending.reason, pending.willRetry);
			}
		}
	}

	private async runAutoCompaction(reason: "threshold" | "overflow", willRetry: boolean): Promise<void> {
		if (this.isCompacting) {
			return;
		}
		if (!this.createAutoCompactionSummaryGenerator) {
			return;
		}
		this.isCompacting = true;
		this.emitRuntimeEvent({ type: "auto_compaction_start", reason });
		let result: CompactionEntry | undefined;
		let errorMessage: string | undefined;
		let aborted = false;
		try {
			await this.pauseAgent();
			result = await compact(this.manager, {
				generateSummary: this.createAutoCompactionSummaryGenerator(this.agent.state.model),
				settings: {
					enabled: true,
					keepRecentTokens: this.autoCompactionSettings.keepRecentTokens,
					reserveTokens: this.autoCompactionSettings.reserveTokens,
				},
			});
			await this.restoreIntoAgent();
		} catch (error) {
			errorMessage = error instanceof Error ? error.message : String(error);
			aborted = error instanceof Error && error.name === "AbortError";
			try {
				await this.restoreIntoAgent();
			} catch {
			}
		} finally {
			this.isCompacting = false;
		}
		this.emitRuntimeEvent({
			type: "auto_compaction_end",
			reason,
			...(result === undefined ? {} : { result }),
			aborted,
			willRetry: result !== undefined ? willRetry : false,
			...(errorMessage === undefined ? {} : { errorMessage }),
		});
		if (result && willRetry) {
			await this.agent.continue();
		}
	}

	private async initializeSessionState(): Promise<void> {
		await this.manager.appendModelChange(toModelRef(this.agent.state.model));
		await this.manager.appendThinkingLevelChange(this.agent.state.thinkingLevel);
	}

	private async restoreIntoAgent(): Promise<void> {
		const context = buildSessionContext(this.manager.getEntries(), {
			leafId: this.manager.getLeafId(),
			defaultThinkingLevel: this.defaultThinkingLevel,
		});
		this.agent.reset();
		this.agent.replaceMessages(context.messages);
		this.agent.sessionId = this.manager.getSessionId();
		if (context.model) {
			const model = await this.resolveModel(context.model);
			if (model) {
				this.agent.setModel(model);
			}
		}
		this.agent.setThinkingLevel(context.thinkingLevel as ThinkingLevel);
	}

	private async pauseAgent(): Promise<void> {
		this.agent.abort();
		await this.agent.waitForIdle();
		this.agent.clearAllQueues();
	}
}
