#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import path from "node:path";
import { configureAI, type AssistantMessage, type Model } from "@mypi/ai";
import { Agent } from "@mypi/agent";
import {
	AgentSession,
	InteractiveApp,
	convertToLlm,
	createBranchSummaryGenerator,
	createCodingSystemPrompt,
	createCompactionSummaryGenerator,
	createWorkspaceTools,
	formatLoadedConfig,
	loadAgentConfig,
	messageToText,
	resolveOpenAIModel,
	resolvePersistedModel,
	type LoadedAgentConfig,
	type SessionEntry,
	type SessionThinkingLevel,
	type WorkspaceToolName,
} from "../index.js";

interface CliOptions {
	apiKey: string;
	baseUrl?: string;
	modelId: string;
	thinkingLevel: SessionThinkingLevel;
	cwd: string;
	sessionDir?: string;
	sessionFile?: string;
	continueRecent: boolean;
	inMemory: boolean;
	activeTools: WorkspaceToolName[];
	prompt?: string;
	uiMode: "auto" | "tui" | "plain";
	systemPromptAppend?: string;
	loadedConfig: LoadedAgentConfig;
	printConfig: boolean;
}

interface BootstrapArgs {
	help: boolean;
	cwd: string;
	explicitConfigPath?: string;
	presetName?: string;
}

function usage(): string {
	return [
		"mypi - coding-agent MVP",
		"",
		"Usage:",
		"  mypi [options]",
		"",
		"Options:",
		"  --api-key <key>         OpenAI-compatible API key",
		"  --base-url <url>        OpenAI-compatible base URL",
		"  --model <id>            Model id",
		"  --thinking <level>      off|minimal|low|medium|high|xhigh",
		"  --preset <name>         Activate a preset from presets.json",
		"  --config <path>         Additional config file path",
		"  --print-config          Print resolved config and exit",
		"  --cwd <path>            Workspace root, default: current directory",
		"  --session-dir <path>    Session storage directory",
		"  --session-file <path>   Open a specific session file",
		"  --prompt <text>         Run one prompt and exit",
		"  --new                   Start a fresh session instead of resuming recent",
		"  --in-memory             Keep session only in memory",
		"  --tui                   Force pi-tui interactive mode",
		"  --plain                 Force readline interactive mode",
		"  --no-tools              Disable bash/read/write/edit tools",
		"  --help                  Show this help",
		"",
		"Config files:",
		"  ~/.mypi/agent/config.json",
		"  ~/.mypi/agent/presets.json",
		"  <cwd>/.mypi/config.json",
		"  <cwd>/.mypi/presets.json",
		"",
		"Interactive commands:",
		"  /help                   Show command help",
		"  /config                 Show resolved config",
		"  /session                Show current session info",
		"  /new                    Start a new session",
		"  /sessions               List project sessions",
		"  /resume [index|path]    Resume a listed session",
		"  /tree                   Print session tree",
		"  /tree <id> [--summary]  Navigate to a tree node",
		"  /fork [id]              Fork current session or the given node",
		"  /compact                Compact current branch",
		"  /model [id]             Show or change current model",
		"  /thinking [level]       Show or change thinking level",
		"  /name <text>            Rename current session",
		"  /exit                   Exit",
	].join("\n");
}

function scanBootstrapArgs(argv: string[]): BootstrapArgs {
	let cwd = process.cwd();
	let explicitConfigPath: string | undefined;
	let presetName: string | undefined;
	let help = false;

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]!;
		const next = () => argv[index + 1];
		if (arg === "--help" || arg === "-h") {
			help = true;
			continue;
		}
		if (arg === "--cwd" && next()) {
			cwd = path.resolve(next()!);
			index += 1;
			continue;
		}
		if (arg === "--config" && next()) {
			explicitConfigPath = path.resolve(next()!);
			index += 1;
			continue;
		}
		if (arg === "--preset" && next()) {
			presetName = next()!;
			index += 1;
			continue;
		}
	}

	return {
		help,
		cwd,
		...(explicitConfigPath === undefined ? {} : { explicitConfigPath }),
		...(presetName === undefined ? {} : { presetName }),
	};
}

