import { spawn } from "node:child_process";
import path from "node:path";

export type SandboxConfig = { type: "host" } | { type: "docker"; container: string };

export interface ExecOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface Executor {
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  getWorkspacePath(): string;
  toHostPath(targetPath: string): string;
}

export function parseSandboxArg(value: string): SandboxConfig {
  if (value === "host") {
    return { type: "host" };
  }
  if (value.startsWith("docker:")) {
    const container = value.slice("docker:".length);
    if (!container) {
      throw new Error("Docker sandbox requires a container name.");
    }
    return { type: "docker", container };
  }
  throw new Error(`Invalid sandbox value: ${value}`);
}

export async function validateSandbox(config: SandboxConfig): Promise<void> {
  if (config.type === "host") {
    return;
  }

  await execSimple("docker", ["--version"]);
  const result = await execSimple("docker", ["inspect", "-f", "{{.State.Running}}", config.container]);
  if (result.trim() !== "true") {
    throw new Error(`Docker container is not running: ${config.container}`);
  }
}

export function createExecutor(config: SandboxConfig, hostWorkspacePath: string): Executor {
  if (config.type === "host") {
    return new HostExecutor(hostWorkspacePath);
  }
  return new DockerExecutor(config.container, hostWorkspacePath);
}

class HostExecutor implements Executor {
  constructor(private readonly workspacePath: string) {}

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      const child = spawn("bash", ["-lc", command], {
        cwd: this.workspacePath,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timeoutHandle =
        options?.timeout && options.timeout > 0
          ? setTimeout(() => {
              timedOut = true;
              if (child.pid) {
                killProcessTree(child.pid);
              }
            }, options.timeout * 1000)
          : undefined;

      const onAbort = () => {
        if (child.pid) {
          killProcessTree(child.pid);
        }
      };

      if (options?.signal) {
        if (options.signal.aborted) {
          onAbort();
        } else {
          options.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      child.stdout.on("data", (chunk: Buffer | string) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer | string) => {
        stderr += chunk.toString();
      });

      child.on("close", (code) => {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        if (options?.signal) {
          options.signal.removeEventListener("abort", onAbort);
        }

        if (options?.signal?.aborted) {
          reject(new Error(`${stdout}\n${stderr}\nCommand aborted`.trim()));
          return;
        }
        if (timedOut) {
          reject(new Error(`${stdout}\n${stderr}\nCommand timed out`.trim()));
          return;
        }

        resolve({ stdout, stderr, code: code ?? 0 });
      });
    });
  }

  getWorkspacePath(): string {
    return this.workspacePath;
  }

  toHostPath(targetPath: string): string {
    return path.isAbsolute(targetPath) ? targetPath : path.resolve(this.workspacePath, targetPath);
  }
}

class DockerExecutor implements Executor {
  constructor(
    private readonly container: string,
    private readonly hostWorkspacePath: string,
  ) {}

  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    const dockerCommand = `docker exec -w /workspace ${this.container} sh -c ${shellEscape(command)}`;
    const hostExecutor = new HostExecutor(this.hostWorkspacePath);
    return hostExecutor.exec(dockerCommand, options);
  }

  getWorkspacePath(): string {
    return "/workspace";
  }

  toHostPath(targetPath: string): string {
    const sandboxPath = path.isAbsolute(targetPath) ? targetPath : path.posix.join("/workspace", targetPath);
    if (sandboxPath === "/workspace") {
      return this.hostWorkspacePath;
    }
    if (sandboxPath.startsWith("/workspace/")) {
      return path.join(this.hostWorkspacePath, sandboxPath.slice("/workspace/".length));
    }
    return sandboxPath;
  }
}

function shellEscape(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function killProcessTree(pid: number): void {
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Ignore if already dead.
    }
  }
}

function execSimple(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr || `Exit code ${code ?? -1}`));
    });
  });
}
