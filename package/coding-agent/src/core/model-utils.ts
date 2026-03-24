import { getModel, type Model } from "@mypi/ai";
import type { SessionModelRef } from "./session-types.js";

export function resolveOpenAIModel(modelId: string, baseUrl?: string): Model<any> {
	const model = getModel("openai", modelId as never);
	if (!model) {
		throw new Error(`Unknown OpenAI model: ${modelId}`);
	}
	return baseUrl ? { ...model, baseUrl } : model;
}

export async function resolvePersistedModel(model: SessionModelRef, baseUrl?: string): Promise<Model<any> | null> {
	if (model.provider !== "openai") {
		return null;
	}
	return resolveOpenAIModel(model.modelId, baseUrl);
}
