import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, stat, unlink, type FileHandle } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent, SessionEventRecorder } from "../agent/session.js";
import type { ToolObservation } from "../tools/types.js";
import { acquireSessionLock, type SessionLock } from "./lock.js";
import { assertSessionId, sessionFilePath, sessionLockPath, workspaceSessionsDirectory } from "./paths.js";
import { validateAndReduceSession } from "./reducer.js";
import {
  SESSION_PROMPT_VERSION,
  SESSION_SCHEMA_VERSION,
  type LoadedSession,
  type SessionCreatedEvent,
  type SessionEvent,
  type SessionListItem
} from "./types.js";

const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const MAX_RECORDED_VALUE_CHARS = 32_000;
const activeHandles = new Set<SessionHandle>();

export interface CreateSessionOptions {
  readonly cwd: string;
  readonly model: string;
  readonly appVersion: string;
  readonly maxHistoryTurns: number;
  readonly secrets?: readonly string[];
}

export interface ResumeSessionResult {
  readonly handle: SessionHandle;
  readonly loaded: LoadedSession;
  readonly compatibilityWarnings: readonly string[];
}

export class SessionHandle implements SessionEventRecorder {
  readonly sessionId: string;
  readonly cwd: string;
  private readonly filePath: string;
  private readonly lock: SessionLock;
  private file: FileHandle;
  private nextSequence: number;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  private readonly callIds = new Map<string, string>();
  private readonly secrets: readonly string[];
  private activeTurnId: string | undefined;

