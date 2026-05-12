import path from "node:path";
import { isIgnoredRelativePath } from "./ignore.js";

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafePathError";
  }
}

export function normalizeRelativePath(input: string): string {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    throw new UnsafePathError("Path is empty.");
  }

  if (path.isAbsolute(trimmed)) {
    throw new UnsafePathError(`Path must be relative: ${trimmed}`);
  }

  const normalized = path.posix.normalize(trimmed.replaceAll("\\", "/"));

  if (normalized === "." || normalized.startsWith("../") || normalized === "..") {
    throw new UnsafePathError(`Path escapes the working directory: ${input}`);
  }

  if (isIgnoredRelativePath(normalized)) {
    throw new UnsafePathError(`Path is ignored by workspace policy: ${normalized}`);
  }

  return normalized;
}

export function resolveWorkspacePath(root: string, relativePath: string): string {
  const normalized = normalizeRelativePath(relativePath);
  const resolved = path.resolve(root, normalized);
  const relative = path.relative(root, resolved);

  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafePathError(`Path escapes the working directory: ${relativePath}`);
  }

  return resolved;
}
