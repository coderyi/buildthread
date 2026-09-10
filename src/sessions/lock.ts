import { randomUUID } from "node:crypto";
import { open, readFile, unlink, type FileHandle } from "node:fs/promises";

interface LockContents {
  readonly pid: number;
  readonly ownerToken: string;
  readonly createdAt: string;
}

export interface SessionLock {
  readonly path: string;
  readonly ownerToken: string;
  release(): Promise<void>;
}

export async function acquireSessionLock(lockPath: string): Promise<SessionLock> {
  const ownerToken = randomUUID();
  const contents: LockContents = { pid: process.pid, ownerToken, createdAt: new Date().toISOString() };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: FileHandle | undefined;
    let created = false;
    try {
      handle = await open(lockPath, "wx", 0o600);
      created = true;
      await handle.writeFile(`${JSON.stringify(contents)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      return createLock(lockPath, ownerToken);
    } catch (error: unknown) {
      await handle?.close().catch(() => undefined);
      if (created) {
        await unlink(lockPath).catch(() => undefined);
      }
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }

      if (attempt === 0 && (await clearStaleLock(lockPath))) {
        continue;
      }

      throw new Error(`Session is already in use by another process (lock: ${lockPath}).`);
    }
  }

  throw new Error(`Unable to acquire session lock: ${lockPath}`);
}

async function clearStaleLock(lockPath: string): Promise<boolean> {
  let parsed: LockContents;
  try {
    parsed = JSON.parse(await readFile(lockPath, "utf8")) as LockContents;
  } catch {
    return false;
  }

  if (!Number.isInteger(parsed.pid) || parsed.pid <= 0 || typeof parsed.ownerToken !== "string") {
    return false;
  }

  if (isProcessAlive(parsed.pid)) {
    return false;
  }

  const current = await readLock(lockPath);
  if (current?.ownerToken !== parsed.ownerToken) {
    return false;
  }

  await unlink(lockPath).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
  return true;
}

function createLock(lockPath: string, ownerToken: string): SessionLock {
  let released = false;
  return {
    path: lockPath,
    ownerToken,
    async release(): Promise<void> {
      if (released) {
        return;
      }

      const current = await readLock(lockPath);
      if (current?.ownerToken === ownerToken) {
        await unlink(lockPath).catch((error: unknown) => {
          if (!isNodeError(error, "ENOENT")) {
            throw error;
          }
        });
      }
      released = true;
    }
  };
}

async function readLock(lockPath: string): Promise<LockContents | undefined> {
  try {
    return JSON.parse(await readFile(lockPath, "utf8")) as LockContents;
  } catch {
    return undefined;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return !isNodeError(error, "ESRCH");
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