  constructor(options: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly filePath: string;
    readonly lock: SessionLock;
    readonly file: FileHandle;
    readonly nextSequence: number;
    readonly secrets?: readonly string[];
  }) {
    this.sessionId = options.sessionId;
    this.cwd = options.cwd;
    this.filePath = options.filePath;
    this.lock = options.lock;
    this.file = options.file;
    this.nextSequence = options.nextSequence;
    this.secrets = options.secrets ?? [];
    activeHandles.add(this);
  }

  async startTurn(prompt: string): Promise<string> {
    if (this.activeTurnId !== undefined) {
      throw new Error(`Session ${this.sessionId} already has an active turn.`);
    }
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    try {
      await this.append({ type: "turn_started", turnId, content: prompt });
    } catch (error: unknown) {
      this.activeTurnId = undefined;
      throw error;
    }
    return turnId;
  }

  async recordAgentEvent(turnId: string, event: AgentEvent): Promise<void> {
    if (event.type === "tool_call") {
      const callId = randomUUID();
      this.callIds.set(callKey(turnId, event.round), callId);
      await this.append({
        type: "tool_call",
        turnId,
        callId,
        round: event.round,
        tool: event.action.tool,
        arguments: event.action.arguments
      });
      return;
    }

    if (event.type === "approval_granted" || event.type === "approval_denied") {
      await this.append({
        type: "approval_decided",
        turnId,
        callId: this.requireCallId(turnId, event.round),
        approved: event.type === "approval_granted",
        subject: event.request.command
      });
      if (event.type === "approval_denied") {
        await this.recordObservation(turnId, event.round, event.observation);
      }
      return;
    }

    if (event.type === "tool_observation") {
      await this.recordObservation(turnId, event.round, event.observation);
    }
  }

  async completeTurn(turnId: string, assistantMessage: string): Promise<void> {
    await this.append({ type: "turn_completed", turnId, content: assistantMessage });
    this.activeTurnId = undefined;
    this.clearTurnCalls(turnId);
  }

  async failTurn(turnId: string, error: unknown): Promise<void> {
    await this.append({ type: "turn_failed", turnId, error: displayError(error) });
    this.activeTurnId = undefined;
    this.clearTurnCalls(turnId);
  }

  async interruptTurn(turnId: string, reason: string): Promise<void> {
    await this.append({ type: "turn_interrupted", turnId, reason });
    this.activeTurnId = undefined;
    this.clearTurnCalls(turnId);
  }

  async flush(): Promise<void> {
    await this.queue;
    if (!this.closed) {
      await this.file.sync();
    }
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.activeTurnId !== undefined) {
      await this.interruptTurn(this.activeTurnId, "Session closed before the active turn completed.").catch(() => undefined);
    }
    this.closed = true;
    let failure: unknown;
    try {
      await this.queue;
    } catch (error: unknown) {
      failure = error;
    } finally {
      try {
        await this.file.sync();
      } catch (error: unknown) {
        failure ??= error;
      }
      try {
        await this.file.close();
      } catch (error: unknown) {
        failure ??= error;
      }
      try {
        await this.lock.release();
      } catch (error: unknown) {
        failure ??= error;
      }
      activeHandles.delete(this);
    }
    if (failure !== undefined) {
      throw failure;
    }
  }

  async load(): Promise<LoadedSession> {
    await this.flush();
    return loadSession(this.cwd, this.sessionId);
  }

  private async recordObservation(turnId: string, round: number, observation: ToolObservation): Promise<void> {
    const limited = limitRecordedValue(sanitizeForStorage(observation, this.secrets));
    const limitedError = observation.ok
      ? undefined
      : limitRecordedValue(sanitizeForStorage(observation.error, this.secrets));
    const common = {
      type: "tool_result" as const,
      turnId,
      callId: this.requireCallId(turnId, round),
      tool: String(observation.tool),
      ok: observation.ok === true,
      truncated: limited.truncated || limitedError?.truncated === true ||
        ("truncated" in observation && observation.truncated === true)
    };
    await this.append(observation.ok === true
      ? { ...common, result: limited.value }
      : { ...common, error: String(limitedError?.value ?? observation.error) });
  }

  private requireCallId(turnId: string, round: number): string {
    const value = this.callIds.get(callKey(turnId, round));
    if (value === undefined) {
      throw new Error(`Missing recorded tool call for round ${round}.`);
    }
    return value;
  }

  private clearTurnCalls(turnId: string): void {
    for (const key of this.callIds.keys()) {
      if (key.startsWith(`${turnId}:`)) {
        this.callIds.delete(key);
      }
    }
  }

  private append(payload: Record<string, unknown>): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error(`Session ${this.sessionId} is closed.`));
    }
    const event = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId: this.sessionId,
      sequence: this.nextSequence,
      timestamp: new Date().toISOString(),
      ...(sanitizeForStorage(payload, this.secrets) as Record<string, unknown>)
    };
    this.nextSequence += 1;
    const write = this.queue.then(async () => {
      await this.file.write(`${JSON.stringify(event)}\n`);
      await this.file.sync();
    });
    this.queue = write;
    return write;
  }
}

export async function createSession(options: CreateSessionOptions): Promise<ResumeSessionResult> {
  await ensureSessionsDirectory(options.cwd);
  const sessionId = randomUUID();
  const filePath = sessionFilePath(options.cwd, sessionId);
  const lock = await acquireSessionLock(sessionLockPath(options.cwd, sessionId));
  let file: FileHandle | undefined;
  try {
    file = await open(filePath, "wx+", FILE_MODE);
    const timestamp = new Date().toISOString();
    const created: SessionCreatedEvent = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      sessionId,
      sequence: 0,
      timestamp,
      type: "session_created",
      cwd: options.cwd,
      createdAt: timestamp,
      model: options.model,
      appVersion: options.appVersion,
      promptVersion: SESSION_PROMPT_VERSION,
      maxHistoryTurns: options.maxHistoryTurns
    };
    await file.write(`${JSON.stringify(created)}\n`);
    await file.sync();
    const loaded = validateAndReduceSession([created], sessionId, options.cwd);
    const warnings = await permissionWarnings(options.cwd, sessionId);
    return {
      handle: new SessionHandle({
        sessionId,
        cwd: options.cwd,
        filePath,
        lock,
        file,
        nextSequence: 1,
        ...(options.secrets === undefined ? {} : { secrets: options.secrets })
      }),
      loaded,
      compatibilityWarnings: warnings
    };
  } catch (error: unknown) {
    await file?.close().catch(() => undefined);
    await unlink(filePath).catch(() => undefined);
    await lock.release();
    throw error;
  }
}

