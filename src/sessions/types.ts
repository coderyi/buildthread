import type { ConversationMessage } from "../agent/conversation.js";

export const SESSION_SCHEMA_VERSION = 1 as const;
export const SESSION_PROMPT_VERSION = 1 as const;

export interface SessionEventBase {
  readonly schemaVersion: typeof SESSION_SCHEMA_VERSION;
  readonly sessionId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: string;
}

export interface SessionCreatedEvent extends SessionEventBase {
  readonly type: "session_created";
  readonly cwd: string;
  readonly createdAt: string;
  readonly model: string;
  readonly appVersion: string;
  readonly promptVersion: number;
  readonly maxHistoryTurns: number;
  readonly parentSessionId?: string;
  readonly forkedAtSequence?: number;
}

export interface TurnStartedEvent extends SessionEventBase {
  readonly type: "turn_started";
  readonly turnId: string;
  readonly content: string;
}

export interface ToolCallEvent extends SessionEventBase {
  readonly type: "tool_call";
  readonly turnId: string;
  readonly callId: string;
  readonly round: number;
  readonly tool: string;
  readonly arguments: Record<string, unknown>;
}

export interface ApprovalDecidedEvent extends SessionEventBase {
  readonly type: "approval_decided";
  readonly turnId: string;
  readonly callId: string;
  readonly approved: boolean;
  readonly subject: string;
}

export interface ToolResultEvent extends SessionEventBase {
  readonly type: "tool_result";
  readonly turnId: string;
  readonly callId: string;
  readonly tool: string;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
  readonly truncated: boolean;
}

export interface TurnCompletedEvent extends SessionEventBase {
  readonly type: "turn_completed";
  readonly turnId: string;
  readonly content: string;
}

export interface TurnFailedEvent extends SessionEventBase {
  readonly type: "turn_failed";
  readonly turnId: string;
  readonly error: string;
}

export interface TurnInterruptedEvent extends SessionEventBase {
  readonly type: "turn_interrupted";
  readonly turnId: string;
  readonly reason: string;
}

export type SessionEvent =
  | SessionCreatedEvent
  | TurnStartedEvent
  | ToolCallEvent
  | ApprovalDecidedEvent
  | ToolResultEvent
  | TurnCompletedEvent
  | TurnFailedEvent
  | TurnInterruptedEvent
  | SessionEventBase;

export interface CompletedTurn {
  readonly turnId: string;
  readonly user: string;
  readonly assistant: string;
}

export interface ReducedSession {
  readonly metadata: SessionCreatedEvent;
  readonly completedTurns: readonly CompletedTurn[];
  readonly messages: readonly ConversationMessage[];
  readonly unfinishedTurnId?: string;
  readonly stableSequence: number;
}

export interface LoadedSession {
  readonly events: readonly SessionEvent[];
  readonly reduced: ReducedSession;
  readonly ignoredTrailingFragment: boolean;
}

export interface SessionListItem {
  readonly sessionId: string;
  readonly updatedAt: string;
  readonly createdAt: string;
  readonly model: string;
  readonly turnCount: number;
  readonly preview: string;
  readonly parentSessionId?: string;
}