async function parseArgs(argv: string[]): Promise<CliOptions | { help: true }> {
	const bootstrap = scanBootstrapArgs(argv);
	if (bootstrap.help) {
		return { help: true };
	}

	const loadedConfig = await loadAgentConfig({
		cwd: bootstrap.cwd,
		...(bootstrap.explicitConfigPath === undefined ? {} : { explicitConfigPath: bootstrap.explicitConfigPath }),
		...(bootstrap.presetName === undefined ? {} : { presetName: bootstrap.presetName }),
	});

	const options: CliOptions = {
		apiKey: loadedConfig.settings.apiKey ?? "",
		modelId: loadedConfig.settings.modelId ?? "gpt-5.4",
		thinkingLevel: loadedConfig.settings.thinkingLevel ?? "off",
		cwd: bootstrap.cwd,
		continueRecent: loadedConfig.settings.continueRecent !== false,
		inMemory: false,
		activeTools: loadedConfig.settings.activeTools ?? ["read", "write", "edit", "bash"],
		uiMode: loadedConfig.settings.uiMode ?? "auto",
		loadedConfig,
		printConfig: false,
	};
	if (loadedConfig.settings.baseUrl) {
		options.baseUrl = loadedConfig.settings.baseUrl;
	}
	if (loadedConfig.settings.sessionDir) {
		options.sessionDir = loadedConfig.settings.sessionDir;
	}
	if (loadedConfig.settings.systemPromptAppend) {
		options.systemPromptAppend = loadedConfig.settings.systemPromptAppend;
	}

	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]!;
		const next = () => {
			const value = argv[index + 1];
			if (!value) {
				throw new Error(`Missing value for ${arg}`);
			}
			index += 1;
			return value;
		};

		if (arg === "--api-key") {
			options.apiKey = next();
			continue;
		}
		if (arg === "--base-url") {
			options.baseUrl = next();
			continue;
		}
		if (arg === "--model") {
			options.modelId = next();
			continue;
		}
		if (arg === "--thinking") {
			options.thinkingLevel = next() as SessionThinkingLevel;
			continue;
		}
		if (arg === "--preset") {
			next();
			continue;
		}
		if (arg === "--config") {
			next();
			continue;
		}
		if (arg === "--cwd") {
			options.cwd = path.resolve(next());
			continue;
		}
		if (arg === "--session-dir") {
			options.sessionDir = path.resolve(next());
			continue;
		}
		if (arg === "--session-file") {
			options.sessionFile = path.resolve(next());
			options.continueRecent = false;
			continue;
		}
		if (arg === "--prompt") {
			options.prompt = next();
			continue;
		}
		if (arg === "--new") {
			options.continueRecent = false;
			continue;
		}
		if (arg === "--in-memory") {
			options.inMemory = true;
			options.continueRecent = false;
			continue;
		}
		if (arg === "--tui") {
			options.uiMode = "tui";
			continue;
		}
		if (arg === "--plain") {
			options.uiMode = "plain";
			continue;
		}
		if (arg === "--no-tools") {
			options.activeTools = [];
			continue;
		}
		if (arg === "--print-config") {
			options.printConfig = true;
			continue;
		}
		if (arg === "--help" || arg === "-h") {
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}

	if (!options.apiKey && !options.printConfig) {
		throw new Error("Missing API key. Pass --api-key, set OPENAI_API_KEY, or configure ~/.mypi/agent/config.json.");
	}

	return options;
}

function buildSystemPrompt(cwd: string, appendText?: string): string {
	return appendText ? `${createCodingSystemPrompt(cwd)}\n\n${appendText}` : createCodingSystemPrompt(cwd);
}

function formatEffectiveConfig(options: CliOptions): string {
	const base = formatLoadedConfig(options.loadedConfig);
	const lines = [
		base,
		"",
		"effective CLI/session settings:",
		`cwd: ${options.cwd}`,
		`sessionFile: ${options.sessionFile ?? "(none)"}`,
		`model: ${options.modelId}`,
		`baseUrl: ${options.baseUrl ?? "(default)"}`,
		`thinkingLevel: ${options.thinkingLevel}`,
		`uiMode: ${options.uiMode}`,
		`inMemory: ${options.inMemory ? "true" : "false"}`,
		`continueRecent: ${options.continueRecent ? "true" : "false"}`,
		`activeTools: ${options.activeTools.join(", ") || "(none)"}`,
		`systemPromptAppend: ${options.systemPromptAppend ? JSON.stringify(options.systemPromptAppend) : "(none)"}`,
	];
	return lines.join("\n");
}

