import { spawn } from "node:child_process";
import type { ToolContext, ToolDefinition, ToolObservation } from "./types.js";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_STDOUT_CHARS = 8_000;
const MAX_STDERR_CHARS = 8_000;
const FORCE_KILL_GRACE_MS = 2_000;

export const shellTool: ToolDefinition = {
  name: "shell",
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolObservation> {
    const command = args.command;

    if (typeof command !== "string" || command.trim().length === 0) {
      return { ok: false, tool: "shell", error: "shell requires arguments.command to be a non-empty string." };
    }

    try {
      const timeoutMs = parseTimeoutMs(args.timeoutMs);
      return await executeShellCommand(command, context.cwd, timeoutMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, tool: "shell", error: message };
    }
  }
};

function parseTimeoutMs(value: unknown): number {
  if (value === undefined) {
    return DEFAULT_TIMEOUT_MS;
  }

  if (!Number.isInteger(value) || typeof value !== "number" || value <= 0) {
    throw new Error("shell arguments.timeoutMs must be a positive integer when provided.");
  }

  return Math.min(value, MAX_TIMEOUT_MS);
}

function executeShellCommand(command: string, cwd: string, timeoutMs: number): Promise<ToolObservation> {
  const startedAt = Date.now();
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let timedOut = false;
  let settled = false;
  let forceKillTimer: NodeJS.Timeout | undefined;

  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimer = setTimeout(() => {
      child.kill("SIGKILL");
    }, FORCE_KILL_GRACE_MS);
  }, timeoutMs);

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    const result = appendLimited(stdout, chunk, MAX_STDOUT_CHARS);
    stdout = result.value;
    stdoutTruncated ||= result.truncated;
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string) => {
    const result = appendLimited(stderr, chunk, MAX_STDERR_CHARS);
    stderr = result.value;
    stderrTruncated ||= result.truncated;
  });

  return new Promise((resolve) => {
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }

      resolve({ ok: false, tool: "shell", error: error.message });
    });

    child.on("close", (exitCode, signal) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }

      resolve({
        ok: true,
        tool: "shell",
        command,
        exitCode,
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
        truncated: stdoutTruncated || stderrTruncated
      });
    });
  });
}

function appendLimited(current: string, chunk: string, maxChars: number): { readonly value: string; readonly truncated: boolean } {
  if (current.length >= maxChars) {
    return { value: current, truncated: true };
  }

  const remaining = maxChars - current.length;

  if (chunk.length <= remaining) {
    return { value: current + chunk, truncated: false };
  }

  return { value: current + chunk.slice(0, remaining), truncated: true };
}
