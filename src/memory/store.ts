import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import { memoryFilePath, memoryLockPath, workspaceMemoryDirectory } from "./paths.js";
import {
  MAX_MEMORY_FILE_BYTES,
  MAX_MEMORY_TEXT_CHARS,
  MEMORY_SCHEMA_VERSION,
  type AddMemoryResult,
  type MemoryContext,
  type MemoryEntry,
  type RemoveMemoryResult
} from "./types.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const ENTRY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ENTRY_HEADING_PATTERN = /^## (.+)$/gmu;
const SCHEMA_PATTERN = /<!--\s*buildthread-memory-schema:\s*(\d+)\s*-->/gu;
const PRIVATE_KEY_PATTERN = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/iu;

const FILE_HEADER = `# Buildthread Project Memory

<!-- buildthread-memory-schema: ${MEMORY_SCHEMA_VERSION} -->

> Durable context for this workspace. Do not store API keys, passwords, tokens, or other credentials here.
`;

interface ParsedEntry extends MemoryEntry {
  readonly start: number;
  readonly end: number;
}

interface ParsedMemoryFile {
  readonly entries: readonly ParsedEntry[];
  readonly firstHeadingOffset?: number;
}

interface MemoryLock {
  release(): Promise<void>;
}

interface LockContents {
  readonly pid: number;
  readonly ownerToken: string;
  readonly createdAt: string;
}

export function getMemoryPath(cwd: string): string {
  return memoryFilePath(cwd);
}

export async function showMemory(cwd: string): Promise<string | undefined> {
  const content = await readMemoryFile(cwd);
  return content === undefined || content.trim().length === 0 ? undefined : content;
}

export async function loadMemoryContext(cwd: string): Promise<MemoryContext> {
  let buffer: Buffer;
  try {
    buffer = await readFile(memoryFilePath(cwd));
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      return { truncated: false };
    }
    return {
      truncated: false,
      warning: `Project memory could not be read: ${displayError(error)}`
    };
  }

  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    return {
      truncated: false,
      warning: "Project memory is not valid UTF-8 and was not loaded."
    };
  }

  if (content.trim().length === 0 || content === FILE_HEADER) {
    return { truncated: false };
  }

  try {
    parseMemoryFile(content);
  } catch (error: unknown) {
    return {
      truncated: false,
      warning: `Project memory has an invalid managed format and was not loaded: ${displayError(error)}`
    };
  }

  const permissionWarning = await memoryPermissionWarning(cwd);
  if (buffer.byteLength <= MAX_MEMORY_FILE_BYTES) {
    return {
      content,
      truncated: false,
      ...(permissionWarning === undefined ? {} : { warning: permissionWarning })
    };
  }

  const limited = buffer.subarray(0, MAX_MEMORY_FILE_BYTES).toString("utf8").replace(/\uFFFD$/u, "");
  const warning = `Project memory exceeds ${formatBytes(MAX_MEMORY_FILE_BYTES)} and was truncated for this request.`;
  return {
    content: `${limited.trimEnd()}\n\n[${warning}]`,
    truncated: true,
    warning: permissionWarning === undefined ? warning : `${warning} ${permissionWarning}`
  };
}

export async function addMemory(cwd: string, input: string): Promise<AddMemoryResult> {
  const content = normalizeMemoryText(input);
  await ensureMemoryDirectory(cwd);
  const lock = await acquireMemoryLock(cwd);
  try {
    const current = normalizeLineEndings((await readMemoryFile(cwd)) ?? "");
    const parsed = parseMemoryFile(current);
    const duplicate = parsed.entries.find((entry) => entry.content === content);
    if (duplicate !== undefined) {
      return { entry: duplicate, duplicate: true };
    }

    const entry: MemoryEntry = {
      id: randomUUID(),
      addedAt: new Date().toISOString(),
      content
    };
    const next = insertEntry(current, parsed, entry);
    if (Buffer.byteLength(next, "utf8") > MAX_MEMORY_FILE_BYTES) {
      throw new Error(`Project memory would exceed ${formatBytes(MAX_MEMORY_FILE_BYTES)}. Remove or consolidate older entries first.`);
    }
    await writeMemoryFileAtomically(cwd, next);
    return { entry, duplicate: false };
  } finally {
    await lock.release();
  }
}

