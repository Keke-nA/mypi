import { CombinedAutocompleteProvider, Editor, Key, matchesKey, ProcessTerminal, Text, TUI, type SelectItem } from "@mariozechner/pi-tui";
import type { AssistantMessage, Model } from "@mypi/ai";
import type { AgentEvent } from "@mypi/agent";
import type { AgentSession } from "../core/agent-session.js";
import { createBranchSummaryGenerator, createCompactionSummaryGenerator } from "../core/summary-generators.js";
import { messageToText } from "../core/messages.js";
import { resolveOpenAIModel } from "../core/model-utils.js";
import type { SessionEntry, SessionThinkingLevel } from "../core/session-types.js";
import { showSelectOverlay } from "./select-overlay.js";
import { mypiEditorTheme, mypiSelectListTheme, uiColors } from "./theme.js";

export interface InteractiveAppOptions {
	cwd: string;
	baseUrl?: string;
	sessionDir?: string;
	inMemory?: boolean;
	modelChoices?: string[];
	configSummary?: string;
	activePresetName?: string;
	warnings?: string[];
	onExit?: () => void;
}

interface LocalNotice {
	kind: "info" | "error";
	text: string;
}

export class InteractiveApp {
	private readonly terminal = new ProcessTerminal();
	private readonly tui = new TUI(this.terminal);
	private readonly header = new Text("", 1, 0);
	private readonly status = new Text("", 1, 0);
	private readonly transcript = new Text("", 1, 0);
	private readonly editor: Editor;
	private readonly notices: LocalNotice[] = [];
	private readonly unsubscribe: () => void;
	private running = false;
	private quitting = false;

	constructor(
		private readonly session: AgentSession,
		private readonly options: InteractiveAppOptions,
	) {
		this.editor = new Editor(this.tui, mypiEditorTheme, { paddingX: 1 });
		this.editor.setAutocompleteProvider(
			new CombinedAutocompleteProvider(
				[
					{ name: "help", description: "Show command help" },
					{ name: "config", description: "Show resolved config" },
					{ name: "session", description: "Show current session info" },
					{ name: "new", description: "Start a new session" },
					{ name: "sessions", description: "Open session selector" },
					{ name: "resume", description: "Resume a session" },
					{ name: "tree", description: "Open tree navigator" },
					{ name: "fork", description: "Fork current session or selected node" },
					{ name: "compact", description: "Compact current branch" },
					{ name: "model", description: "Show or change model" },
					{ name: "thinking", description: "Show or change thinking level" },
					{ name: "name", description: "Rename current session" },
					{ name: "exit", description: "Exit mypi" },
				],
				this.options.cwd,
			),
		);
		this.editor.onSubmit = (text: string) => {
			this.editor.addToHistory(text);
			void this.handleSubmit(text);
		};

		this.tui.addChild(this.header);
		this.tui.addChild(this.status);
		this.tui.addChild(this.transcript);
		this.tui.addChild(this.editor);
		this.tui.setFocus(this.editor);
		this.unsubscribe = this.session.agent.subscribe((event) => this.handleAgentEvent(event));
		this.tui.addInputListener((data) => {
			if (matchesKey(data, Key.ctrl("c"))) {
				if (this.session.agent.state.isStreaming) {
					this.session.abort();
					this.pushNotice("info", "Aborting current turn...");
					this.refresh();
					return { consume: true };
				}
				void this.shutdown();
				return { consume: true };
			}
			return undefined;
		});
		for (const warning of this.options.warnings ?? []) {
			this.pushNotice("error", warning);
		}
		this.refresh();
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.tui.start();
	}

	async shutdown(): Promise<void> {
		if (this.quitting) return;
		this.quitting = true;
		this.session.abort();
		await this.session.waitForIdle();
		this.unsubscribe();
		this.session.dispose();
		this.tui.stop();
		this.options.onExit?.();
	}

	private handleAgentEvent(event: AgentEvent): void {
		if (event.type === "tool_execution_start") {
			this.pushNotice("info", `tool:${event.toolName} ${JSON.stringify(event.args)}`);
		}
		if (event.type === "turn_end" && event.message.role === "assistant" && event.message.errorMessage) {
			this.pushNotice("error", event.message.errorMessage);
		}
		if (event.type === "agent_end") {
			this.editor.disableSubmit = false;
		}
		this.refresh();
	}

