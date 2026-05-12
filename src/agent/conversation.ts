import type { RuntimeOptions } from "../cli/runtime.js";

export type ConversationRole = "user" | "assistant";

export interface ConversationMessage {
  readonly role: ConversationRole;
  readonly content: string;
}

export interface AgentSession {
  readonly runtime: RuntimeOptions;
  readonly history: readonly ConversationMessage[];
  readonly maxHistoryTurns: number;
}

export interface AgentSessionOptions {
  readonly maxHistoryTurns?: number;
}

const DEFAULT_MAX_HISTORY_TURNS = 8;

export function createAgentSession(runtime: RuntimeOptions, options: AgentSessionOptions = {}): AgentSession {
  return {
    runtime,
    history: [],
    maxHistoryTurns: options.maxHistoryTurns ?? DEFAULT_MAX_HISTORY_TURNS
  };
}

export function appendAgentTurn(session: AgentSession, userInput: string, assistantMessage: string): AgentSession {
  return {
    ...session,
    history: trimHistory(
      [
        ...session.history,
        { role: "user", content: userInput },
        { role: "assistant", content: assistantMessage }
      ],
      session.maxHistoryTurns
    )
  };
}

export function getHistoryWindow(session: AgentSession): readonly ConversationMessage[] {
  return trimHistory(session.history, session.maxHistoryTurns);
}

function trimHistory(
  history: readonly ConversationMessage[],
  maxHistoryTurns: number
): readonly ConversationMessage[] {
  const maxMessages = Math.max(0, maxHistoryTurns) * 2;

  if (maxMessages === 0 || history.length <= maxMessages) {
    return maxMessages === 0 ? [] : history;
  }

  return history.slice(history.length - maxMessages);
}
