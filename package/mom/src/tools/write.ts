import { Type } from "@mypi/ai";
import type { TextContent } from "@mypi/ai";
import type { AgentTool } from "@mypi/agent";
import type { Executor } from "../sandbox.js";

const writeSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  content: Type.String(),
});

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createWriteTool(executor: Executor): AgentTool<typeof writeSchema, { bytes: number }> {
  return {
    name: "write",
    label: "write",
    description: "Create or overwrite a text file. Parent directories are created automatically.",
    parameters: writeSchema,
    async execute(_toolCallId, params, signal): Promise<{ content: TextContent[]; details: { bytes: number } }> {
      const directory = params.path.includes("/") ? params.path.slice(0, params.path.lastIndexOf("/")) : ".";
      const command = `mkdir -p ${shellEscape(directory)} && printf '%s' ${shellEscape(params.content)} > ${shellEscape(params.path)}`;
      const result = await executor.exec(command, {
        ...(signal ? { signal } : {}),
      });
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to write file: ${params.path}`);
      }
      const bytes = Buffer.byteLength(params.content, "utf8");
      return {
        content: [{ type: "text", text: `Wrote ${bytes} bytes to ${params.path}` }],
        details: { bytes },
      };
    },
  };
}