	private async handleSubmit(text: string): Promise<void> {
		const trimmed = text.trim();
		if (!trimmed) {
			return;
		}
		this.editor.setText("");
		this.refresh();
		try {
			if (trimmed.startsWith("/")) {
				const keepRunning = await this.handleCommand(trimmed);
				if (!keepRunning) {
					await this.shutdown();
				}
				return;
			}

			this.editor.disableSubmit = true;
			this.refresh();
			await this.session.prompt(trimmed);
		} catch (error) {
			this.editor.disableSubmit = false;
			this.pushNotice("error", error instanceof Error ? error.message : String(error));
			this.refresh();
		}
	}

	private async handleCommand(input: string): Promise<boolean> {
		const [command, ...rest] = input.trim().split(/\s+/);
		switch (command) {
			case "/help":
				this.pushNotice(
					"info",
					[
						"Commands:",
						"/config /session /new /sessions /resume /tree /fork /compact /model /thinking /name /exit",
					].join("\n"),
				);
				this.refresh();
				return true;
			case "/config":
				this.pushNotice("info", this.options.configSummary ?? "No config summary available.");
				this.refresh();
				return true;
			case "/exit":
			case "/quit":
				return false;
			case "/session":
				this.pushNotice("info", this.describeSession());
				this.refresh();
				return true;
			case "/new":
				await this.session.newSession({
					cwd: this.options.cwd,
					...(this.options.inMemory ? { inMemory: true } : {}),
				});
				this.pushNotice("info", "Started a new session.");
				this.refresh();
				return true;
			case "/sessions":
				await this.resumeFromSelector();
				return true;
			case "/resume":
				if (rest.length === 0) {
					await this.resumeFromSelector();
				} else {
					await this.resumeByValue(rest.join(" "));
				}
				return true;
			case "/tree":
				if (rest.length === 0) {
					await this.navigateTreeSelector();
				} else {
					const summarize = rest.includes("--summary");
					const rawId = rest.find((value) => value !== "--summary")!;
					const targetId = this.resolveEntryId(rawId);
					await this.navigateTo(targetId, summarize);
				}
				return true;
			case "/fork": {
				if (rest.length === 0) {
					const currentLeaf = this.session.runtime.getSessionManager().getLeafId();
					const result = await this.session.fork({ cwd: this.options.cwd, ...(this.options.sessionDir === undefined ? {} : { sessionDir: this.options.sessionDir }), ...(this.options.inMemory ? { inMemory: true } : {}), ...(currentLeaf === null ? {} : { fromId: currentLeaf }) });
					if (result.editorText) this.editor.setText(result.editorText);
				} else {
					const targetId = this.resolveEntryId(rest[0]!);
					const result = await this.session.fork({ cwd: this.options.cwd, ...(this.options.sessionDir === undefined ? {} : { sessionDir: this.options.sessionDir }), ...(this.options.inMemory ? { inMemory: true } : {}), ...(targetId === null ? {} : { fromId: targetId }) });
					if (result.editorText) this.editor.setText(result.editorText);
				}
				this.pushNotice("info", "Forked session.");
				this.refresh();
				return true;
			}
			case "/compact":
				await this.session.compact({
					generateSummary: createCompactionSummaryGenerator(this.session.agent.state.model as Model<any>),
					settings: { keepRecentTokens: 12_000 },
				});
				this.pushNotice("info", "Compaction complete.");
				this.refresh();
				return true;
			case "/model":
				if (rest.length === 0) {
					const selected = await this.selectModel();
					if (selected) {
						await this.session.setModel(resolveOpenAIModel(selected, this.options.baseUrl));
						this.pushNotice("info", `model -> ${selected}`);
					}
				} else {
					await this.session.setModel(resolveOpenAIModel(rest[0]!, this.options.baseUrl));
					this.pushNotice("info", `model -> ${rest[0]}`);
				}
				this.refresh();
				return true;
			case "/thinking":
				if (rest.length === 0) {
					const selected = await this.selectThinkingLevel();
					if (selected) {
						await this.session.setThinkingLevel(selected as SessionThinkingLevel);
						this.pushNotice("info", `thinking -> ${selected}`);
					}
				} else {
					await this.session.setThinkingLevel(rest[0]! as SessionThinkingLevel);
					this.pushNotice("info", `thinking -> ${rest[0]}`);
				}
				this.refresh();
				return true;
			case "/name":
				await this.session.setSessionName(rest.join(" ").trim() || null);
				this.pushNotice("info", `session name -> ${rest.join(" ").trim() || "(cleared)"}`);
				this.refresh();
				return true;
			default:
				throw new Error(`Unknown command: ${command}`);
		}
	}