function extractAssistantText(message: AssistantMessage): string {
	return message.content.filter((part) => part.type === "text").map((part) => part.text).join("").trim();
}

function shorten(text: string, max = 80): string {
	return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function renderEntryPreview(entry: SessionEntry): string {
	switch (entry.type) {
		case "message":
			return `${entry.message.role}: ${shorten(messageToText(entry.message))}`;
		case "branch_summary":
			return `branch_summary: ${shorten(entry.summary)}`;
		case "compaction":
			return `compaction: ${shorten(entry.summary)}`;
		case "model_change":
			return `model -> ${entry.model.provider}/${entry.model.modelId}`;
		case "thinking_level_change":
			return `thinking -> ${entry.level}`;
		case "session_info":
			return `session name -> ${entry.name ?? "(cleared)"}`;
		case "label":
			return `label -> ${entry.label ?? "(cleared)"}`;
		case "custom_message":
			return `custom_message: ${shorten(messageToText(entry.message))}`;
		case "custom":
			return `custom: ${entry.name}`;
		default:
			return "entry";
	}
}

function resolveEntryId(session: AgentSession, raw: string): string | null {
	if (raw === "root" || raw === "null") {
		return null;
	}
	const entries = session.runtime.getSessionManager().getEntries();
	const exact = entries.find((entry) => entry.id === raw);
	if (exact) {
		return exact.id;
	}
	const prefixMatches = entries.filter((entry) => entry.id.startsWith(raw));
	if (prefixMatches.length === 1) {
		return prefixMatches[0]!.id;
	}
	if (prefixMatches.length > 1) {
		throw new Error(`Ambiguous entry id prefix: ${raw}`);
	}
	throw new Error(`Unknown entry id: ${raw}`);
}

class ConsolePresenter {
	private streamingText = false;

	constructor(private readonly session: AgentSession) {
		this.session.agent.subscribe((event) => {
			switch (event.type) {
				case "message_update":
					if (event.assistantMessageEvent.type === "text_delta") {
						if (!this.streamingText) {
							stdout.write("assistant> ");
							this.streamingText = true;
						}
						stdout.write(event.assistantMessageEvent.delta);
					}
					break;
				case "message_end":
					if (event.message.role === "assistant") {
						if (this.streamingText) {
							stdout.write("\n");
							this.streamingText = false;
						} else {
							const text = extractAssistantText(event.message);
							if (text) {
								stdout.write(`assistant> ${text}\n`);
							}
						}
					}
					if (event.message.role === "toolResult") {
						stdout.write(`tool:${event.message.toolName}> ${messageToText(event.message)}\n`);
					}
					break;
				case "tool_execution_start":
					stdout.write(`tool:${event.toolName} start> ${JSON.stringify(event.args)}\n`);
					break;
				default:
					break;
			}
		});
	}

	printBanner() {
		stdout.write(`mypi ready\nworkspace: ${this.session.state.session.cwd}\nsession: ${this.session.state.session.sessionId}\n`);
		stdout.write("Type /help for commands.\n\n");
	}

	printSessionInfo() {
		const state = this.session.state;
		stdout.write(
			[
				`sessionId: ${state.session.sessionId}`,
				`sessionFile: ${state.session.sessionFile ?? "(in-memory)"}`,
				`sessionName: ${state.session.sessionName ?? "(unnamed)"}`,
				`leafId: ${state.session.leafId ?? "root"}`,
				`model: ${state.agent.model.provider}/${state.agent.model.id}`,
				`thinking: ${state.agent.thinkingLevel}`,
			].join("\n") + "\n",
		);
	}

	printSessions(items: Awaited<ReturnType<AgentSession["runtime"]["listSessions"]>>) {
		if (items.length === 0) {
			stdout.write("No sessions found for current workspace.\n");
			return;
		}
		for (const [index, item] of items.entries()) {
			stdout.write(
				`${index + 1}. ${item.name ?? "(unnamed)"} | messages=${item.messageCount} | modified=${item.modified} | ${item.path}\n`,
			);
		}
	}

	printTree() {
		const manager = this.session.runtime.getSessionManager();
		const state = this.session.state.session;
		const renderNode = (entryId: string | null, prefix: string) => {
			const children = manager.getChildren(entryId);
			for (const [index, child] of children.entries()) {
				const isLast = index === children.length - 1;
				const branchPrefix = `${prefix}${isLast ? "└─" : "├─"}`;
				const marker = child.id === state.leafId ? "*" : " ";
				stdout.write(`${branchPrefix}${marker} ${child.id.slice(0, 8)} ${renderEntryPreview(child)}\n`);
				renderNode(child.id, `${prefix}${isLast ? "  " : "│ "}`);
			}
		};
		stdout.write("root\n");
		renderNode(null, "");
	}
}

async function createSession(options: CliOptions): Promise<AgentSession> {
	configureAI({
		providers: {
			openai: {
				apiKey: options.apiKey,
				...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
			},
		},
	});

	const model = resolveOpenAIModel(options.modelId, options.baseUrl);
	const agent = new Agent({
		initialState: {
			model,
			thinkingLevel: options.thinkingLevel,
		},
		convertToLlm,
		getApiKey: async () => options.apiKey,
	});
	agent.setSystemPrompt(buildSystemPrompt(options.cwd, options.systemPromptAppend));
	agent.setTools(createWorkspaceTools(options.cwd, options.activeTools));

	return AgentSession.create({
		agent,
		cwd: options.cwd,
		...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
		...(options.sessionFile === undefined ? {} : { sessionFile: options.sessionFile }),
		continueRecent: options.continueRecent,
		inMemory: options.inMemory,
		resolveModel: (modelRef) => resolvePersistedModel(modelRef, options.baseUrl),
	});
}

async function handleCommand(
	session: AgentSession,
	presenter: ConsolePresenter,
	rl: ReturnType<typeof createInterface>,
	input: string,
	options: CliOptions,
): Promise<boolean> {
	const [command, ...rest] = input.trim().split(/\s+/);
	const compactGenerator = createCompactionSummaryGenerator(session.agent.state.model as Model<any>);
	const branchGenerator = createBranchSummaryGenerator(session.agent.state.model as Model<any>);

	switch (command) {
		case "/help":
			stdout.write(`${usage()}\n`);
			return true;
		case "/config":
			stdout.write(`${formatEffectiveConfig(options)}\n`);
			return true;
		case "/exit":
		case "/quit":
			return false;
		case "/session":
			presenter.printSessionInfo();
			return true;
		case "/new":
			await session.newSession({ cwd: options.cwd, ...(options.inMemory ? { inMemory: true } : {}) });
			presenter.printSessionInfo();
			return true;
		case "/sessions": {
			const items = await session.runtime.listSessions();
			presenter.printSessions(items);
			return true;
		}
		case "/resume": {
			const items = await session.runtime.listSessions();
			if (rest.length === 0) {
				presenter.printSessions(items);
				const selected = (await rl.question("resume> ")).trim();
				if (!selected) return true;
				rest.push(selected);
			}
			const target = rest.join(" ");
			const index = Number(target);
			if (Number.isInteger(index) && index >= 1 && index <= items.length) {
				await session.switchSession(items[index - 1]!.path);
			} else {
				await session.switchSession(path.resolve(target));
			}
			presenter.printSessionInfo();
			return true;
		}
		case "/tree": {
			if (rest.length === 0) {
				presenter.printTree();
				return true;
			}
			const summarize = rest.includes("--summary");
			const targetArg = rest.find((token) => token !== "--summary");
			if (!targetArg) {
				throw new Error("Usage: /tree <id|root> [--summary]");
			}
			const targetId = resolveEntryId(session, targetArg);
			await session.navigateTree(targetId, summarize ? { summarize: true, generateSummary: branchGenerator } : undefined);
			presenter.printSessionInfo();
			return true;
		}
		case "/fork": {
			const targetId = rest[0] ? resolveEntryId(session, rest[0]) : undefined;
			const result = await session.fork({
				...(targetId === undefined ? {} : { fromId: targetId }),
				cwd: options.cwd,
				...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
				...(options.inMemory ? { inMemory: true } : {}),
			});
			presenter.printSessionInfo();
			if (result.editorText) {
				stdout.write(`fork source prompt> ${result.editorText}\n`);
			}
			return true;
		}
		case "/compact": {
			await session.compact({ generateSummary: compactGenerator, settings: { keepRecentTokens: 12000 } });
			stdout.write("Compaction complete.\n");
			return true;
		}
		case "/model": {
			if (rest.length === 0) {
				stdout.write(`${session.agent.state.model.provider}/${session.agent.state.model.id}\n`);
				return true;
			}
			await session.setModel(resolveOpenAIModel(rest[0]!, options.baseUrl));
			stdout.write(`model -> ${session.agent.state.model.provider}/${session.agent.state.model.id}\n`);
			return true;
		}
		case "/thinking": {
			if (rest.length === 0) {
				stdout.write(`${session.agent.state.thinkingLevel}\n`);
				return true;
			}
			await session.setThinkingLevel(rest[0]! as SessionThinkingLevel);
			stdout.write(`thinking -> ${session.agent.state.thinkingLevel}\n`);
			return true;
		}
		case "/name": {
			const name = rest.join(" ").trim();
			await session.setSessionName(name || null);
			stdout.write(`session name -> ${name || "(cleared)"}\n`);
			return true;
		}
		default:
			throw new Error(`Unknown command: ${command}`);
	}
}

async function runInteractive(session: AgentSession, options: CliOptions) {
	const rl = createInterface({ input: stdin, output: stdout });
	const presenter = new ConsolePresenter(session);
	presenter.printBanner();
	if (options.loadedConfig.warnings.length > 0) {
		stdout.write(`warning> ${options.loadedConfig.warnings.join(" | ")}\n`);
	}

	let running = true;
	while (running) {
		const input = (await rl.question("you> ")).trim();
		if (!input) {
			continue;
		}
		try {
			if (input.startsWith("/")) {
				running = await handleCommand(session, presenter, rl, input, options);
				continue;
			}
			await session.prompt(input);
		} catch (error) {
			stdout.write(`error> ${error instanceof Error ? error.message : String(error)}\n`);
		}
	}

	rl.close();
	session.dispose();
}

function shouldUseTui(options: CliOptions): boolean {
	if (options.prompt) {
		return false;
	}
	if (options.uiMode === "plain") {
		return false;
	}
	if (options.uiMode === "tui") {
		if (!stdin.isTTY || !stdout.isTTY) {
			throw new Error("TUI mode requires a TTY. Use --plain or --prompt in non-interactive environments.");
		}
		return true;
	}
	return Boolean(stdin.isTTY && stdout.isTTY);
}

async function main() {
	try {
		const parsed = await parseArgs(process.argv.slice(2));
		if ("help" in parsed) {
			stdout.write(`${usage()}\n`);
			return;
		}
		const options = parsed;
		if (options.printConfig) {
			stdout.write(`${formatEffectiveConfig(options)}\n`);
			return;
		}
		const session = await createSession(options);
		if (options.prompt) {
			new ConsolePresenter(session);
			await session.prompt(options.prompt);
			session.dispose();
			return;
		}
		if (shouldUseTui(options)) {
			const app = new InteractiveApp(session, {
				cwd: options.cwd,
				...(options.baseUrl === undefined ? {} : { baseUrl: options.baseUrl }),
				...(options.sessionDir === undefined ? {} : { sessionDir: options.sessionDir }),
				...(options.inMemory ? { inMemory: true } : {}),
				modelChoices: ["gpt-4o-mini", "gpt-5-mini", "gpt-5.4"],
				configSummary: formatEffectiveConfig(options),
				...(options.loadedConfig.activePreset?.name === undefined ? {} : { activePresetName: options.loadedConfig.activePreset.name }),
				warnings: options.loadedConfig.warnings,
			});
			app.start();
			return;
		}
		await runInteractive(session, options);
	} catch (error) {
		stdout.write(`fatal> ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 1;
	}
}

await main();