export async function resumeSession(
  options: CreateSessionOptions,
  sessionId: string
): Promise<ResumeSessionResult> {
  assertSessionId(sessionId);
  await ensureSessionsDirectory(options.cwd);
  let loaded = await loadSession(options.cwd, sessionId);
  const lock = await acquireSessionLock(sessionLockPath(options.cwd, sessionId));
  let file: FileHandle | undefined;
  let handle: SessionHandle | undefined;
  try {
    loaded = await loadSession(options.cwd, sessionId);
    const ignoredTrailingFragment = loaded.ignoredTrailingFragment;
    if (ignoredTrailingFragment) {
      await removeTrailingFragment(sessionFilePath(options.cwd, sessionId));
      loaded = await loadSession(options.cwd, sessionId);
    }
    await ensureTrailingNewline(sessionFilePath(options.cwd, sessionId));
    file = await open(sessionFilePath(options.cwd, sessionId), "a+", FILE_MODE);
    handle = new SessionHandle({
      sessionId,
      cwd: options.cwd,
      filePath: sessionFilePath(options.cwd, sessionId),
      lock,
      file,
      nextSequence: loaded.events.length,
      ...(options.secrets === undefined ? {} : { secrets: options.secrets })
    });
    if (loaded.reduced.unfinishedTurnId !== undefined) {
      await handle.interruptTurn(loaded.reduced.unfinishedTurnId, "Previous process ended before the turn reached a terminal state.");
      loaded = await handle.load();
    }
    const warnings = [
      ...compatibilityWarnings(loaded, options),
      ...(ignoredTrailingFragment ? ["Ignored and removed one incomplete JSON record at the end of the session file."] : []),
      ...(await permissionWarnings(options.cwd, sessionId))
    ];
    return { handle, loaded, compatibilityWarnings: warnings };
  } catch (error: unknown) {
    if (handle !== undefined) {
      await handle.close().catch(() => undefined);
    } else {
      await file?.close().catch(() => undefined);
      await lock.release();
    }
    throw error;
  }
}

export async function forkSession(
  parent: SessionHandle,
  options: CreateSessionOptions
): Promise<ResumeSessionResult> {
  const parentLoaded = await parent.load();
  await ensureSessionsDirectory(options.cwd);
  const childId = randomUUID();
  const directory = workspaceSessionsDirectory(options.cwd);
  const finalPath = sessionFilePath(options.cwd, childId);
  const temporaryPath = path.join(directory, `.${childId}.${randomUUID()}.tmp`);
  const timestamp = new Date().toISOString();
  const stableSequence = parentLoaded.reduced.stableSequence;
  const created: SessionCreatedEvent = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    sessionId: childId,
    sequence: 0,
    timestamp,
    type: "session_created",
    cwd: options.cwd,
    createdAt: timestamp,
    model: options.model,
    appVersion: options.appVersion,
    promptVersion: SESSION_PROMPT_VERSION,
    maxHistoryTurns: options.maxHistoryTurns,
    parentSessionId: parent.sessionId,
    forkedAtSequence: stableSequence
  };
  const copied = parentLoaded.events
    .slice(1, stableSequence + 1)
    .map((event, index) => ({ ...event, sessionId: childId, sequence: index + 1 }));

  let temporary: FileHandle | undefined;
  try {
    temporary = await open(temporaryPath, "wx", FILE_MODE);
    await temporary.writeFile([...([created] as SessionEvent[]), ...copied].map((event) => JSON.stringify(event)).join("\n") + "\n");
    await temporary.sync();
    await temporary.close();
    temporary = undefined;
    await rename(temporaryPath, finalPath);
  } catch (error: unknown) {
    await temporary?.close().catch(() => undefined);
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }

  return resumeSession(options, childId);
}

