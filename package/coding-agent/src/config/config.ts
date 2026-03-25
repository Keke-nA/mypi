import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ResolvedAutoCompactionSettings, AutoCompactionSettings } from "../core/context-usage.js";
import { resolveAutoCompactionSettings } from "../core/context-usage.js";
import type { SessionThinkingLevel } from "../core/session-types.js";
import { getWorkspaceToolNames, type WorkspaceToolName } from "../tools/workspace-tools.js";

export interface MypiPreset {
	provider?: string;
	model?: string;
	baseUrl?: string;
	thinkingLevel?: SessionThinkingLevel;
	tools?: WorkspaceToolName[] | Partial<Record<WorkspaceToolName, boolean>>;
	instructions?: string;
	uiMode?: "auto" | "tui" | "plain";
	compaction?: AutoCompactionSettings;
}

export interface MypiConfigFile {
	openai?: {
		apiKey?: string;
		baseUrl?: string;
		model?: string;
	};
	agent?: {
		thinkingLevel?: SessionThinkingLevel;
		uiMode?: "auto" | "tui" | "plain";
		tools?: WorkspaceToolName[] | Partial<Record<WorkspaceToolName, boolean>>;
		sessionDir?: string;
		continueRecent?: boolean;
		systemPromptAppend?: string;
		compaction?: AutoCompactionSettings;
	};
	preset?: string;
}

export type MypiPresetsConfig = Record<string, MypiPreset>;

export interface AgentConfigPaths {
	agentDir: string;
	globalConfigPath: string;
	globalPresetsPath: string;
	projectConfigPath: string;
	projectPresetsPath: string;
	explicitConfigPath?: string;
}

export interface ResolvedAgentSettings {
	apiKey?: string;
	baseUrl?: string;
	modelId?: string;
	thinkingLevel?: SessionThinkingLevel;
	uiMode?: "auto" | "tui" | "plain";
	sessionDir?: string;
	continueRecent?: boolean;
	activeTools?: WorkspaceToolName[];
	systemPromptAppend?: string;
	presetName?: string;
	compaction: ResolvedAutoCompactionSettings;
}

export interface LoadedAgentConfig {
	paths: AgentConfigPaths;
	settings: ResolvedAgentSettings;
	presets: MypiPresetsConfig;
	warnings: string[];
	activePreset?: { name: string; preset: MypiPreset };
}

export interface LoadAgentConfigOptions {
	cwd?: string;
	homeDir?: string;
	env?: Record<string, string | undefined>;
	explicitConfigPath?: string;
	presetName?: string;
}

const DEFAULT_MODEL = "gpt-5.4";
const DEFAULT_TOOLS = getWorkspaceToolNames();

function normalizeCwd(input: string): string {
	return path.resolve(input);
}

function expandHome(input: string, homeDir: string): string {
	if (input === "~") return homeDir;
	if (input.startsWith("~/")) return path.join(homeDir, input.slice(2));
	return input;
}

function resolveMaybePath(input: string | undefined, baseDir: string, homeDir: string): string | undefined {
	if (!input) return undefined;
	const expanded = expandHome(input, homeDir);
	return path.isAbsolute(expanded) ? expanded : path.resolve(baseDir, expanded);
}

async function readJsonFile<T>(filePath: string): Promise<T | undefined> {
	try {
		const text = await readFile(filePath, "utf8");
		return JSON.parse(text) as T;
	} catch {
		return undefined;
	}
}

function isToolName(value: string): value is WorkspaceToolName {
	return DEFAULT_TOOLS.includes(value as WorkspaceToolName);
}

function normalizeTools(
	tools: WorkspaceToolName[] | Partial<Record<WorkspaceToolName, boolean>> | undefined,
	warnings: string[],
): WorkspaceToolName[] | undefined {
	if (!tools) return undefined;
	if (Array.isArray(tools)) {
		const valid = tools.filter((tool) => isToolName(tool));
		const invalid = tools.filter((tool) => !isToolName(tool));
		if (invalid.length > 0) {
			warnings.push(`Ignoring unknown tools: ${invalid.join(", ")}`);
		}
		return valid;
	}

	const selected: WorkspaceToolName[] = [];
	for (const tool of DEFAULT_TOOLS) {
		if (tools[tool] === true) {
			selected.push(tool);
		}
	}
	for (const key of Object.keys(tools)) {
		if (!isToolName(key)) {
			warnings.push(`Ignoring unknown tool toggle: ${key}`);
		}
	}
	return selected;
}

