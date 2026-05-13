import { readFile, stat } from "node:fs/promises";
import { sha256 } from "../workspace/hash.js";
import { normalizeRelativePath, resolveWorkspacePath } from "../workspace/paths.js";
import type { ToolContext, ToolDefinition, ToolObservation } from "./types.js";

const MAX_READ_FILE_BYTES = 256 * 1024;

export const readFileTool: ToolDefinition = {
  name: "read_file",
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolObservation> {
    const path = args.path;

    if (typeof path !== "string") {
      return { ok: false, tool: "read_file", error: "read_file requires arguments.path to be a string." };
    }

    try {
      const relativePath = normalizeRelativePath(path);
      const absolutePath = resolveWorkspacePath(context.cwd, relativePath);
      const info = await stat(absolutePath);

      if (!info.isFile()) {
        return { ok: false, tool: "read_file", error: `${relativePath} is not a file.` };
      }

      if (info.size > MAX_READ_FILE_BYTES) {
        return {
          ok: false,
          tool: "read_file",
          error: `${relativePath} is too large to read (${info.size} bytes).`
        };
      }

      const buffer = await readFile(absolutePath);

      if (buffer.byteLength > MAX_READ_FILE_BYTES) {
        return {
          ok: false,
          tool: "read_file",
          error: `${relativePath} is too large to read (${buffer.byteLength} bytes).`
        };
      }

      if (looksBinary(buffer)) {
        return { ok: false, tool: "read_file", error: `${relativePath} appears to be a binary file.` };
      }

      const content = buffer.toString("utf8");

      return {
        ok: true,
        tool: "read_file",
        path: relativePath,
        content,
        hash: sha256(content),
        size: info.size
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, tool: "read_file", error: message };
    }
  }
};

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}
