import { Type } from "@mypi/ai";
import type { TextContent } from "@mypi/ai";
import type { AgentTool } from "@mypi/agent";
import type { Executor } from "../sandbox.js";
import { truncateTail } from "./truncate.js";

const bashSchema = Type.Object({
  label: Type.String(),
  command: Type.String(),
  timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
});

export function createBashTool(executor: Executor): AgentTool<typeof bashSchema, { truncated: boolean; exitCode: number }> {
  return {
    name: "bash",
    label: "bash",
    description: "Run a shell command in the sandbox workspace.",
    parameters: bashSchema,
    async execute(_toolCallId, params, signal): Promise<{ content: TextContent[]; details: { truncated: boolean; exitCode: number } }> {
      const result = await executor.exec(params.command, {
        ...(signal ? { signal } : {}),
        ...(params.timeout === undefined ? {} : { timeout: params.timeout }),
      });
      const combined = [result.stdout.trimEnd(), result.stderr.trimEnd()].filter((part) => part.length > 0).join("\n");
      const truncation = truncateTail(combined || "(no output)");
      const text = truncation.content || "(no output)";
      if (result.code !== 0) {
        throw new Error(`${text}\n\nCommand exited with code ${result.code}`.trim());
      }
      return {
        content: [{ type: "text", text }],
        details: { truncated: truncation.truncated, exitCode: result.code },
      };
    },
  };
}
