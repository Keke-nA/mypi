import {
	getModel,
	type ImageContent,
	type Message,
	type Model,
	type SimpleStreamOptions,
	streamSimple,
	type TextContent,
	type ThinkingBudgets,
	type Transport,
} from "@mypi/ai";
import { runAgentLoop, runAgentLoopContinue } from "./agent-loop.js";
import type {
	AfterToolCallContext,
	AfterToolCallResult,
	AgentContext,
	AgentEvent,
	AgentLoopConfig,
	AgentMessage,
	AgentState,
	AgentTool,
	BeforeToolCallContext,
	BeforeToolCallResult,
	StreamFn,
	ThinkingLevel,
	ToolExecutionMode,
} from "./types.js";

function defaultConvertToLlm(messages: AgentMessage[]): Message[] {
	return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "toolResult");
}

export interface AgentOptions {
	initialState?: Partial<AgentState>;
	convertToLlm?: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	transformContext?: (messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>;
	steeringMode?: "all" | "one-at-a-time";
	followUpMode?: "all" | "one-at-a-time";
	streamFn?: StreamFn;
	sessionId?: string;
	getApiKey?: (provider: string) => Promise<string | undefined> | string | undefined;
	onPayload?: SimpleStreamOptions["onPayload"];
	thinkingBudgets?: ThinkingBudgets;
	transport?: Transport;
	maxRetryDelayMs?: number;
	toolExecution?: ToolExecutionMode;
	beforeToolCall?: (context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>;
	afterToolCall?: (context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>;
}

export class Agent {
	private _state: AgentState = {
		systemPrompt: "",
		model: getModel("openai", "gpt-4o-mini"),
		thinkingLevel: "off",
		tools: [],
		messages: [],
		isStreaming: false,
		streamMessage: null,
		pendingToolCalls: new Set<string>(),
		error: undefined,
	};

	private listeners = new Set<(e: AgentEvent) => void>();
	private abortController: AbortController | undefined;
	private convertToLlm: (messages: AgentMessage[]) => Message[] | Promise<Message[]>;
	private transformContext: ((messages: AgentMessage[], signal?: AbortSignal) => Promise<AgentMessage[]>) | undefined;
	private steeringQueue: AgentMessage[] = [];
	private followUpQueue: AgentMessage[] = [];
	private steeringMode: "all" | "one-at-a-time";
	private followUpMode: "all" | "one-at-a-time";
	public streamFn: StreamFn;
	private _sessionId: string | undefined;
	public getApiKey: ((provider: string) => Promise<string | undefined> | string | undefined) | undefined;
	private _onPayload: SimpleStreamOptions["onPayload"] | undefined;
	private runningPrompt: Promise<void> | undefined;
	private resolveRunningPrompt: (() => void) | undefined;
	private _thinkingBudgets: ThinkingBudgets | undefined;
	private _transport: Transport;
	private _maxRetryDelayMs: number | undefined;
	private _toolExecution: ToolExecutionMode;
	private _beforeToolCall: ((
		context: BeforeToolCallContext,
		signal?: AbortSignal,
	) => Promise<BeforeToolCallResult | undefined>) | undefined;
	private _afterToolCall: ((
		context: AfterToolCallContext,
		signal?: AbortSignal,
	) => Promise<AfterToolCallResult | undefined>) | undefined;

	constructor(opts: AgentOptions = {}) {
		this._state = { ...this._state, ...opts.initialState };
		this.convertToLlm = opts.convertToLlm || defaultConvertToLlm;
		this.transformContext = opts.transformContext;
		this.steeringMode = opts.steeringMode || "one-at-a-time";
		this.followUpMode = opts.followUpMode || "one-at-a-time";
		this.streamFn = opts.streamFn || streamSimple;
		this._sessionId = opts.sessionId;
		this.getApiKey = opts.getApiKey;
		this._onPayload = opts.onPayload;
		this._thinkingBudgets = opts.thinkingBudgets;
		this._transport = opts.transport ?? "sse";
		this._maxRetryDelayMs = opts.maxRetryDelayMs;
		this._toolExecution = opts.toolExecution ?? "parallel";
		this._beforeToolCall = opts.beforeToolCall;
		this._afterToolCall = opts.afterToolCall;
	}

	get sessionId(): string | undefined {
		return this._sessionId;
	}

	set sessionId(value: string | undefined) {
		this._sessionId = value;
	}

	get thinkingBudgets(): ThinkingBudgets | undefined {
		return this._thinkingBudgets;
	}

	set thinkingBudgets(value: ThinkingBudgets | undefined) {
		this._thinkingBudgets = value;
	}

	get transport(): Transport {
		return this._transport;
	}

	setTransport(value: Transport) {
		this._transport = value;
	}

	get maxRetryDelayMs(): number | undefined {
		return this._maxRetryDelayMs;
	}

	set maxRetryDelayMs(value: number | undefined) {
		this._maxRetryDelayMs = value;
	}

	get toolExecution(): ToolExecutionMode {
		return this._toolExecution;
	}

	setToolExecution(value: ToolExecutionMode) {
		this._toolExecution = value;
	}

	setBeforeToolCall(
		value:
			| ((context: BeforeToolCallContext, signal?: AbortSignal) => Promise<BeforeToolCallResult | undefined>)
			| undefined,
	) {
		this._beforeToolCall = value;
	}

	setAfterToolCall(
		value:
			| ((context: AfterToolCallContext, signal?: AbortSignal) => Promise<AfterToolCallResult | undefined>)
			| undefined,
	) {
		this._afterToolCall = value;
	}

	get state(): AgentState {
		return this._state;
	}

	subscribe(fn: (e: AgentEvent) => void): () => void {
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	setSystemPrompt(v: string) {
		this._state.systemPrompt = v;
	}

	setModel(m: Model<any>) {
		this._state.model = m;
	}

	setThinkingLevel(l: ThinkingLevel) {
		this._state.thinkingLevel = l;
	}

	setSteeringMode(mode: "all" | "one-at-a-time") {
		this.steeringMode = mode;
	}

	getSteeringMode(): "all" | "one-at-a-time" {
		return this.steeringMode;
	}

	setFollowUpMode(mode: "all" | "one-at-a-time") {
		this.followUpMode = mode;
	}

	getFollowUpMode(): "all" | "one-at-a-time" {
		return this.followUpMode;
	}

	setTools(t: AgentTool<any>[]) {
		this._state.tools = t;
	}

	replaceMessages(ms: AgentMessage[]) {
		this._state.messages = ms.slice();
	}

	appendMessage(m: AgentMessage) {
		this._state.messages = [...this._state.messages, m];
	}

	steer(m: AgentMessage) {
		this.steeringQueue.push(m);
	}

	followUp(m: AgentMessage) {
		this.followUpQueue.push(m);
	}

	clearSteeringQueue() {
		this.steeringQueue = [];
	}

	clearFollowUpQueue() {
		this.followUpQueue = [];
	}

	clearAllQueues() {
		this.steeringQueue = [];
		this.followUpQueue = [];
	}

	hasQueuedMessages(): boolean {
		return this.steeringQueue.length > 0 || this.followUpQueue.length > 0;
	}

	private dequeueSteeringMessages(): AgentMessage[] {
		if (this.steeringMode === "one-at-a-time") {
			if (this.steeringQueue.length > 0) {
				const first = this.steeringQueue[0]!;
				this.steeringQueue = this.steeringQueue.slice(1);
				return [first];
			}
			return [];
		}

		const steering = this.steeringQueue.slice();
		this.steeringQueue = [];
		return steering;
	}

	private dequeueFollowUpMessages(): AgentMessage[] {
		if (this.followUpMode === "one-at-a-time") {
			if (this.followUpQueue.length > 0) {
				const first = this.followUpQueue[0]!;
				this.followUpQueue = this.followUpQueue.slice(1);
				return [first];
			}
			return [];
		}

		const followUp = this.followUpQueue.slice();
		this.followUpQueue = [];
		return followUp;
	}

	clearMessages() {
		this._state.messages = [];
	}

	abort() {
		this.abortController?.abort();
	}

	waitForIdle(): Promise<void> {
		return this.runningPrompt ?? Promise.resolve();
	}

	reset() {
		this._state.messages = [];
		this._state.isStreaming = false;
		this._state.streamMessage = null;
		this._state.pendingToolCalls = new Set<string>();
		this._state.error = undefined;
		this.steeringQueue = [];
		this.followUpQueue = [];
	}

	async prompt(message: AgentMessage | AgentMessage[]): Promise<void>;
	async prompt(input: string, images?: ImageContent[]): Promise<void>;
	async prompt(input: string | AgentMessage | AgentMessage[], images?: ImageContent[]) {
		if (this._state.isStreaming) {
			throw new Error(
				"Agent is already processing a prompt. Use steer() or followUp() to queue messages, or wait for completion.",
			);
		}

		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		let msgs: AgentMessage[];

		if (Array.isArray(input)) {
			msgs = input;
		} else if (typeof input === "string") {
			const content: Array<TextContent | ImageContent> = [{ type: "text", text: input }];
			if (images && images.length > 0) {
				content.push(...images);
			}
			msgs = [
				{
					role: "user",
					content,
					timestamp: Date.now(),
				},
			];
		} else {
			msgs = [input];
		}

		await this._runLoop(msgs);
	}

	async continue() {
		if (this._state.isStreaming) {
			throw new Error("Agent is already processing. Wait for completion before continuing.");
		}

		const messages = this._state.messages;
		if (messages.length === 0) {
			throw new Error("No messages to continue from");
		}
		const lastMessage = messages[messages.length - 1];
		if (lastMessage && lastMessage.role === "assistant") {
			const queuedSteering = this.dequeueSteeringMessages();
			if (queuedSteering.length > 0) {
				await this._runLoop(queuedSteering, { skipInitialSteeringPoll: true });
				return;
			}

			const queuedFollowUp = this.dequeueFollowUpMessages();
			if (queuedFollowUp.length > 0) {
				await this._runLoop(queuedFollowUp);
				return;
			}

			throw new Error("Cannot continue from message role: assistant");
		}

		await this._runLoop(undefined);
	}

	private _processLoopEvent(event: AgentEvent): void {
		switch (event.type) {
			case "message_start":
				this._state.streamMessage = event.message;
				break;

			case "message_update":
				this._state.streamMessage = event.message;
				break;

			case "message_end":
				this._state.streamMessage = null;
				this.appendMessage(event.message);
				break;

			case "tool_execution_start": {
				const pendingToolCalls = new Set(this._state.pendingToolCalls);
				pendingToolCalls.add(event.toolCallId);
				this._state.pendingToolCalls = pendingToolCalls;
				break;
			}

			case "tool_execution_end": {
				const pendingToolCalls = new Set(this._state.pendingToolCalls);
				pendingToolCalls.delete(event.toolCallId);
				this._state.pendingToolCalls = pendingToolCalls;
				break;
			}

			case "turn_end":
				if (event.message.role === "assistant" && (event.message as any).errorMessage) {
					this._state.error = (event.message as any).errorMessage;
				}
				break;

			case "agent_end":
				this._state.isStreaming = false;
				this._state.streamMessage = null;
				break;
		}

		this.emit(event);
	}

	private async _runLoop(messages?: AgentMessage[], options?: { skipInitialSteeringPoll?: boolean }) {
		const model = this._state.model;
		if (!model) throw new Error("No model configured");

		this.runningPrompt = new Promise<void>((resolve) => {
			this.resolveRunningPrompt = resolve;
		});

		this.abortController = new AbortController();
		this._state.isStreaming = true;
		this._state.streamMessage = null;
		this._state.error = undefined;

		const reasoning = this._state.thinkingLevel === "off" ? undefined : this._state.thinkingLevel;

		const context: AgentContext = {
			systemPrompt: this._state.systemPrompt,
			messages: this._state.messages.slice(),
			tools: this._state.tools,
		};

		let skipInitialSteeringPoll = options?.skipInitialSteeringPoll === true;

		const config: AgentLoopConfig = {
			model,
			transport: this._transport,
			toolExecution: this._toolExecution,
			convertToLlm: this.convertToLlm,
			getSteeringMessages: async () => {
				if (skipInitialSteeringPoll) {
					skipInitialSteeringPoll = false;
					return [];
				}
				return this.dequeueSteeringMessages();
			},
			getFollowUpMessages: async () => this.dequeueFollowUpMessages(),
			...(reasoning ? { reasoning } : {}),
			...(this._sessionId ? { sessionId: this._sessionId } : {}),
			...(this._onPayload ? { onPayload: this._onPayload } : {}),
			...(this._thinkingBudgets ? { thinkingBudgets: this._thinkingBudgets } : {}),
			...(typeof this._maxRetryDelayMs === "number" ? { maxRetryDelayMs: this._maxRetryDelayMs } : {}),
			...(this._beforeToolCall ? { beforeToolCall: this._beforeToolCall } : {}),
			...(this._afterToolCall ? { afterToolCall: this._afterToolCall } : {}),
			...(this.transformContext ? { transformContext: this.transformContext } : {}),
			...(this.getApiKey ? { getApiKey: this.getApiKey } : {}),
		};

		try {
			if (messages) {
				await runAgentLoop(
					messages,
					context,
					config,
					async (event) => this._processLoopEvent(event),
					this.abortController.signal,
					this.streamFn,
				);
			} else {
				await runAgentLoopContinue(
					context,
					config,
					async (event) => this._processLoopEvent(event),
					this.abortController.signal,
					this.streamFn,
				);
			}
		} catch (err: any) {
			const errorMsg: AgentMessage = {
				role: "assistant",
				content: [{ type: "text", text: "" }],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: this.abortController?.signal.aborted ? "aborted" : "error",
				errorMessage: err?.message || String(err),
				timestamp: Date.now(),
			} as AgentMessage;

			this.appendMessage(errorMsg);
			this._state.error = err?.message || String(err);
			this.emit({ type: "agent_end", messages: [errorMsg] });
		} finally {
			this._state.isStreaming = false;
			this._state.streamMessage = null;
			this._state.pendingToolCalls = new Set<string>();
			this.abortController = undefined;
			this.resolveRunningPrompt?.();
			this.runningPrompt = undefined;
			this.resolveRunningPrompt = undefined;
		}
	}

	private emit(e: AgentEvent) {
		for (const listener of this.listeners) {
			listener(e);
		}
	}
}
