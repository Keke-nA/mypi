import type { KnownProvider } from "./types.js";

export function getEnvApiKey(provider: KnownProvider): string | undefined;
export function getEnvApiKey(provider: string): string | undefined;
export function getEnvApiKey(provider: string): string | undefined {
  if (provider === "openai") {
    return process.env.OPENAI_API_KEY;
  }

  if (provider === "anthropic") {
    return process.env.ANTHROPIC_API_KEY;
  }

  return undefined;
}