export async function forkStoredSession(
  options: CreateSessionOptions,
  parentSessionId: string
): Promise<ResumeSessionResult> {
  assertSessionId(parentSessionId);
  await ensureSessionsDirectory(options.cwd);
  const lock = await acquireSessionLock(sessionLockPath(options.cwd, parentSessionId));
  let file: FileHandle | undefined;
  let parent: SessionHandle | undefined;
  try {
    const loaded = await loadSession(options.cwd, parentSessionId);
    file = await open(sessionFilePath(options.cwd, parentSessionId), "a+", FILE_MODE);
    parent = new SessionHandle({
      sessionId: parentSessionId,
      cwd: options.cwd,
      filePath: sessionFilePath(options.cwd, parentSessionId),
      lock,
      file,
      nextSequence: loaded.events.length,
      ...(options.secrets === undefined ? {} : { secrets: options.secrets })
    });
    const child = await forkSession(parent, options);
    await parent.close();
    return child;
  } catch (error: unknown) {
    if (parent !== undefined) {
      await parent.close().catch(() => undefined);
    } else {
      await file?.close().catch(() => undefined);
      await lock.release();
    }
    throw error;
  }
}

export async function closeActiveSessions(): Promise<void> {
  const handles = [...activeHandles];
  const results = await Promise.allSettled(handles.map((handle) => handle.close()));
  const rejected = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (rejected !== undefined) {
    throw rejected.reason;
  }
}

export async function listSessions(cwd: string): Promise<readonly SessionListItem[]> {
  const directory = workspaceSessionsDirectory(cwd);
  const entries = await readdir(directory, { withFileTypes: true }).catch((error: unknown) => {
    if (isNodeError(error, "ENOENT")) {
      return [];
    }
    throw error;
  });
  const items: SessionListItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const sessionId = entry.name.slice(0, -".jsonl".length);
    try {
      assertSessionId(sessionId);
      const loaded = await loadSession(cwd, sessionId);
      const info = await stat(path.join(directory, entry.name));
      const firstTurn = loaded.reduced.completedTurns[0]?.user ?? findFirstStartedPrompt(loaded.events) ?? "(no completed turns)";
      items.push({
        sessionId,
        updatedAt: info.mtime.toISOString(),
        createdAt: loaded.reduced.metadata.createdAt,
        model: loaded.reduced.metadata.model,
        turnCount: loaded.reduced.completedTurns.length,
        preview: summarize(firstTurn),
        ...(loaded.reduced.metadata.parentSessionId === undefined ? {} : { parentSessionId: loaded.reduced.metadata.parentSessionId })
      });
    } catch (error: unknown) {
      const message = displayError(error);
      items.push({
        sessionId,
        updatedAt: (await stat(path.join(directory, entry.name))).mtime.toISOString(),
        createdAt: "",
        model: "unknown",
        turnCount: 0,
        preview: `[unreadable: ${summarize(message)}]`
      });
    }
  }
  return items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function findLastSessionId(cwd: string): Promise<string> {
  const sessions = await listSessions(cwd);
  for (const session of sessions) {
    try {
      await loadSession(cwd, session.sessionId);
      return session.sessionId;
    } catch {
      // Skip damaged entries when selecting the most recent usable session.
    }
  }
  throw new Error("No readable sessions found for this working directory.");
}

export async function loadSession(cwd: string, sessionId: string): Promise<LoadedSession> {
  assertSessionId(sessionId);
  const filePath = sessionFilePath(cwd, sessionId);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error, "ENOENT")) {
      throw new Error(`Session not found in this working directory: ${sessionId}`);
    }
    throw error;
  }
  const { events, ignoredTrailingFragment } = parseJsonLines(raw, filePath);
  return validateAndReduceSession(events, sessionId, cwd, ignoredTrailingFragment);
}

async function ensureSessionsDirectory(cwd: string): Promise<void> {
  await mkdir(workspaceSessionsDirectory(cwd), { recursive: true, mode: DIRECTORY_MODE });
}

