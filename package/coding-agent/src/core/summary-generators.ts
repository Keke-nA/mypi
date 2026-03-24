import { completeSimple, type AssistantMessage, type Message, type Model } from "@mypi/ai";
import type { AgentMessage } from "@mypi/agent";
import { convertToLlm } from "./messages.js";
import type { BranchSummaryGenerator, BranchSummaryGeneratorInput } from "./branch-summarization.js";
import type { CompactionSummaryGenerator, CompactionGeneratorInput } from "./session-compaction.js";

function extractAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("")
		.trim();
}

function buildSummaryContext(messages: AgentMessage[], instruction: string, previousSummary?: string): Message[] {
	const contextMessages = convertToLlm(messages);
	const output: Message[] = [];
	if (previousSummary) {
		output.push({
			role: "user",
			content: `Existing rolling summary:\n${previousSummary}`,
			timestamp: Date.now(),
		});
	}
	output.push(...contextMessages);
	output.push({
		role: "user",
		content: instruction,
		timestamp: Date.now(),
	});
	return output;
}

export function createBranchSummaryGenerator(model: Model<any>): BranchSummaryGenerator {
	return async (input: BranchSummaryGeneratorInput) => {
		if (input.messages.length === 0) {
			return { summary: "No meaningful branch-only activity to summarize." };
		}

		const response = await completeSimple(
			model,
			{
				systemPrompt:
					"You summarize an abandoned coding-agent branch for later continuation. Keep only durable facts: goals, attempted approaches, important findings, changed files, errors, and unfinished work. Use short markdown bullets. No preamble.",
				messages: buildSummaryContext(
					input.messages,
					"Summarize this abandoned branch so the agent can return to another branch without forgetting what was tried.",
				),
			},
			input.signal ? { signal: input.signal, maxTokens: 700 } : { maxTokens: 700 },
		);

		return {
			summary: extractAssistantText(response) || "Branch explored but summary generation returned no text.",
		};
	};
}

export function createCompactionSummaryGenerator(model: Model<any>): CompactionSummaryGenerator {
	return async (input: CompactionGeneratorInput) => {
		if (input.messages.length === 0 && !input.previousSummary) {
			return { summary: "No earlier context to compact." };
		}

		const response = await completeSimple(
			model,
			{
				systemPrompt:
					"You compress coding-agent conversation history into a durable rolling summary for future continuation. Preserve goals, repository facts, key decisions, file paths, commands run, errors, and next steps. Prefer compact markdown bullets. No preamble.",
				messages: buildSummaryContext(
					input.messages,
					"Update the rolling summary so future turns can continue from it plus the kept recent suffix.",
					input.previousSummary,
				),
			},
			input.signal ? { signal: input.signal, maxTokens: 1200 } : { maxTokens: 1200 },
		);

		return {
			summary: extractAssistantText(response) || input.previousSummary || "Context compacted without a textual summary.",
		};
	};
}
