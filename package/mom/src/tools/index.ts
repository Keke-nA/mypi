import type { AgentTool } from "@mypi/agent";
import type { Executor } from "../sandbox.js";
import { createAttachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import { createWriteTool } from "./write.js";

export function createMomTools(
  executor: Executor,
  uploadFile: (filePath: string, title?: string) => Promise<void>,
): AgentTool<any>[] {
  return [
    createReadTool(executor),
    createBashTool(executor),
    createEditTool(executor),
    createWriteTool(executor),
    createAttachTool(uploadFile),
  ];
}
