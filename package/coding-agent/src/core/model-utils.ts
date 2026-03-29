import { getModel, getModels, getProviders, type KnownProvider, type Model } from "@mypi/ai";
import type { SessionModelRef } from "./session-types.js";

export const DEFAULT_MODEL_BY_PROVIDER: Record<KnownProvider, string> = {
	openai: "gpt-5.4",
	anthropic: "claude-sonnet-4-5",
};

export function isKnownProvider(provider: string): provider is KnownProvider {
	return getProviders().includes(provider as KnownProvider);
}

export function getDefaultModelId(provider: string): string {
	return isKnownProvider(provider) ? DEFAULT_MODEL_BY_PROVIDER[provider] : DEFAULT_MODEL_BY_PROVIDER.openai;
}

export function getModelChoices(provider: string): string[] {
	if (!isKnownProvider(provider)) {
		return [];
	}
	return getModels(provider).map((model) => model.id);
}

export function inferProviderFromModelId(modelId: string): KnownProvider | undefined {
	for (const provider of getProviders()) {
		if (getModels(provider).some((model) => model.id === modelId)) {
			return provider;
		}
	}
	return undefined;
}

function createCustomModel(provider: KnownProvider, modelId: string, baseUrl?: string): Model<any> {
	if (provider === "anthropic") {
		return {
			id: modelId,
			name: modelId,
			api: "anthropic-messages",
			provider,
			baseUrl: baseUrl ?? "https://api.anthropic.com",
			reasoning: true,
			input: ["text", "image"],
			cost: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
			},
			contextWindow: 200000,
			maxTokens: 64000,
		};
	}

	return {
		id: modelId,
		name: modelId,
		api: "openai-responses",
		provider,
		baseUrl: baseUrl ?? "https://api.openai.com/v1",
		reasoning: true,
		input: ["text", "image"],
		cost: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
		},
		contextWindow: 200000,
		maxTokens: 128000,
	};
}

export function resolveModel(provider: string, modelId: string, baseUrl?: string): Model<any> {
	if (!isKnownProvider(provider)) {
		throw new Error(`Unknown provider: ${provider}`);
	}
	const model = getModel(provider, modelId as never);
	if (!model) {
		return createCustomModel(provider, modelId, baseUrl);
	}
	return baseUrl ? { ...model, baseUrl } : model;
}

export function resolveOpenAIModel(modelId: string, baseUrl?: string): Model<any> {
	return resolveModel("openai", modelId, baseUrl);
}

export async function resolvePersistedModel(
	model: SessionModelRef,
	options: { provider?: string; baseUrl?: string } = {},
): Promise<Model<any> | null> {
	if (!isKnownProvider(model.provider)) {
		return null;
	}
	const resolved = getModel(model.provider, model.modelId as never) ?? createCustomModel(model.provider, model.modelId);
	if (options.baseUrl && (!options.provider || options.provider === model.provider)) {
		return { ...resolved, baseUrl: options.baseUrl };
	}
	return resolved;
}
