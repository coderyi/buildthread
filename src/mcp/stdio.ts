import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { McpServerConfig } from "./types.js";
import { parseJsonRpcMessage, type JsonRpcMessage, type JsonRpcWritable } from "./json-rpc.js";

const START_TIMEOUT_MS = 1_000;
const STDERR_LIMIT = 4_000;

export interface McpProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

type MessageListener = (message: JsonRpcMessage) => void;
type ErrorListener = (error: Error) => void;
type ExitListener = (exit: McpProcessExit) => void;

export class McpStdioProcess implements JsonRpcWritable {
  private stdoutBuffer = "";
  private stderrBuffer = "";
  private stderrWasTruncated = false;
  private exited = false;
  private killTimer: NodeJS.Timeout | undefined;
  private readonly messageListeners = new Set<MessageListener>();
  private readonly errorListeners = new Set<ErrorListener>();
  private readonly exitListeners = new Set<ExitListener>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.child.stdout.on("data", (chunk: Buffer) => {
      this.handleStdout(chunk.toString("utf8"));
    });

    this.child.stderr.on("data", (chunk: Buffer) => {
      this.appendStderr(chunk.toString("utf8"));
    });

    this.child.on("error", (error) => {
      this.emitError(error);
    });

    this.child.on("exit", (code, signal) => {
      this.exited = true;
      if (this.killTimer !== undefined) {
        clearTimeout(this.killTimer);
        this.killTimer = undefined;
      }
      this.emitExit({ code, signal });
    });
  }

  static async start(config: McpServerConfig, cwd: string): Promise<McpStdioProcess> {
    let child: ChildProcessWithoutNullStreams;

    try {
      child = spawn(config.command, [...config.args], {
        cwd,
        env: {
          ...process.env,
          ...(config.env ?? {})
        },
        stdio: "pipe",
        windowsHide: true
      });
    } catch (error: unknown) {
      throw new Error(`Failed to start MCP server: ${error instanceof Error ? error.message : String(error)}`);
    }

    const processHandle = new McpStdioProcess(child);
    await processHandle.waitForSpawn();
    return processHandle;
  }

  sendJsonRpc(message: JsonRpcMessage): void {
    if (this.exited || this.child.stdin.destroyed) {
      throw new Error("Cannot send MCP message: server process is not running.");
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  onExit(listener: ExitListener): () => void {
    this.exitListeners.add(listener);
    return () => this.exitListeners.delete(listener);
  }

  close(): void {
    if (this.exited) {
      return;
    }

    this.child.kill("SIGTERM");

    if (this.killTimer === undefined) {
      this.killTimer = setTimeout(() => {
        if (!this.exited) {
          this.child.kill("SIGKILL");
        }
      }, 1_000);
      this.killTimer.unref?.();
    }
  }

  isRunning(): boolean {
    return !this.exited;
  }

  stderr(): { readonly text: string; readonly truncated: boolean } {
    return {
      text: this.stderrBuffer.trimEnd(),
      truncated: this.stderrWasTruncated
    };
  }

  private waitForSpawn(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        this.close();
        reject(new Error(`Timed out waiting for MCP server process to start after ${START_TIMEOUT_MS}ms.`));
      }, START_TIMEOUT_MS);
      timer.unref?.();

      const cleanup = () => {
        clearTimeout(timer);
        this.child.off("spawn", onSpawn);
        this.child.off("error", onError);
      };

      const onSpawn = () => {
        cleanup();
        resolve();
      };

      const onError = (error: Error) => {
        cleanup();
        reject(new Error(`Failed to start MCP server: ${error.message}`));
      };

      this.child.once("spawn", onSpawn);
      this.child.once("error", onError);
    });
  }

  private handleStdout(chunk: string): void {
    this.stdoutBuffer += chunk;

    while (true) {
      const newlineIndex = this.stdoutBuffer.indexOf("\n");

      if (newlineIndex < 0) {
        return;
      }

      const rawLine = this.stdoutBuffer.slice(0, newlineIndex).replace(/\r$/u, "");
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

      if (rawLine.trim().length === 0) {
        continue;
      }

      try {
        const message = parseJsonRpcMessage(rawLine);
        for (const listener of this.messageListeners) {
          listener(message);
        }
      } catch (error: unknown) {
        this.emitError(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }

  private appendStderr(chunk: string): void {
    this.stderrBuffer += chunk;

    if (this.stderrBuffer.length > STDERR_LIMIT) {
      this.stderrWasTruncated = true;
      this.stderrBuffer = this.stderrBuffer.slice(this.stderrBuffer.length - STDERR_LIMIT);
    }
  }

  private emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  private emitExit(exit: McpProcessExit): void {
    for (const listener of this.exitListeners) {
      listener(exit);
    }
  }
}
