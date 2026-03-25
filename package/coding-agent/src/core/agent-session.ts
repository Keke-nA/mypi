import { Agent, type AgentOptions } from "@mypi/agent";
import type { Model } from "@mypi/ai";
import { convertToLlm } from "./messages.js";
import {
	SessionRuntime,
	type SessionRuntimeCreateOptions,
	type SessionRuntimeEvent,
} from "./session-runtime.js";
import type {
	CompactionEntry,
	SessionForkOptions,
	SessionThinkingLevel,
} from "./session-types.js";
import type { BranchSummaryGenerator } from "./branch-summarization.js";
import type { CompactionSettings, CompactionSummaryGenerator } from "./session-compaction.js";

export interface AgentSessionCreateOptions extends Omit<SessionRuntimeCreateOptions, "agent"> {
	agent?: Agent;
	agentOptions?: AgentOptions;
}

export class AgentSession {
	static async create(options: AgentSessionCreateOptions = {}): Promise<AgentSession> {
		const agent =
			options.agent ??
			new Agent({
				...options.agentOptions,
				convertToLlm: options.agentOptions?.convertToLlm ?? convertToLlm,
			});
		const runtime = await SessionRuntime.create({
			agent,
			...(options.cwd === undefined ? {} : { cwd: options.cwd }),
			...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
			...(options.sessionFile === undefined ? {} : { sessionFile: options.sessionFile }),
			...(options.continueRecent === undefined ? {} : { continueRecent: options.continueRecent }),
			...(options.inMemory === undefined ? {} : { inMemory: options.inMemory }),
			...(options.resolveModel === undefined ? {} : { resolveModel: options.resolveModel }),
			...(options.defaultThinkingLevel === undefined ? {} : { defaultThinkingLevel: options.defaultThinkingLevel }),
		});
		return new AgentSession(agent, runtime);
	}

	private constructor(
		public readonly agent: Agent,
		public readonly runtime: SessionRuntime,
	) {}

	get state() {
		return {
			agent: this.agent.state,
			session: this.runtime.getState(),
		};
	}

	async prompt(...args: Parameters<Agent["prompt"]>) {
		await (this.agent.prompt as (...params: Parameters<Agent["prompt"]>) => Promise<void>)(...args);
		await this.runtime.waitForSettled();
	}

	async continue() {
		await this.agent.continue();
		await this.runtime.waitForSettled();
	}

	abort() {
		this.agent.abort();
	}

	waitForIdle() {
		return this.agent.waitForIdle();
	}

	newSession(options?: { cwd?: string; inMemory?: boolean }) {
		return this.runtime.newSession(options);
	}

	switchSession(session: string) {
		return this.runtime.switchSession(session);
	}

	listAllSessions() {
		return this.runtime.listAllSessions();
	}

	deleteSession(sessionPath?: string) {
		return this.runtime.deleteSession(sessionPath);
	}

	fork(options?: SessionForkOptions) {
		return this.runtime.fork(options);
	}

	navigateTree(
		targetId: string | null,
		options?: { summarize?: boolean; generateSummary?: BranchSummaryGenerator; signal?: AbortSignal },
	) {
		return this.runtime.navigateTree(targetId, options);
	}

	compact(options: { generateSummary: CompactionSummaryGenerator; settings?: CompactionSettings; signal?: AbortSignal }) {
		return this.runtime.compact(options);
	}

	setModel(model: Model<any>) {
		return this.runtime.setModel(model);
	}

	setThinkingLevel(level: SessionThinkingLevel) {
		return this.runtime.setThinkingLevel(level);
	}

	setSessionName(name: string | null) {
		return this.runtime.setSessionName(name);
	}

	setLabel(targetId: string | null, label: string | null) {
		return this.runtime.setLabel(targetId, label);
	}

	getContextUsage() {
		return this.runtime.getContextUsage();
	}

	subscribeRuntime(listener: (event: SessionRuntimeEvent) => void): () => void {
		return this.runtime.subscribe(listener);
	}

	dispose() {
		this.runtime.dispose();
	}
}