function parseJsonLines(raw: string, filePath: string): { readonly events: readonly SessionEvent[]; readonly ignoredTrailingFragment: boolean } {
  const lines = raw.split("\n");
  const endsWithNewline = raw.endsWith("\n");
  if (endsWithNewline) {
    lines.pop();
  }
  const events: SessionEvent[] = [];
  let ignoredTrailingFragment = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined || line.length === 0) {
      throw new Error(`Invalid blank record in session file ${filePath} at line ${index + 1}.`);
    }
    try {
      events.push(JSON.parse(line) as SessionEvent);
    } catch {
      if (index === lines.length - 1 && !endsWithNewline) {
        ignoredTrailingFragment = true;
        break;
      }
      throw new Error(`Invalid JSON in session file ${filePath} at line ${index + 1}.`);
    }
  }
  return { events, ignoredTrailingFragment };
}

function compatibilityWarnings(loaded: LoadedSession, options: CreateSessionOptions): readonly string[] {
  const warnings: string[] = [];
  if (loaded.reduced.metadata.appVersion !== options.appVersion) {
    warnings.push(`Session was created by buildthread ${loaded.reduced.metadata.appVersion}; current version is ${options.appVersion}.`);
  }
  if (loaded.reduced.metadata.promptVersion !== SESSION_PROMPT_VERSION) {
    warnings.push(`Session prompt version is ${loaded.reduced.metadata.promptVersion}; current version is ${SESSION_PROMPT_VERSION}.`);
  }
  if (loaded.ignoredTrailingFragment) {
    warnings.push("Ignored one incomplete JSON record at the end of the session file.");
  }
  return warnings;
}

async function removeTrailingFragment(filePath: string): Promise<void> {
  const raw = await readFile(filePath, "utf8");
  const lastNewline = raw.lastIndexOf("\n");
  const validPrefix = lastNewline < 0 ? "" : raw.slice(0, lastNewline + 1);
  const handle = await open(filePath, "r+");
  try {
    await handle.truncate(Buffer.byteLength(validPrefix));
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function ensureTrailingNewline(filePath: string): Promise<void> {
  const raw = await readFile(filePath);
  if (raw.length === 0 || raw[raw.length - 1] === 0x0a) {
    return;
  }
  const handle = await open(filePath, "a");
  try {
    await handle.write("\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function permissionWarnings(cwd: string, sessionId: string): Promise<readonly string[]> {
  const warnings: string[] = [];
  const targets = [workspaceSessionsDirectory(cwd), sessionFilePath(cwd, sessionId)];
  for (const target of targets) {
    const info = await stat(target).catch(() => undefined);
    if (info !== undefined && (info.mode & 0o077) !== 0) {
      warnings.push(`Session storage permissions allow access beyond the current user: ${target}`);
    }
  }
  return warnings;
}

function limitRecordedValue(value: unknown): { readonly value: unknown; readonly truncated: boolean } {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || serialized.length <= MAX_RECORDED_VALUE_CHARS) {
    return { value, truncated: false };
  }
  return { value: `${serialized.slice(0, MAX_RECORDED_VALUE_CHARS)}\n...session result truncated`, truncated: true };
}

function sanitizeForStorage(value: unknown, secrets: readonly string[], seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") {
    let sanitized = value
      .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/giu, "Bearer [redacted]")
      .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[redacted]");
    for (const secret of secrets) {
      if (secret.length >= 6) {
        sanitized = sanitized.split(secret).join("[redacted]");
      }
    }
    return sanitized;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (seen.has(value)) {
    return "[circular]";
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeForStorage(item, secrets, seen));
  }
  const sanitized: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    sanitized[key] = /api.?key|authorization|credential|password|secret|token/iu.test(key)
      ? "[redacted]"
      : sanitizeForStorage(item, secrets, seen);
  }
  return sanitized;
}

function findFirstStartedPrompt(events: readonly SessionEvent[]): string | undefined {
  const event = events.find((candidate) => candidate.type === "turn_started") as Record<string, unknown> | undefined;
  return typeof event?.content === "string" ? event.content : undefined;
}

function summarize(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length <= 60 ? compact : `${compact.slice(0, 57)}...`;
}

function callKey(turnId: string, round: number): string {
  return `${turnId}:${round}`;
}

function displayError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
