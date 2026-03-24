import { stdin, stdout } from "node:process";
import { setTimeout as delay } from "node:timers/promises";

import { getModel } from "@mypi/ai";

import { Agent } from "../dist/index.js";

async function readStdin() {
	let data = "";
	for await (const chunk of stdin) {
		data += chunk;
	}
	return data.trim();
}

function extractAssistantText(message) {
	if (!message || message.role !== "assistant") {
		return "";
	}

	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("");
}

async function main() {
	const raw = await readStdin();
	if (!raw) {
		throw new Error("Expected JSON config on stdin.");
	}

	const input = JSON.parse(raw);
	const urls = Array.isArray(input.urls) ? input.urls : [];
	const apiKey = typeof input.apiKey === "string" ? input.apiKey : "";
	const model = typeof input.model === "string" ? input.model : "gpt-5.4";
	const retries = typeof input.retries === "number" && input.retries > 0 ? input.retries : 3;
	const delayMs = typeof input.delayMs === "number" && input.delayMs >= 0 ? input.delayMs : 1000;

	if (!apiKey) {
		throw new Error("Missing apiKey.");
	}

	const baseModel = getModel("openai", model);
	if (!baseModel) {
		throw new Error(`Unknown model: ${model}`);
	}

	const errors = [];

	for (const url of urls) {
		for (let attempt = 1; attempt <= retries; attempt += 1) {
			try {
				const agent = new Agent({
					initialState: {
						model: {
							...baseModel,
							baseUrl: url,
						},
					},
					getApiKey: async () => apiKey,
				});

				const eventTypes = [];
				const unsubscribe = agent.subscribe((event) => {
					eventTypes.push(event.type);
				});

				try {
					await agent.prompt("Reply with exactly AGENT_OK and nothing else.");
				} finally {
					unsubscribe();
				}

				const finalMessage = [...agent.state.messages]
					.reverse()
					.find((message) => message.role === "assistant");

				if (!finalMessage || finalMessage.role !== "assistant") {
					throw new Error("Agent did not produce an assistant message.");
				}

				if (finalMessage.stopReason !== "stop") {
					throw new Error(finalMessage.errorMessage || `Unexpected stop reason: ${finalMessage.stopReason}`);
				}

				stdout.write(
					`${JSON.stringify(
						{
							ok: true,
							url,
							model,
							attempts: attempt,
							result: {
								text: extractAssistantText(finalMessage),
								stopReason: finalMessage.stopReason,
								eventTypes,
							},
						},
						null,
						2,
					)}\n`,
				);
				return;
			} catch (error) {
				errors.push({
					url,
					attempt,
					name: error instanceof Error ? error.name : "Error",
					message: error instanceof Error ? error.message : String(error),
				});

				if (attempt < retries) {
					await delay(delayMs);
				}
			}
		}
	}

	stdout.write(
		`${JSON.stringify(
			{
				ok: false,
				errors,
			},
			null,
			2,
		)}\n`,
	);
	process.exitCode = 1;
}

await main();
