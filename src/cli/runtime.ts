import { stat } from "node:fs/promises";
import path from "node:path";
import type { CliArgs } from "./args.js";

export interface RuntimeOptions {
  readonly cwd: string;
  readonly model: string;
  readonly apiKey: string;
  readonly stream: boolean;
}

export async function createRuntimeOptions(args: CliArgs): Promise<RuntimeOptions> {
  const cwd = path.resolve(args.cwd);
  const info = await stat(cwd).catch(() => undefined);

  if (info === undefined) {
    throw new Error(`Working directory does not exist: ${cwd}`);
  }

  if (!info.isDirectory()) {
    throw new Error(`Working directory is not a directory: ${cwd}`);
  }

  const apiKey = args.apiKey ?? process.env.DEEPSEEK_API_KEY;

  if (apiKey === undefined || apiKey.trim().length === 0) {
    throw new Error("DeepSeek API key is required. Set DEEPSEEK_API_KEY or pass --api-key.");
  }

  return {
    cwd,
    model: args.model,
    apiKey,
    stream: args.stream
  };
}
