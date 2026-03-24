import { stdin, stdout } from "node:process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { configureAI } from "@mypi/ai";
import { Agent } from "@mypi/agent";
import {
  AgentSession,
  convertToLlm,
  createBranchSummaryGenerator,
  createCodingSystemPrompt,
  createCompactionSummaryGenerator,
  createWorkspaceTools,
  resolveOpenAIModel,
  resolvePersistedModel,
} from "../dist/index.js";

async function readStdin() {
  let data = "";
  for await (const chunk of stdin) {
    data += chunk;
  }
  return data.trim();
}

function extractAssistantText(message) {
  if (!message || message.role !== "assistant") return "";
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("");
}

async function main() {
  const raw = await readStdin();
  if (!raw) throw new Error("Expected JSON config on stdin.");

  const input = JSON.parse(raw);
  const urls = Array.isArray(input.urls) ? input.urls : [];
  const apiKey = typeof input.apiKey === "string" ? input.apiKey : "";
  const modelId = typeof input.model === "string" ? input.model : "gpt-5.4";

  if (!apiKey) throw new Error("Missing apiKey.");

  const errors = [];
  for (const url of urls) {
    const sessionDir = await mkdtemp(path.join(os.tmpdir(), "mypi-coding-agent-session-"));
    try {
      configureAI({ providers: { openai: { apiKey, baseUrl: url } } });
      const workspace = path.resolve(process.cwd(), "../..");
      const model = resolveOpenAIModel(modelId, url);
      const agent = new Agent({
        initialState: { model },
        convertToLlm,
        getApiKey: async () => apiKey,
      });
      agent.setSystemPrompt(createCodingSystemPrompt(workspace));
      agent.setTools(createWorkspaceTools(workspace));

      const session = await AgentSession.create({
        agent,
        cwd: workspace,
        sessionDir,
        resolveModel: (modelRef) => resolvePersistedModel(modelRef, url),
      });

      await session.prompt("Use the read tool to inspect README.md, then reply with exactly the repository name and nothing else.");
      const firstAssistant = [...session.agent.state.messages].reverse().find((message) => message.role === "assistant");
      const firstText = extractAssistantText(firstAssistant).trim();
      if (!firstAssistant || !firstText) {
        throw new Error("No assistant reply for first prompt.");
      }

      const entriesAfterFirstPrompt = session.runtime.getSessionManager().getEntries();
      const usedTool = entriesAfterFirstPrompt.some(
        (entry) => entry.type === "message" && entry.message.role === "toolResult",
      );
      if (!usedTool) {
        throw new Error("Smoke prompt did not produce a persisted toolResult entry.");
      }

      const firstUserEntry = entriesAfterFirstPrompt.find(
        (entry) => entry.type === "message" && entry.message.role === "user",
      );
      if (!firstUserEntry) {
        throw new Error("No user entry recorded in session.");
      }

      await session.navigateTree(firstUserEntry.id, {
        summarize: true,
        generateSummary: createBranchSummaryGenerator(session.agent.state.model),
      });
      await session.prompt("Reply with exactly TREE_OK and nothing else.");
      await session.compact({
        generateSummary: createCompactionSummaryGenerator(session.agent.state.model),
        settings: { keepRecentTokens: 500 },
      });

      stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            url,
            model: modelId,
            firstReply: firstText,
            usedTool,
            sessionEntries: session.runtime.getSessionManager().getEntries().length,
            finalRoles: session.agent.state.messages.map((message) => message.role),
          },
          null,
          2,
        )}\n`,
      );
      return;
    } catch (error) {
      errors.push({
        url,
        name: error instanceof Error ? error.name : "Error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await rm(sessionDir, { recursive: true, force: true });
    }
  }

  stdout.write(`${JSON.stringify({ ok: false, errors }, null, 2)}\n`);
  process.exitCode = 1;
}

await main();
