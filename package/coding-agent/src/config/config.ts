import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { KnownProvider } from "@mypi/ai";
import type { ResolvedAutoCompactionSettings, AutoCompactionSettings } from "../core/context-usage.js";
import { resolveAutoCompactionSettings } from "../core/context-usage.js";
import { getDefaultModelId, inferProviderFromModelId, isKnownProvider } from "../core/model-utils.js";
import type { SessionThinkingLevel } from "../core/session-types.js";
import { getWorkspaceToolNames, type WorkspaceToolName } from "../tools/workspace-tools.js";

interface ProviderConfigFile {
	apiKey?: string;
	baseUrl?: string;
	model?: string;
}

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
	openai?: ProviderConfigFile;
	anthropic?: ProviderConfigFile;
	agent?: {
		provider?: string;
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
	provider: KnownProvider;
	apiKey?: string;
	baseUrl?: string;
	modelId: string;
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

const DEFAULT_PROVIDER: KnownProvider = "openai";
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

function withProvider(settings: ResolvedAgentSettings, provider: KnownProvider): ResolvedAgentSettings {
	if (settings.provider === provider) {
		return settings;
	}
	const { apiKey: _apiKey, baseUrl: _baseUrl, ...rest } = settings;
	return {
		...rest,
		provider,
		modelId: getDefaultModelId(provider),
	};
}

function resolveProviderValue(
	value: string | undefined,
	warnings: string[],
	context: string,
): KnownProvider | undefined {
	if (!value) {
		return undefined;
	}
	if (isKnownProvider(value)) {
		return value;
	}
	warnings.push(`Ignoring unsupported provider ${value} from ${context}.`);
	return undefined;
}

function resolveConfigProvider(config: MypiConfigFile | undefined, current: ResolvedAgentSettings, warnings: string[]): KnownProvider | undefined {
	if (!config) {
		return undefined;
	}
	const explicit = resolveProviderValue(config.agent?.provider, warnings, "config");
	if (explicit) {
		return explicit;
	}
	if (config.openai && !config.anthropic) {
		return "openai";
	}
	if (config.anthropic && !config.openai) {
		return "anthropic";
	}
	return current.provider;
}

function getActiveProviderBlock(config: MypiConfigFile | undefined, provider: KnownProvider): ProviderConfigFile | undefined {
	if (!config) {
		return undefined;
	}
	return provider === "anthropic" ? config.anthropic : config.openai;
}

function applyProviderBlock(current: ResolvedAgentSettings, providerConfig: ProviderConfigFile | undefined): ResolvedAgentSettings {
	if (!providerConfig) {
		return current;
	}
	const next: ResolvedAgentSettings = { ...current };
	if (providerConfig.apiKey) next.apiKey = providerConfig.apiKey;
	if (providerConfig.baseUrl) next.baseUrl = providerConfig.baseUrl;
	if (providerConfig.model) next.modelId = providerConfig.model;
	return next;
}

function applyConfigFile(
	current: ResolvedAgentSettings,
	config: MypiConfigFile | undefined,
	context: { baseDir: string; homeDir: string; warnings: string[] },
): ResolvedAgentSettings {
	if (!config) return current;
	let next: ResolvedAgentSettings = { ...current };
	const configProvider = resolveConfigProvider(config, current, context.warnings);
	if (configProvider) {
		next = withProvider(next, configProvider);
	}
	if (config.agent?.thinkingLevel) next.thinkingLevel = config.agent.thinkingLevel;
	if (config.agent?.uiMode) next.uiMode = config.agent.uiMode;
	if (typeof config.agent?.continueRecent === "boolean") next.continueRecent = config.agent.continueRecent;
	const sessionDir = resolveMaybePath(config.agent?.sessionDir, context.baseDir, context.homeDir);
	if (sessionDir) next.sessionDir = sessionDir;
	const tools = normalizeTools(config.agent?.tools, context.warnings);
	if (tools) next.activeTools = tools;
	if (config.agent?.systemPromptAppend) next.systemPromptAppend = config.agent.systemPromptAppend;
	if (config.agent?.compaction) next.compaction = mergeCompactionSettings(next.compaction, config.agent.compaction);
	if (config.preset) next.presetName = config.preset;
	return applyProviderBlock(next, getActiveProviderBlock(config, next.provider));
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
	let next: ResolvedAgentSettings = { ...current, presetName };
	const presetProvider = resolveProviderValue(preset.provider, warnings, `preset ${presetName}`);
	if (presetProvider) {
		next = withProvider(next, presetProvider);
	}
	if (preset.model) next.modelId = preset.model;
	if (preset.baseUrl) next.baseUrl = preset.baseUrl;
	if (preset.thinkingLevel) next.thinkingLevel = preset.thinkingLevel;
	if (preset.uiMode) next.uiMode = preset.uiMode;
	if (preset.compaction) next.compaction = mergeCompactionSettings(next.compaction, preset.compaction);
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

function applyProviderEnv(current: ResolvedAgentSettings, env: Record<string, string | undefined>): ResolvedAgentSettings {
	const next: ResolvedAgentSettings = { ...current };
	if (next.provider === "anthropic") {
		if (env.ANTHROPIC_API_KEY) next.apiKey = env.ANTHROPIC_API_KEY;
		if (env.ANTHROPIC_BASE_URL) next.baseUrl = env.ANTHROPIC_BASE_URL;
		if (env.ANTHROPIC_MODEL) next.modelId = env.ANTHROPIC_MODEL;
		return next;
	}
	if (env.OPENAI_API_KEY) next.apiKey = env.OPENAI_API_KEY;
	if (env.OPENAI_BASE_URL) next.baseUrl = env.OPENAI_BASE_URL;
	if (env.OPENAI_MODEL) next.modelId = env.OPENAI_MODEL;
	return next;
}

function inferProviderFromEnv(env: Record<string, string | undefined>): KnownProvider | undefined {
	const explicit = env.MYPI_PROVIDER;
	if (explicit) {
		return isKnownProvider(explicit) ? explicit : undefined;
	}

	const hasOpenAI = Boolean(env.OPENAI_API_KEY || env.OPENAI_BASE_URL || env.OPENAI_MODEL);
	const hasAnthropic = Boolean(env.ANTHROPIC_API_KEY || env.ANTHROPIC_BASE_URL || env.ANTHROPIC_MODEL);
	if (hasAnthropic && !hasOpenAI) {
		return "anthropic";
	}
	if (hasOpenAI && !hasAnthropic) {
		return "openai";
	}
	return undefined;
}

function applyEnv(
	current: ResolvedAgentSettings,
	env: Record<string, string | undefined>,
	warnings: string[],
): ResolvedAgentSettings {
	let next: ResolvedAgentSettings = { ...current };
	const envProvider = resolveProviderValue(env.MYPI_PROVIDER, warnings, "env");
	if (envProvider) {
		next = withProvider(next, envProvider);
	}
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
		next.compaction = mergeCompactionSettings(next.compaction, compactionUpdate);
	}
	return next;
}

function finalizeSettings(
	current: ResolvedAgentSettings,
	env: Record<string, string | undefined>,
	warnings: string[],
): ResolvedAgentSettings {
	let next: ResolvedAgentSettings = { ...current };
	const envProvider = inferProviderFromEnv(env);
	const usingDefaultOpenAISelection =
		next.provider === DEFAULT_PROVIDER &&
		next.modelId === getDefaultModelId(DEFAULT_PROVIDER) &&
		next.apiKey === undefined &&
		next.baseUrl === undefined;

	const inferredProvider =
		(envProvider && usingDefaultOpenAISelection ? envProvider : undefined) ??
		inferProviderFromModelId(next.modelId) ??
		next.provider ??
		DEFAULT_PROVIDER;
	if (next.provider !== inferredProvider) {
		next = withProvider(next, inferredProvider);
	}
	// Re-apply provider-specific env after provider is fully resolved.
	next = applyProviderEnv(next, env);

	const modelProvider = inferProviderFromModelId(next.modelId);
	if (modelProvider && modelProvider !== next.provider) {
		warnings.push(
			`Model ${next.modelId} does not belong to provider ${next.provider}; falling back to ${next.provider}/${getDefaultModelId(next.provider)}.`,
		);
		next.modelId = getDefaultModelId(next.provider);
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
		provider: DEFAULT_PROVIDER,
		modelId: getDefaultModelId(DEFAULT_PROVIDER),
		thinkingLevel: "off",
		continueRecent: false,
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
	settings = applyEnv(settings, env, warnings);
	settings = finalizeSettings(settings, env, warnings);

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
		`provider: ${config.settings.provider}`,
		`model: ${config.settings.modelId}`,
		`baseUrl: ${config.settings.baseUrl ?? "(default)"}`,
		`thinkingLevel: ${config.settings.thinkingLevel ?? "off"}`,
		`uiMode: ${config.settings.uiMode ?? "auto"}`,
		`sessionDir: ${config.settings.sessionDir ?? "(default)"}`,
		`continueRecent: ${config.settings.continueRecent ? "true" : "false"}`,
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
