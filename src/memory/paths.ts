import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export function memoriesRoot(): string {
  return path.join(homedir(), ".buildthread", "memories");
}

export function memoryWorkspaceId(cwd: string): string {
  return createHash("sha256").update(path.resolve(cwd)).digest("hex");
}

export function workspaceMemoryDirectory(cwd: string): string {
  return path.join(memoriesRoot(), memoryWorkspaceId(cwd));
}

export function memoryFilePath(cwd: string): string {
  return path.join(workspaceMemoryDirectory(cwd), "MEMORY.md");
}

export function memoryLockPath(cwd: string): string {
  return path.join(workspaceMemoryDirectory(cwd), "memory.lock");
}