	private async resumeFromSelector(): Promise<void> {
		const items = await this.session.runtime.listSessions();
		if (items.length === 0) {
			this.pushNotice("info", "No sessions found for this workspace.");
			this.refresh();
			return;
		}
		const selected = await showSelectOverlay({
			tui: this.tui,
			title: "Resume Session",
			items: items.map((item, index) => ({
				value: item.path,
				label: `${index + 1}. ${item.name ?? "(unnamed)"}`,
				description: `${item.modified} • ${item.messageCount} messages`,
			})),
			theme: mypiSelectListTheme,
		});
		if (!selected) return;
		await this.session.switchSession(selected.value);
		this.pushNotice("info", "Resumed session.");
		this.refresh();
	}

	private async resumeByValue(value: string): Promise<void> {
		const sessions = await this.session.runtime.listSessions();
		const index = Number(value);
		if (Number.isInteger(index) && index >= 1 && index <= sessions.length) {
			await this.session.switchSession(sessions[index - 1]!.path);
			this.pushNotice("info", "Resumed session.");
			this.refresh();
			return;
		}
		await this.session.switchSession(value);
		this.pushNotice("info", "Resumed session.");
		this.refresh();
	}

	private async navigateTreeSelector(): Promise<void> {
		const items = this.buildTreeItems();
		const selected = await showSelectOverlay({
			tui: this.tui,
			title: "Session Tree",
			items,
			theme: mypiSelectListTheme,
		});
		if (!selected) return;
		const targetId = selected.value === "root" ? null : selected.value;
		const action = await showSelectOverlay({
			tui: this.tui,
			title: "Tree Action",
			items: [
				{ value: "navigate", label: "Navigate", description: "Switch leaf without summary" },
				{ value: "summary", label: "Navigate + Summary", description: "Append branch_summary before switching" },
			],
			theme: mypiSelectListTheme,
		});
		if (!action) return;
		await this.navigateTo(targetId, action.value === "summary");
	}

	private async navigateTo(targetId: string | null, summarize: boolean): Promise<void> {
		const result = await this.session.navigateTree(
			targetId,
			summarize
				? {
					summarize: true,
					generateSummary: createBranchSummaryGenerator(this.session.agent.state.model as Model<any>),
				}
				: undefined,
		);
		if (result.editorText) {
			this.editor.setText(result.editorText);
		}
		this.pushNotice("info", `leaf -> ${result.leafId ?? "root"}`);
		this.refresh();
	}

	private async selectModel(): Promise<string | null> {
		const items = (this.options.modelChoices ?? ["gpt-4o-mini", "gpt-5-mini", "gpt-5.4"]).map((model) => ({
			value: model,
			label: model,
			...(model === this.session.agent.state.model.id ? { description: "current" } : {}),
		}));
		const selected = await showSelectOverlay({
			tui: this.tui,
			title: "Select Model",
			items,
			theme: mypiSelectListTheme,
		});
		return selected?.value ?? null;
	}

	private async selectThinkingLevel(): Promise<string | null> {
		const levels = ["off", "minimal", "low", "medium", "high", "xhigh"];
		const selected = await showSelectOverlay({
			tui: this.tui,
			title: "Select Thinking Level",
			items: levels.map((level) => ({
				value: level,
				label: level,
				...(level === this.session.agent.state.thinkingLevel ? { description: "current" } : {}),
			})),
			theme: mypiSelectListTheme,
		});
		return selected?.value ?? null;
	}

	private buildTreeItems(): SelectItem[] {
		const manager = this.session.runtime.getSessionManager();
		const items: SelectItem[] = [{ value: "root", label: "root", description: "Before the first entry" }];
		for (const entry of manager.getEntries()) {
			items.push({
				value: entry.id,
				label: `${entry.id.slice(0, 8)} ${this.entryLabel(entry)}`,
				description: entry.timestamp,
			});
		}
		return items;
	}

	private resolveEntryId(raw: string): string | null {
		if (raw === "root" || raw === "null") {
			return null;
		}
		const entries = this.session.runtime.getSessionManager().getEntries();
		const exact = entries.find((entry) => entry.id === raw);
		if (exact) return exact.id;
		const prefixMatches = entries.filter((entry) => entry.id.startsWith(raw));
		if (prefixMatches.length === 1) return prefixMatches[0]!.id;
		if (prefixMatches.length > 1) throw new Error(`Ambiguous entry id prefix: ${raw}`);
		throw new Error(`Unknown entry id: ${raw}`);
	}