export async function removeMemory(cwd: string, memoryId: string): Promise<RemoveMemoryResult> {
  assertMemoryId(memoryId);
  if (await readMemoryFile(cwd) === undefined) {
    throw new Error(`Memory entry not found: ${memoryId}`);
  }
  await ensureMemoryDirectory(cwd);
  const lock = await acquireMemoryLock(cwd);
  try {
    const stored = await readMemoryFile(cwd);
    if (stored === undefined) {
      throw new Error(`Memory entry not found: ${memoryId}`);
    }
    const current = normalizeLineEndings(stored);
    const parsed = parseMemoryFile(current);
    const entry = parsed.entries.find((candidate) => candidate.id === memoryId);
    if (entry === undefined) {
      throw new Error(`Memory entry not found: ${memoryId}`);
    }
    const before = current.slice(0, entry.start).trimEnd();
    const after = current.slice(entry.end).trimStart();
    const next = after.length === 0 ? `${before}\n` : `${before}\n\n${after}`;
    await writeMemoryFileAtomically(cwd, next);
    return { entry };
  } finally {
    await lock.release();
  }
}

function normalizeMemoryText(input: string): string {
  if (input.includes("\0")) {
    throw new Error("Memory text cannot contain NUL characters.");
  }
  if (PRIVATE_KEY_PATTERN.test(input)) {
    throw new Error("Memory text appears to contain a private key and was not saved.");
  }
  const normalized = input.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    throw new Error("Memory text is required.");
  }
  if (normalized.length > MAX_MEMORY_TEXT_CHARS) {
    throw new Error(`Memory text cannot exceed ${MAX_MEMORY_TEXT_CHARS.toLocaleString("en-US")} characters.`);
  }
  return normalized;
}

function parseMemoryFile(input: string): ParsedMemoryFile {
  const content = normalizeLineEndings(input);
  const schemas = [...content.matchAll(SCHEMA_PATTERN)];
  if (schemas.length > 1) {
    throw new Error("multiple schema markers found");
  }
  const schema = schemas[0]?.[1];
  if (schema !== undefined && Number(schema) !== MEMORY_SCHEMA_VERSION) {
    throw new Error(`unsupported schema version ${schema}`);
  }

  const headings = [...content.matchAll(ENTRY_HEADING_PATTERN)].map((match) => ({
    title: match[1] ?? "",
    start: match.index
  }));
  const entries: ParsedEntry[] = [];
  const ids = new Set<string>();

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]!;
    const end = headings[index + 1]?.start ?? content.length;
    const block = content.slice(heading.start, end).trimEnd();
    const looksManaged = ENTRY_ID_PATTERN.test(heading.title) || /^## .+\n\n- Added:/u.test(block);
    if (!looksManaged) {
      continue;
    }
    const match = /^## ([0-9a-f-]+)\n\n- Added: `([^`\n]+)`\n- Memory: ([^\n]+)$/iu.exec(block);
    if (match === null || !ENTRY_ID_PATTERN.test(match[1] ?? "")) {
      throw new Error(`invalid managed entry at heading "${heading.title}"`);
    }
    const id = match[1]!;
    const addedAt = match[2]!;
    const entryContent = match[3]!.trim();
    const addedDate = new Date(addedAt);
    if (Number.isNaN(addedDate.getTime()) || addedDate.toISOString() !== addedAt) {
      throw new Error(`invalid timestamp for memory ${id}`);
    }
    if (entryContent.length === 0 || entryContent.length > MAX_MEMORY_TEXT_CHARS) {
      throw new Error(`invalid text length for memory ${id}`);
    }
    if (ids.has(id)) {
      throw new Error(`duplicate memory ID ${id}`);
    }
    ids.add(id);
    entries.push({ id, addedAt, content: entryContent, start: heading.start, end });
  }

  return {
    entries,
    ...(headings[0] === undefined ? {} : { firstHeadingOffset: headings[0].start })
  };
}

