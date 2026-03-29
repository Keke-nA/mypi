import { Type } from "@mypi/ai";
import type { TextContent } from "@mypi/ai";
import type { AgentTool } from "@mypi/agent";
import type { Executor } from "../sandbox.js";

const editSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  oldText: Type.String(),
  newText: Type.String(),
});

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createEditTool(executor: Executor): AgentTool<typeof editSchema, { replacements: number }> {
  return {
    name: "edit",
    label: "edit",
    description: "Replace one exact text fragment inside a file.",
    parameters: editSchema,
    async execute(_toolCallId, params, signal): Promise<{ content: TextContent[]; details: { replacements: number } }> {
      const readResult = await executor.exec(`cat ${shellEscape(params.path)}`, {
        ...(signal ? { signal } : {}),
      });
      if (readResult.code !== 0) {
        throw new Error(readResult.stderr || `File not found: ${params.path}`);
      }
      const original = readResult.stdout;
      const occurrences = original.split(params.oldText).length - 1;
      if (occurrences === 0) {
        throw new Error(`Old text not found in ${params.path}`);
      }
      if (occurrences > 1) {
        throw new Error(`Old text is not unique in ${params.path}`);
      }
      const updated = original.replace(params.oldText, params.newText);
      const writeResult = await executor.exec(`printf '%s' ${shellEscape(updated)} > ${shellEscape(params.path)}`, {
        ...(signal ? { signal } : {}),
      });
      if (writeResult.code !== 0) {
        throw new Error(writeResult.stderr || `Failed to write file: ${params.path}`);
      }
      return {
        content: [{ type: "text", text: `Edited ${params.path}` }],
        details: { replacements: 1 },
      };
    },
  };
}
