import type { ImageContent, Message, TextContent } from "@mypi/ai";
import type { AgentMessage } from "@mypi/agent";
import type {
	BranchSummaryMessage,
	CompactionSummaryMessage,
	CustomContextMessage,
	SessionInjectedMessage,
} from "./session-types.js";

export interface BashExecutionLike {
	command: string;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
}

export function createCompactionSummaryMessage(
	summary: string,
	options: { timestamp?: number; sourceEntryId: string; details?: unknown },
): CompactionSummaryMessage {
	return {
		role: "compaction_summary",
		summary,
		timestamp: options.timestamp ?? Date.now(),
		sourceEntryId: options.sourceEntryId,
		...(options.details === undefined ? {} : { details: options.details }),
	};
}

export function createBranchSummaryMessage(
	summary: string,
	options: { timestamp?: number; fromEntryId: string | null; details?: unknown },
): BranchSummaryMessage {
	return {
		role: "branch_summary",
		summary,
		fromEntryId: options.fromEntryId,
		timestamp: options.timestamp ?? Date.now(),
		...(options.details === undefined ? {} : { details: options.details }),
	};
}

export function createCustomMessage(
	content: string | (TextContent | ImageContent)[],
	options: { timestamp?: number; name?: string; metadata?: unknown } = {},
): CustomContextMessage {
	return {
		role: "custom_message",
		content,
		timestamp: options.timestamp ?? Date.now(),
		...(options.name === undefined ? {} : { name: options.name }),
		...(options.metadata === undefined ? {} : { metadata: options.metadata }),
	};
}

export function bashExecutionToText(execution: BashExecutionLike): string {
	const parts = [`$ ${execution.command}`];
	if (execution.stdout) {
		parts.push(execution.stdout.trimEnd());
	}
	if (execution.stderr) {
		parts.push(execution.stderr.trimEnd());
	}
	if (typeof execution.exitCode === "number") {
		parts.push(`[exit ${execution.exitCode}]`);
	}
	return parts.filter(Boolean).join("\n");
}

function createUserTextMessage(text: string, timestamp: number): Message {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp,
	};
}

function toSummaryText(kind: "compaction" | "branch", summary: string): string {
	if (kind === "compaction") {
		return `Conversation summary:\n${summary}`;
	}
	return `Summary of previously explored branch:\n${summary}`;
}

export function convertToLlm(messages: AgentMessage[]): Message[] {
	const output: Message[] = [];
	for (const message of messages) {
		switch (message.role) {
			case "user":
			case "assistant":
			case "toolResult":
				output.push(message);
				break;
			case "compaction_summary":
				output.push(createUserTextMessage(toSummaryText("compaction", message.summary), message.timestamp));
				break;
			case "branch_summary":
				output.push(createUserTextMessage(toSummaryText("branch", message.summary), message.timestamp));
				break;
			case "custom_message":
				output.push({
					role: "user",
					content: message.content,
					timestamp: message.timestamp,
				});
				break;
			default:
				break;
		}
	}
	return output;
}

export function contentPartToText(part: TextContent | ImageContent): string {
	if (part.type === "text") {
		return part.text;
	}
	return `[image:${part.mimeType}]`;
}

export function messageToText(message: AgentMessage | Message | SessionInjectedMessage): string {
	switch (message.role) {
		case "user":
			if (typeof message.content === "string") {
				return message.content;
			}
			return message.content.map(contentPartToText).join("\n");
		case "assistant":
			return message.content
				.map((part) => {
					if (part.type === "text") return part.text;
					if (part.type === "thinking") return part.redacted ? "[thinking:redacted]" : part.thinking;
					return `[tool:${part.name}] ${JSON.stringify(part.arguments)}`;
				})
				.join("\n");
		case "toolResult":
			return message.content.map(contentPartToText).join("\n");
		case "compaction_summary":
			return toSummaryText("compaction", message.summary);
		case "branch_summary":
			return toSummaryText("branch", message.summary);
		case "custom_message":
			if (typeof message.content === "string") {
				return message.content;
			}
			return message.content.map(contentPartToText).join("\n");
		default:
			return "";
	}
}

declare module "@mypi/agent" {
	interface CustomAgentMessages {
		compaction_summary: CompactionSummaryMessage;
		branch_summary: BranchSummaryMessage;
		custom_message: CustomContextMessage;
	}
}