function normalizeLineEndings(value: string): string {
  return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

function insertEntry(current: string, parsed: ParsedMemoryFile, entry: MemoryEntry): string {
  const rendered = renderEntry(entry);
  if (current.trim().length === 0) {
    return `${FILE_HEADER}\n${rendered}\n`;
  }
  if (!SCHEMA_PATTERN.test(current)) {
    SCHEMA_PATTERN.lastIndex = 0;
    return `${FILE_HEADER}\n${rendered}\n\n${current.trim()}\n`;
  }
  SCHEMA_PATTERN.lastIndex = 0;
  const offset = parsed.firstHeadingOffset ?? current.length;
  const before = current.slice(0, offset).trimEnd();
  const after = current.slice(offset).trimStart();
  return after.length === 0
    ? `${before}\n\n${rendered}\n`
    : `${before}\n\n${rendered}\n\n${after}`;
}

function renderEntry(entry: MemoryEntry): string {
  return `## ${entry.id}\n\n- Added: \`${entry.addedAt}\`\n- Memory: ${entry.content}`;
}

async function readMemoryFile(cwd: string): Promise<string | undefined> {
  try {
    return await readFile(memoryFilePath(cwd), "utf8");
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    throw error;
  }
}

async function ensureMemoryDirectory(cwd: string): Promise<void> {
  await mkdir(workspaceMemoryDirectory(cwd), { recursive: true, mode: DIRECTORY_MODE });
}

async function writeMemoryFileAtomically(cwd: string, content: string): Promise<void> {
  const directory = workspaceMemoryDirectory(cwd);
  const temporaryPath = path.join(directory, `.MEMORY.${randomUUID()}.tmp`);
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporaryPath, "wx", FILE_MODE);
    await handle.writeFile(content, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporaryPath, memoryFilePath(cwd));
  } catch (error: unknown) {
    await handle?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function acquireMemoryLock(cwd: string): Promise<MemoryLock> {
  const lockPath = memoryLockPath(cwd);
  const ownerToken = randomUUID();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let handle: FileHandle | undefined;
    let created = false;
    try {
      handle = await open(lockPath, "wx", FILE_MODE);
      created = true;
      const contents: LockContents = { pid: process.pid, ownerToken, createdAt: new Date().toISOString() };
      await handle.writeFile(JSON.stringify(contents), "utf8");
      await handle.sync();
      await handle.close();
      return createMemoryLock(lockPath, ownerToken);
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
      throw new Error("Project memory is already being changed by another process.");
    }
  }
  throw new Error("Unable to acquire the project memory lock.");
}

function createMemoryLock(lockPath: string, ownerToken: string): MemoryLock {
  let released = false;
  return {
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

async function clearStaleLock(lockPath: string): Promise<boolean> {
  const existing = await readLock(lockPath);
  if (existing === undefined || !Number.isInteger(existing.pid) || existing.pid <= 0 || isProcessAlive(existing.pid)) {
    return false;
  }
  const current = await readLock(lockPath);
  if (current?.ownerToken !== existing.ownerToken) {
    return false;
  }
  await unlink(lockPath).catch((error: unknown) => {
    if (!isNodeError(error, "ENOENT")) {
      throw error;
    }
  });
  return true;
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

async function memoryPermissionWarning(cwd: string): Promise<string | undefined> {
  const info = await stat(memoryFilePath(cwd)).catch(() => undefined);
  if (info !== undefined && (info.mode & 0o077) !== 0) {
    return "Project memory permissions allow access by other users. Review the memory file permissions.";
  }
  return undefined;
}

function assertMemoryId(memoryId: string): void {
  if (!ENTRY_ID_PATTERN.test(memoryId)) {
    throw new Error(`Invalid memory ID: ${memoryId}`);
  }
}

function formatBytes(bytes: number): string {
  return `${bytes / 1024} KiB`;
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