	private describeSession(): string {
		const state = this.session.state;
		return [
			`sessionId: ${state.session.sessionId}`,
			`sessionFile: ${state.session.sessionFile ?? "(in-memory)"}`,
			`sessionName: ${state.session.sessionName ?? "(unnamed)"}`,
			`leafId: ${state.session.leafId ?? "root"}`,
			`model: ${state.agent.model.provider}/${state.agent.model.id}`,
			`thinking: ${state.agent.thinkingLevel}`,
		].join("\n");
	}

	private entryLabel(entry: SessionEntry): string {
		switch (entry.type) {
			case "message":
				return `${entry.message.role}: ${this.shorten(messageToText(entry.message))}`;
			case "branch_summary":
				return `branch_summary: ${this.shorten(entry.summary)}`;
			case "compaction":
				return `compaction: ${this.shorten(entry.summary)}`;
			case "model_change":
				return `model -> ${entry.model.modelId}`;
			case "thinking_level_change":
				return `thinking -> ${entry.level}`;
			case "session_info":
				return `name -> ${entry.name ?? "(cleared)"}`;
			case "label":
				return `label -> ${entry.label ?? "(cleared)"}`;
			case "custom_message":
				return `custom: ${this.shorten(messageToText(entry.message))}`;
			case "custom":
				return `custom: ${entry.name}`;
		}
	}

	private pushNotice(kind: LocalNotice["kind"], text: string): void {
		this.notices.push({ kind, text });
		if (this.notices.length > 12) {
			this.notices.splice(0, this.notices.length - 12);
		}
	}

	private refresh(): void {
		this.header.setText(this.renderHeaderText());
		this.status.setText(this.renderStatusText());
		this.transcript.setText(this.renderTranscriptText());
		this.tui.requestRender();
	}

	private renderHeaderText(): string {
		return [
			uiColors.header("mypi"),
			uiColors.muted(`workspace: ${this.options.cwd}`),
		].join("\n");
	}

	private renderStatusText(): string {
		const state = this.session.state;
		const pendingTools = state.agent.pendingToolCalls.size;
		const presetPart = this.options.activePresetName ? `${uiColors.accent("preset")} ${this.options.activePresetName}` : undefined;
		return [
			`${uiColors.accent("session")} ${state.session.sessionName ?? state.session.sessionId}`,
			[presetPart, `${uiColors.accent("model")} ${state.agent.model.id}`, `${uiColors.accent("thinking")} ${state.agent.thinkingLevel}`, `${uiColors.accent("leaf")} ${state.session.leafId ? state.session.leafId.slice(0, 8) : "root"}`].filter(Boolean).join("   "),
			`${uiColors.accent("streaming")} ${state.agent.isStreaming ? "yes" : "no"}   ${uiColors.accent("pending tools")} ${pendingTools}`,
		].join("\n");
	}

	private renderTranscriptText(): string {
		const blocks: string[] = [];
		for (const notice of this.notices) {
			const style = notice.kind === "error" ? uiColors.error : uiColors.notice;
			blocks.push(style(`[${notice.kind}] ${notice.text}`));
		}
		for (const message of this.session.agent.state.messages) {
			blocks.push(this.renderMessageBlock(message.role, messageToText(message)));
		}
		const stream = this.session.agent.state.streamMessage;
		if (stream && stream.role === "assistant") {
			blocks.push(this.renderMessageBlock("assistant", this.extractAssistantText(stream), true));
		}
		return blocks.join("\n\n");
	}

	private renderMessageBlock(role: string, text: string, streaming = false): string {
		const label = streaming ? `${role} (stream)` : role;
		const style = role === "user"
			? uiColors.user
			: role === "assistant"
				? uiColors.assistant
				: role === "toolResult"
					? uiColors.tool
					: uiColors.subtle;
		return `${style(uiColors.bold(label))}\n${text || uiColors.muted("(empty)")}`;
	}

	private extractAssistantText(message: AssistantMessage): string {
		return message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("")
			.trim();
	}

	private shorten(text: string, max = 80): string {
		return text.length > max ? `${text.slice(0, max - 1)}…` : text;
	}
}
