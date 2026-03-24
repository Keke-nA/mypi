import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@mypi/ai";
import type { AgentTool } from "@mypi/agent";

export type WorkspaceToolName = "read" | "write" | "edit" | "bash";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 50 * 1024;
const MAX_OUTPUT_LINES = 2000;

function truncateText(text: string): { text: string; truncated: boolean } {
	let value = text;
	let truncated = false;
	const lines = value.split(/\r?\n/);
	if (lines.length > MAX_OUTPUT_LINES) {
		value = lines.slice(0, MAX_OUTPUT_LINES).join("\n");
		truncated = true;
	}
	while (Buffer.byteLength(value, "utf8") > MAX_OUTPUT_BYTES) {
		value = value.slice(0, Math.max(0, Math.floor(value.length * 0.9)));
		truncated = true;
	}
	return {
		text: truncated ? `${value}\n[output truncated]` : value,
		truncated,
	};
}

function isBinary(buffer: Buffer): boolean {
	for (let index = 0; index < Math.min(buffer.length, 8000); index++) {
		if (buffer[index] === 0) {
			return true;
		}
	}
	return false;
}

function formatPath(root: string, filePath: string): string {
	const relative = path.relative(root, filePath);
	return relative && !relative.startsWith("..") ? relative : filePath;
}

function ensureInsideWorkspace(workspaceRoot: string, targetPath: string): string {
	const resolvedRoot = path.resolve(workspaceRoot);
	const resolvedTarget = path.resolve(resolvedRoot, targetPath);
	if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
		throw new Error(`Path is outside workspace: ${targetPath}`);
	}
	return resolvedTarget;
}

function toTextOutput(title: string, body: string) {
	return [{ type: "text" as const, text: body ? `${title}\n${body}` : title }];
}

export function getWorkspaceToolNames(): WorkspaceToolName[] {
	return ["read", "write", "edit", "bash"];
}

export function createWorkspaceTools(workspaceRoot: string, enabledTools: WorkspaceToolName[] = getWorkspaceToolNames()): AgentTool<any>[] {
	const root = path.resolve(workspaceRoot);

	const readTool: AgentTool<typeof readSchema, { path: string; truncated: boolean }> = {
		name: "read",
		label: "Read File",
		description:
			"Read a text file or list a directory inside the workspace. Use offset/limit for large files. Paths are relative to the workspace root unless absolute.",
		parameters: readSchema,
		async execute(_toolCallId, params) {
			const filePath = ensureInsideWorkspace(root, params.path);
			const info = await stat(filePath);
			if (info.isDirectory()) {
				const entries = (await readdir(filePath, { withFileTypes: true }))
					.map((entry) => `${entry.isDirectory() ? "[dir]" : "[file]"} ${entry.name}`)
					.join("\n");
				const truncated = truncateText(entries);
				return {
					content: toTextOutput(`Directory listing: ${formatPath(root, filePath)}`, truncated.text),
					details: { path: filePath, truncated: truncated.truncated },
				};
			}

			const buffer = await readFile(filePath);
			if (isBinary(buffer)) {
				return {
					content: toTextOutput(`Binary file: ${formatPath(root, filePath)}`, "File appears to be binary and was not displayed."),
					details: { path: filePath, truncated: false },
				};
			}

			const lines = buffer.toString("utf8").split(/\r?\n/);
			const offset = Math.max(1, params.offset ?? 1);
			const limit = Math.max(1, params.limit ?? 200);
			const slice = lines.slice(offset - 1, offset - 1 + limit);
			const numbered = slice.map((line, index) => `${offset + index}| ${line}`).join("\n");
			const truncated = truncateText(numbered);
			return {
				content: toTextOutput(`File: ${formatPath(root, filePath)}`, truncated.text),
				details: { path: filePath, truncated: truncated.truncated },
			};
		},
	};

	const writeTool: AgentTool<typeof writeSchema, { path: string; bytes: number }> = {
		name: "write",
		label: "Write File",
		description: "Create or overwrite a text file inside the workspace. Parent directories are created automatically.",
		parameters: writeSchema,
		async execute(_toolCallId, params) {
			const filePath = ensureInsideWorkspace(root, params.path);
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, params.content, "utf8");
			const bytes = Buffer.byteLength(params.content, "utf8");
			return {
				content: toTextOutput(`Wrote ${bytes} bytes`, formatPath(root, filePath)),
				details: { path: filePath, bytes },
			};
		},
	};

	const editTool: AgentTool<typeof editSchema, { path: string; replacements: number }> = {
		name: "edit",
		label: "Edit File",
		description:
			"Edit a text file by replacing an exact text fragment with new text. Fails if the old text is not found.",
		parameters: editSchema,
		async execute(_toolCallId, params) {
			const filePath = ensureInsideWorkspace(root, params.path);
			const original = await readFile(filePath, "utf8");
			const index = original.indexOf(params.oldText);
			if (index < 0) {
				throw new Error(`Old text not found in ${formatPath(root, filePath)}`);
			}
			const updated = `${original.slice(0, index)}${params.newText}${original.slice(index + params.oldText.length)}`;
			await writeFile(filePath, updated, "utf8");
			return {
				content: toTextOutput("Applied edit", formatPath(root, filePath)),
				details: { path: filePath, replacements: 1 },
			};
		},
	};

	const bashTool: AgentTool<typeof bashSchema, { exitCode: number; stdout: string; stderr: string; truncated: boolean }> = {
		name: "bash",
		label: "Run Bash",
		description:
			"Run a bash command in the workspace root. Use this for search, build, tests, git, and other shell operations. Returns combined stdout/stderr.",
		parameters: bashSchema,
		async execute(_toolCallId, params) {
			const timeout = typeof params.timeout === "number" ? params.timeout * 1000 : 30_000;
			try {
				const result = await execFileAsync("bash", ["-lc", params.command], {
					cwd: root,
					timeout,
					maxBuffer: 8 * 1024 * 1024,
				});
				const text = [`$ ${params.command}`, result.stdout?.trimEnd(), result.stderr?.trimEnd()].filter(Boolean).join("\n");
				const truncated = truncateText(text);
				return {
					content: toTextOutput("Command completed", truncated.text),
					details: { exitCode: 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "", truncated: truncated.truncated },
				};
			} catch (error) {
				const details = error as { stdout?: string; stderr?: string; code?: number | string; message?: string };
				const text = [
					`$ ${params.command}`,
					details.stdout?.trimEnd(),
					details.stderr?.trimEnd(),
					details.message,
				].filter(Boolean).join("\n");
				const truncated = truncateText(text);
				throw new Error(truncated.text || `Command failed: ${params.command}`);
			}
		},
	};

	const allTools: Record<WorkspaceToolName, AgentTool<any>> = {
		read: readTool as AgentTool<any>,
		write: writeTool as AgentTool<any>,
		edit: editTool as AgentTool<any>,
		bash: bashTool as AgentTool<any>,
	};
	return enabledTools.map((tool) => allTools[tool]).filter(Boolean);
}

const readSchema = Type.Object({
	path: Type.String(),
	offset: Type.Optional(Type.Integer({ minimum: 1 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000 })),
});

const writeSchema = Type.Object({
	path: Type.String(),
	content: Type.String(),
});

const editSchema = Type.Object({
	path: Type.String(),
	oldText: Type.String(),
	newText: Type.String(),
});

const bashSchema = Type.Object({
	command: Type.String(),
	timeout: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
});
