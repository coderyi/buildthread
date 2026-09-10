import path from "node:path";
import { SESSION_SCHEMA_VERSION, type LoadedSession, type SessionCreatedEvent, type SessionEvent } from "./types.js";

const TERMINAL_TYPES = new Set(["turn_completed", "turn_failed", "turn_interrupted"]);

export function validateAndReduceSession(
  events: readonly SessionEvent[],
  expectedSessionId: string,
  expectedCwd: string,
  ignoredTrailingFragment = false
): LoadedSession {
  if (events.length === 0) {
    throw new Error("Session file is empty or has no complete records.");
  }

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!isRecord(event)) {
      throw new Error(`Session event ${index} is not an object.`);
    }
    if (event.schemaVersion !== SESSION_SCHEMA_VERSION) {
      throw new Error(`Unsupported session schema version at sequence ${index}: ${String(event.schemaVersion)}.`);
    }
    if (event.sessionId !== expectedSessionId) {
      throw new Error(`Session ID mismatch at sequence ${index}.`);
    }
    if (event.sequence !== index) {
      throw new Error(`Invalid session sequence: expected ${index}, received ${String(event.sequence)}.`);
    }
    if (typeof event.timestamp !== "string" || typeof event.type !== "string") {
      throw new Error(`Invalid session event at sequence ${index}.`);
    }
  }

  const first = events[0];
  if (!isSessionCreated(first)) {
    throw new Error("The first session event must be session_created.");
  }
  if (path.resolve(first.cwd) !== path.resolve(expectedCwd)) {
    throw new Error("Session belongs to a different working directory.");
  }

  const started = new Map<string, string>();
  const terminal = new Set<string>();
  const calls = new Map<string, string>();
  const approvals = new Set<string>();
  const results = new Set<string>();
  const completedTurns: Array<{ readonly turnId: string; readonly user: string; readonly assistant: string }> = [];
  let openTurnId: string | undefined;
  let stableSequence = 0;

  for (const event of events.slice(1)) {
    if (event.type === "turn_started") {
      if (!hasString(event, "turnId") || !hasString(event, "content")) {
        throw new Error(`Invalid turn_started event at sequence ${event.sequence}.`);
      }
      if (openTurnId !== undefined) {
        throw new Error(`Turn ${openTurnId} has no terminal event before the next turn started.`);
      }
      if (started.has(event.turnId)) {
        throw new Error(`Duplicate turn ID at sequence ${event.sequence}: ${event.turnId}.`);
      }
      started.set(event.turnId, event.content);
      openTurnId = event.turnId;
      continue;
    }

    if (event.type === "tool_call") {
      const raw = event as unknown as Record<string, unknown>;
      if (!hasString(event, "turnId") || event.turnId !== openTurnId || !hasString(event, "callId") ||
          !Number.isInteger(raw.round) || (raw.round as number) <= 0 || !hasString(event, "tool") ||
          !isRecord(raw.arguments) || calls.has(event.callId)) {
        throw new Error(`Invalid tool_call event at sequence ${event.sequence}.`);
      }
      calls.set(event.callId, event.turnId);
      continue;
    }

    if (event.type === "approval_decided") {
      const raw = event as unknown as Record<string, unknown>;
      if (!hasString(event, "turnId") || event.turnId !== openTurnId || !hasString(event, "callId") ||
          calls.get(event.callId) !== event.turnId || typeof raw.approved !== "boolean" || !hasString(event, "subject")) {
        throw new Error(`Invalid approval_decided event at sequence ${event.sequence}.`);
      }
      if (approvals.has(event.callId)) {
        throw new Error(`Duplicate approval decision at sequence ${event.sequence}.`);
      }
      approvals.add(event.callId);
      continue;
    }

    if (event.type === "tool_result") {
      const raw = event as unknown as Record<string, unknown>;
      if (!hasString(event, "turnId") || event.turnId !== openTurnId || !hasString(event, "callId") ||
          calls.get(event.callId) !== event.turnId || !hasString(event, "tool") || typeof raw.ok !== "boolean" ||
          typeof raw.truncated !== "boolean") {
        throw new Error(`Invalid tool_result event at sequence ${event.sequence}.`);
      }
      if (results.has(event.callId)) {
        throw new Error(`Duplicate tool result at sequence ${event.sequence}.`);
      }
      results.add(event.callId);
      continue;
    }

    if (TERMINAL_TYPES.has(event.type)) {
      if (!hasString(event, "turnId") || !started.has(event.turnId) || terminal.has(event.turnId)) {
        throw new Error(`Invalid terminal turn event at sequence ${event.sequence}.`);
      }
      if (openTurnId !== event.turnId) {
        throw new Error(`Terminal event does not match the active turn at sequence ${event.sequence}.`);
      }
      terminal.add(event.turnId);
      openTurnId = undefined;
      stableSequence = event.sequence;
      if (event.type === "turn_completed") {
        const content = (event as Record<string, unknown>).content;
        if (typeof content !== "string") {
          throw new Error(`Invalid turn_completed event at sequence ${event.sequence}.`);
        }
        completedTurns.push({ turnId: event.turnId, user: started.get(event.turnId) ?? "", assistant: content });
      } else {
        const detailName = event.type === "turn_failed" ? "error" : "reason";
        if (typeof (event as Record<string, unknown>)[detailName] !== "string") {
          throw new Error(`Invalid ${event.type} event at sequence ${event.sequence}.`);
        }
      }
      continue;
    }

    if (event.type === "session_created") {
      throw new Error(`Unexpected session_created event at sequence ${event.sequence}.`);
    }

  }

  const messages = completedTurns.flatMap((turn) => [
    { role: "user" as const, content: turn.user },
    { role: "assistant" as const, content: turn.assistant }
  ]);

  return {
    events,
    ignoredTrailingFragment,
    reduced: {
      metadata: first,
      completedTurns,
      messages,
      ...(openTurnId === undefined ? {} : { unfinishedTurnId: openTurnId }),
      stableSequence
    }
  };
}

function isSessionCreated(event: SessionEvent | undefined): event is SessionCreatedEvent {
  if (event?.type !== "session_created") {
    return false;
  }
  const raw = event as unknown as Record<string, unknown>;
  return typeof raw.cwd === "string" && typeof raw.createdAt === "string" && typeof raw.model === "string" &&
    typeof raw.appVersion === "string" && Number.isInteger(raw.maxHistoryTurns) &&
    typeof raw.maxHistoryTurns === "number" && raw.maxHistoryTurns >= 0 && Number.isInteger(raw.promptVersion);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasString(value: object, property: string): value is Record<string, string> {
  return property in value && typeof (value as Record<string, unknown>)[property] === "string";
}