function appendInstructions(base: string | undefined, next: string | undefined): string | undefined {
	if (!base) return next;
	if (!next) return base;
	return `${base}\n\n${next}`;
}

function mergeCompactionSettings(
	current: ResolvedAutoCompactionSettings,
	next: AutoCompactionSettings | undefined,
): ResolvedAutoCompactionSettings {
	return resolveAutoCompactionSettings({ ...current, ...(next ?? {}) });
}

function applyConfigFile(
	current: ResolvedAgentSettings,
	config: MypiConfigFile | undefined,
	context: { baseDir: string; homeDir: string; warnings: string[] },
): ResolvedAgentSettings {
	if (!config) return current;
	const next: ResolvedAgentSettings = { ...current };
	if (config.openai?.apiKey) next.apiKey = config.openai.apiKey;
	if (config.openai?.baseUrl) next.baseUrl = config.openai.baseUrl;
	if (config.openai?.model) next.modelId = config.openai.model;
	if (config.agent?.thinkingLevel) next.thinkingLevel = config.agent.thinkingLevel;
	if (config.agent?.uiMode) next.uiMode = config.agent.uiMode;
	if (typeof config.agent?.continueRecent === "boolean") next.continueRecent = config.agent.continueRecent;
	const sessionDir = resolveMaybePath(config.agent?.sessionDir, context.baseDir, context.homeDir);
	if (sessionDir) next.sessionDir = sessionDir;
	const tools = normalizeTools(config.agent?.tools, context.warnings);
	if (tools) next.activeTools = tools;
	if (config.agent?.systemPromptAppend) next.systemPromptAppend = config.agent.systemPromptAppend;
	if (config.agent?.compaction) next.compaction = mergeCompactionSettings(current.compaction, config.agent.compaction);
	if (config.preset) next.presetName = config.preset;
	return next;
}

function applyPreset(
	current: ResolvedAgentSettings,
	presetName: string | undefined,
	presets: MypiPresetsConfig,
	warnings: string[],
): { settings: ResolvedAgentSettings; activePreset?: { name: string; preset: MypiPreset } } {
	if (!presetName) {
		return { settings: current };
	}
	const preset = presets[presetName];
	if (!preset) {
		warnings.push(`Preset not found: ${presetName}`);
		return { settings: current };
	}
	const next: ResolvedAgentSettings = { ...current, presetName };
	if (preset.provider && preset.provider !== "openai") {
		warnings.push(`Preset ${presetName} requested unsupported provider ${preset.provider}; keeping current provider.`);
	}
	if (preset.model) next.modelId = preset.model;
	if (preset.baseUrl) next.baseUrl = preset.baseUrl;
	if (preset.thinkingLevel) next.thinkingLevel = preset.thinkingLevel;
	if (preset.uiMode) next.uiMode = preset.uiMode;
	if (preset.compaction) next.compaction = mergeCompactionSettings(current.compaction, preset.compaction);
	const tools = normalizeTools(preset.tools, warnings);
	if (tools) next.activeTools = tools;
	const appendedInstructions = appendInstructions(current.systemPromptAppend, preset.instructions);
	if (appendedInstructions !== undefined) {
		next.systemPromptAppend = appendedInstructions;
	}
	return { settings: next, activePreset: { name: presetName, preset } };
}

function parseBooleanEnv(value: string | undefined): boolean | undefined {
	if (!value) return undefined;
	if (value === "1" || value.toLowerCase() === "true") return true;
	if (value === "0" || value.toLowerCase() === "false") return false;
	return undefined;
}

