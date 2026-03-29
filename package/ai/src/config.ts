const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com";

export interface OpenAIConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export interface AnthropicConfig {
  apiKey?: string;
  baseUrl?: string;
  defaultHeaders?: Record<string, string>;
}

export interface AIConfig {
  env?: Record<string, string | undefined>;
  fetch?: typeof fetch;
  providers?: {
    openai?: OpenAIConfig;
    anthropic?: AnthropicConfig;
  };
}

export interface ResolvedOpenAIConfig {
  apiKey: string;
  baseUrl: string;
  defaultHeaders: Record<string, string>;
  fetch: typeof fetch;
}

export interface ResolvedAnthropicConfig {
  apiKey: string;
  baseUrl: string;
  defaultHeaders: Record<string, string>;
  fetch: typeof fetch;
}

let currentConfig: AIConfig = {};

export function configureAI(config: AIConfig = {}): void {
  currentConfig = config;
}

export function getAIConfig(): AIConfig {
  return currentConfig;
}

function resolveEnv(config: AIConfig): Record<string, string | undefined> {
  return config.env ?? (process.env as Record<string, string | undefined>);
}

function ensureFetch(config: AIConfig): typeof fetch {
  if (config.fetch) {
    return config.fetch;
  }

  if (typeof globalThis.fetch !== "function") {
    throw new Error("Fetch is not available in the current runtime.");
  }

  return globalThis.fetch;
}

export function resolveOpenAIConfig(
  config: AIConfig,
  providerConfig: OpenAIConfig | undefined = config.providers?.openai,
): ResolvedOpenAIConfig {
  const env = resolveEnv(config);
  const apiKey = providerConfig?.apiKey ?? env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OpenAI API key is missing. Set OPENAI_API_KEY or pass providers.openai.apiKey.");
  }

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(providerConfig?.baseUrl ?? env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL),
    defaultHeaders: providerConfig?.defaultHeaders ?? {},
    fetch: ensureFetch(config),
  };
}

export function resolveAnthropicConfig(
  config: AIConfig,
  providerConfig: AnthropicConfig | undefined = config.providers?.anthropic,
): ResolvedAnthropicConfig {
  const env = resolveEnv(config);
  const apiKey = providerConfig?.apiKey ?? env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error("Anthropic API key is missing. Set ANTHROPIC_API_KEY or pass providers.anthropic.apiKey.");
  }

  return {
    apiKey,
    baseUrl: normalizeBaseUrl(providerConfig?.baseUrl ?? env.ANTHROPIC_BASE_URL ?? DEFAULT_ANTHROPIC_BASE_URL),
    defaultHeaders: providerConfig?.defaultHeaders ?? {},
    fetch: ensureFetch(config),
  };
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}
