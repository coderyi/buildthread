import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

export function sessionsRoot(): string {
  return path.join(homedir(), ".buildthread", "sessions");
}

export function workspaceHash(cwd: string): string {
  return createHash("sha256").update(path.resolve(cwd)).digest("hex");
}

export function workspaceSessionsDirectory(cwd: string): string {
  return path.join(sessionsRoot(), workspaceHash(cwd));
}

export function sessionFilePath(cwd: string, sessionId: string): string {
  assertSessionId(sessionId);
  return path.join(workspaceSessionsDirectory(cwd), `${sessionId}.jsonl`);
}

export function sessionLockPath(cwd: string, sessionId: string): string {
  assertSessionId(sessionId);
  return path.join(workspaceSessionsDirectory(cwd), `${sessionId}.lock`);
}

export function assertSessionId(sessionId: string): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(sessionId)) {
    throw new Error(`Invalid session ID: ${sessionId}`);
  }
}