function parseNumberEnv(value: string | undefined): number | undefined {
	if (!value) return undefined;
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function applyEnv(current: ResolvedAgentSettings, env: Record<string, string | undefined>): ResolvedAgentSettings {
	const next: ResolvedAgentSettings = { ...current };
	if (env.OPENAI_API_KEY) next.apiKey = env.OPENAI_API_KEY;
	if (env.OPENAI_BASE_URL) next.baseUrl = env.OPENAI_BASE_URL;
	if (env.OPENAI_MODEL) next.modelId = env.OPENAI_MODEL;
	if (env.MYPI_THINKING_LEVEL) next.thinkingLevel = env.MYPI_THINKING_LEVEL as SessionThinkingLevel;
	if (env.MYPI_UI_MODE) next.uiMode = env.MYPI_UI_MODE as "auto" | "tui" | "plain";
	if (env.MYPI_SESSION_DIR) {
		const resolvedSessionDir = resolveMaybePath(env.MYPI_SESSION_DIR, process.cwd(), os.homedir());
		if (resolvedSessionDir !== undefined) {
			next.sessionDir = resolvedSessionDir;
		}
	}
	const compactionUpdate: AutoCompactionSettings = {};
	const compactionEnabled = parseBooleanEnv(env.MYPI_COMPACTION_ENABLED);
	if (compactionEnabled !== undefined) compactionUpdate.enabled = compactionEnabled;
	const thresholdPercent = parseNumberEnv(env.MYPI_COMPACTION_THRESHOLD_PERCENT);
	if (thresholdPercent !== undefined) compactionUpdate.thresholdPercent = thresholdPercent;
	const reserveTokens = parseNumberEnv(env.MYPI_COMPACTION_RESERVE_TOKENS);
	if (reserveTokens !== undefined) compactionUpdate.reserveTokens = reserveTokens;
	const keepRecentTokens = parseNumberEnv(env.MYPI_COMPACTION_KEEP_RECENT_TOKENS);
	if (keepRecentTokens !== undefined) compactionUpdate.keepRecentTokens = keepRecentTokens;
	const retryOnOverflow = parseBooleanEnv(env.MYPI_COMPACTION_RETRY_ON_OVERFLOW);
	if (retryOnOverflow !== undefined) compactionUpdate.retryOnOverflow = retryOnOverflow;
	const showUsageInUi = parseBooleanEnv(env.MYPI_COMPACTION_SHOW_USAGE_IN_UI);
	if (showUsageInUi !== undefined) compactionUpdate.showUsageInUi = showUsageInUi;
	if (Object.keys(compactionUpdate).length > 0) {
		next.compaction = mergeCompactionSettings(current.compaction, compactionUpdate);
	}
	return next;
}

export function getAgentDir(homeDir: string = os.homedir()): string {
	return path.join(homeDir, ".mypi", "agent");
}

export function getGlobalConfigPath(homeDir: string = os.homedir()): string {
	return path.join(getAgentDir(homeDir), "config.json");
}

export function getGlobalPresetsPath(homeDir: string = os.homedir()): string {
	return path.join(getAgentDir(homeDir), "presets.json");
}

export function getProjectConfigPath(cwd: string): string {
	return path.join(normalizeCwd(cwd), ".mypi", "config.json");
}

export function getProjectPresetsPath(cwd: string): string {
	return path.join(normalizeCwd(cwd), ".mypi", "presets.json");
}

export async function loadAgentConfig(options: LoadAgentConfigOptions = {}): Promise<LoadedAgentConfig> {
	const cwd = normalizeCwd(options.cwd ?? process.cwd());
	const homeDir = options.homeDir ?? os.homedir();
	const env = options.env ?? (process.env as Record<string, string | undefined>);
	const paths: AgentConfigPaths = {
		agentDir: getAgentDir(homeDir),
		globalConfigPath: getGlobalConfigPath(homeDir),
		globalPresetsPath: getGlobalPresetsPath(homeDir),
		projectConfigPath: getProjectConfigPath(cwd),
		projectPresetsPath: getProjectPresetsPath(cwd),
		...(options.explicitConfigPath ? { explicitConfigPath: path.resolve(options.explicitConfigPath) } : {}),
	};
	const warnings: string[] = [];

	const [globalConfig, projectConfig, explicitConfig, globalPresets, projectPresets] = await Promise.all([
		readJsonFile<MypiConfigFile>(paths.globalConfigPath),
		readJsonFile<MypiConfigFile>(paths.projectConfigPath),
		paths.explicitConfigPath ? readJsonFile<MypiConfigFile>(paths.explicitConfigPath) : Promise.resolve(undefined),
		readJsonFile<MypiPresetsConfig>(paths.globalPresetsPath),
		readJsonFile<MypiPresetsConfig>(paths.projectPresetsPath),
	]);

	let settings: ResolvedAgentSettings = {
		modelId: DEFAULT_MODEL,
		thinkingLevel: "off",
		continueRecent: true,
		uiMode: "auto",
		activeTools: DEFAULT_TOOLS.slice(),
		compaction: resolveAutoCompactionSettings(undefined),
	};

	settings = applyConfigFile(settings, globalConfig, {
		baseDir: paths.agentDir,
		homeDir,
		warnings,
	});
	settings = applyConfigFile(settings, projectConfig, {
		baseDir: path.dirname(paths.projectConfigPath),
		homeDir,
		warnings,
	});
	settings = applyConfigFile(settings, explicitConfig, {
		baseDir: paths.explicitConfigPath ? path.dirname(paths.explicitConfigPath) : cwd,
		homeDir,
		warnings,
	});

	const presets: MypiPresetsConfig = {
		...(globalPresets ?? {}),
		...(projectPresets ?? {}),
	};

	const presetName = options.presetName ?? env.MYPI_PRESET ?? settings.presetName;
	const presetApplied = applyPreset(settings, presetName, presets, warnings);
	settings = presetApplied.settings;
	settings = applyEnv(settings, env);

	return {
		paths,
		settings,
		presets,
		warnings,
		...(presetApplied.activePreset ? { activePreset: presetApplied.activePreset } : {}),
	};
}

export function formatLoadedConfig(config: LoadedAgentConfig): string {
	const activePreset = config.activePreset?.name ?? config.settings.presetName ?? "(none)";
	const lines = [
		`agentDir: ${config.paths.agentDir}`,
		`globalConfigPath: ${config.paths.globalConfigPath}`,
		`projectConfigPath: ${config.paths.projectConfigPath}`,
		`globalPresetsPath: ${config.paths.globalPresetsPath}`,
		`projectPresetsPath: ${config.paths.projectPresetsPath}`,
		`activePreset: ${activePreset}`,
		`model: ${config.settings.modelId ?? DEFAULT_MODEL}`,
		`baseUrl: ${config.settings.baseUrl ?? "(default)"}`,
		`thinkingLevel: ${config.settings.thinkingLevel ?? "off"}`,
		`uiMode: ${config.settings.uiMode ?? "auto"}`,
		`sessionDir: ${config.settings.sessionDir ?? "(default)"}`,
		`continueRecent: ${config.settings.continueRecent === false ? "false" : "true"}`,
		`activeTools: ${(config.settings.activeTools ?? DEFAULT_TOOLS).join(", ") || "(none)"}`,
		`compaction.enabled: ${config.settings.compaction.enabled ? "true" : "false"}`,
		`compaction.thresholdPercent: ${config.settings.compaction.thresholdPercent}`,
		`compaction.reserveTokens: ${config.settings.compaction.reserveTokens}`,
		`compaction.keepRecentTokens: ${config.settings.compaction.keepRecentTokens}`,
		`compaction.retryOnOverflow: ${config.settings.compaction.retryOnOverflow ? "true" : "false"}`,
		`compaction.showUsageInUi: ${config.settings.compaction.showUsageInUi ? "true" : "false"}`,
		`systemPromptAppend: ${config.settings.systemPromptAppend ? JSON.stringify(config.settings.systemPromptAppend) : "(none)"}`,
	];
	if (config.warnings.length > 0) {
		lines.push(`warnings: ${config.warnings.join(" | ")}`);
	}
	return lines.join("\n");
}
