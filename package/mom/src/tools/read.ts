import { Type } from "@mypi/ai";
import type { ImageContent, TextContent } from "@mypi/ai";
import type { AgentTool } from "@mypi/agent";
import type { Executor } from "../sandbox.js";
import { DEFAULT_MAX_BYTES, formatSize, truncateHead } from "./truncate.js";

const IMAGE_MIME_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

const readSchema = Type.Object({
  label: Type.String(),
  path: Type.String(),
  offset: Type.Optional(Type.Integer({ minimum: 1 })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
});

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getMimeType(filePath: string): string | null {
  const lower = filePath.toLowerCase();
  const match = Object.entries(IMAGE_MIME_TYPES).find(([extension]) => lower.endsWith(extension));
  return match?.[1] ?? null;
}

export function createReadTool(executor: Executor): AgentTool<typeof readSchema, { truncated: boolean }> {
  return {
    name: "read",
    label: "read",
    description: "Read a text file or image. Use offset and limit for large files.",
    parameters: readSchema,
    async execute(_toolCallId, params, signal): Promise<{ content: (TextContent | ImageContent)[]; details: { truncated: boolean } }> {
      const mimeType = getMimeType(params.path);
      if (mimeType) {
        const result = await executor.exec(`base64 < ${shellEscape(params.path)}`, {
          ...(signal ? { signal } : {}),
        });
        if (result.code !== 0) {
          throw new Error(result.stderr || `Failed to read image: ${params.path}`);
        }
        return {
          content: [
            { type: "text", text: `Read image file: ${params.path}` },
            { type: "image", data: result.stdout.replace(/\s/g, ""), mimeType },
          ],
          details: { truncated: false },
        };
      }

      const countResult = await executor.exec(`wc -l < ${shellEscape(params.path)}`, {
        ...(signal ? { signal } : {}),
      });
      if (countResult.code !== 0) {
        throw new Error(countResult.stderr || `Failed to read file: ${params.path}`);
      }
      const totalLines = Number.parseInt(countResult.stdout.trim(), 10) + 1;
      const offset = Math.max(1, params.offset ?? 1);
      let command = offset === 1 ? `cat ${shellEscape(params.path)}` : `tail -n +${offset} ${shellEscape(params.path)}`;
      if (params.limit !== undefined) {
        command += ` | head -n ${params.limit}`;
      }

      const result = await executor.exec(command, {
        ...(signal ? { signal } : {}),
      });
      if (result.code !== 0) {
        throw new Error(result.stderr || `Failed to read file: ${params.path}`);
      }

      const truncation = truncateHead(result.stdout);
      let text = truncation.content;
      if (truncation.truncated) {
        const endLine = offset + Math.max(0, truncation.outputLines - 1);
        text += `\n\n[Showing lines ${offset}-${endLine} of ${totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit)]`;
      }

      return {
        content: [{ type: "text", text }],
        details: { truncated: truncation.truncated },
      };
    },
  };
}
