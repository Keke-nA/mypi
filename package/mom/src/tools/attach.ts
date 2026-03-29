import { Type } from "@mypi/ai";
import type { TextContent } from "@mypi/ai";
import type { AgentTool } from "@mypi/agent";

const attachSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  title: Type.Optional(Type.String()),
});

export function createAttachTool(
  uploadFile: (filePath: string, title?: string) => Promise<void>,
): AgentTool<typeof attachSchema, { attached: boolean }> {
  return {
    name: "attach",
    label: "attach",
    description: "Upload a file back to Slack.",
    parameters: attachSchema,
    async execute(_toolCallId, params, signal): Promise<{ content: TextContent[]; details: { attached: boolean } }> {
      if (signal?.aborted) {
        throw new Error("Operation aborted");
      }
      await uploadFile(params.path, params.title);
      return {
        content: [{ type: "text", text: `Attached file: ${params.title || params.path}` }],
        details: { attached: true },
      };
    },
  };
}
