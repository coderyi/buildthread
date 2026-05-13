import React, { useCallback, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { RuntimeOptions } from "../cli/runtime.js";
import { runAgent, type AgentEvent } from "../agent/session.js";
import { createAgentSession, type AgentSession } from "../agent/conversation.js";
import { applyPreparedChanges, type PreparedChange } from "../agent/changes.js";
import { MessageList, type UiMessage } from "./components/MessageList.js";
import { InputBox } from "./components/InputBox.js";
import { StatusLine } from "./components/StatusLine.js";
import { DiffView } from "./components/DiffView.js";

interface AppProps {
  readonly runtime: RuntimeOptions;
}

type AppStatus = "idle" | "working" | "confirming" | "applying" | "error";

export function App({ runtime }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<readonly UiMessage[]>([]);
  const [agentSession, setAgentSession] = useState<AgentSession>(() => createAgentSession(runtime));
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [diff, setDiff] = useState("");
  const [pendingChanges, setPendingChanges] = useState<readonly PreparedChange[]>([]);

  const submit = useCallback(
    (prompt: string) => {
      setMessages((current) => [...current, { role: "user", content: prompt }]);
      setInput("");
      setDiff("");
      setPendingChanges([]);
      setStatus("working");
      setStatusText("Reading workspace and requesting model...");

      void runAgent({
        session: agentSession,
        prompt,
        onEvent: (event) => {
          setMessages((current) => [...current, formatAgentEvent(event)]);
          setStatusText(formatAgentStatus(event));
        }
      })
        .then((result) => {
          setAgentSession(result.session);
          setMessages((current) => [
            ...current,
            { role: "assistant", content: result.message.length > 0 ? result.message : "Done." }
          ]);
          setDiff(result.diff);
          setPendingChanges(result.changes);

          if (result.changes.length > 0) {
            setStatus("confirming");
            setStatusText("Review the proposed changes.");
          } else {
            setStatus("idle");
            setStatusText("Ready");
          }
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          setMessages((current) => [...current, { role: "system", content: message }]);
          setStatus("error");
          setStatusText("Request failed. Press Enter to continue or Ctrl+C to exit.");
        });
    },
    [agentSession]
  );

  const applyChanges = useCallback(() => {
    const changes = pendingChanges;
    setStatus("applying");
    setStatusText("Applying changes...");

    void applyPreparedChanges(changes)
      .then(() => {
        setMessages((current) => [
          ...current,
          { role: "system", content: `Applied ${changes.length} change${changes.length === 1 ? "" : "s"}.` }
        ]);
        setPendingChanges([]);
        setDiff("");
        setStatus("idle");
        setStatusText("Ready");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setMessages((current) => [...current, { role: "system", content: message }]);
        setStatus("error");
        setStatusText("Apply failed. Press Enter to continue or Ctrl+C to exit.");
      });
  }, [pendingChanges]);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      exit();
      return;
    }

    if (status === "working" || status === "applying") {
      return;
    }

    if (status === "confirming") {
      if (inputChar.toLowerCase() === "y") {
        applyChanges();
      } else if (inputChar.toLowerCase() === "n" || key.escape) {
        setPendingChanges([]);
        setDiff("");
        setStatus("idle");
        setStatusText("No files changed.");
      }
      return;
    }

    if (status === "error" && key.return) {
      setStatus("idle");
      setStatusText("Ready");
      return;
    }

    if (key.return) {
      const prompt = input.trim();

      if (prompt.length > 0) {
        submit(prompt);
      }

      return;
    }

    if (key.backspace || key.delete) {
      setInput((current) => current.slice(0, -1));
      return;
    }

    if (!key.ctrl && !key.meta && inputChar.length > 0) {
      setInput((current) => current + inputChar);
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>buildthread</Text>
      <StatusLine status={statusText} />
      <Box marginY={1} flexDirection="column">
        <MessageList messages={messages} />
        <DiffView diff={diff} />
      </Box>
      <InputBox value={input} disabled={status === "working" || status === "applying" || status === "confirming"} />
    </Box>
  );
}

function formatAgentEvent(event: AgentEvent): UiMessage {
  if (event.type === "tool_call") {
    return {
      role: "system",
      content: formatToolCall(event)
    };
  }

  if (event.observation.ok) {
    return { role: "system", content: formatToolObservation(event.observation) };
  }

  return {
    role: "system",
    content: `Runtime ${event.observation.tool} failed: ${event.observation.error}`
  };
}

function formatToolCall(event: Extract<AgentEvent, { readonly type: "tool_call" }>): string {
  const { action } = event;

  if (action.tool === "read_file") {
    const path = action.arguments.path;
    return `Model requested read_file${typeof path === "string" ? `: ${path}` : ""}`;
  }

  const query = action.arguments.query;
  const include = action.arguments.include;
  const queryText = typeof query === "string" ? `: ${query}` : "";
  const includeText = typeof include === "string" ? ` (${include})` : "";
  return `Model requested grep${queryText}${includeText}`;
}

function formatToolObservation(observation: Extract<AgentEvent, { readonly type: "tool_observation" }>["observation"]): string {
  if (!observation.ok) {
    return `Runtime ${observation.tool} failed: ${observation.error}`;
  }

  if (observation.tool === "read_file") {
    return `Runtime read_file completed: ${observation.path} (${observation.size} bytes)`;
  }

  const header = `Runtime grep completed: ${observation.matchCount} match${
    observation.matchCount === 1 ? "" : "es"
  } after searching ${observation.searchedFiles} file${observation.searchedFiles === 1 ? "" : "s"}`;
  const matches = observation.matches.map((match) => `${match.path}:${match.line}: ${match.text}`);
  const truncated = observation.truncated ? ["...results truncated"] : [];
  return [header, ...matches, ...truncated].join("\n");
}

function formatAgentStatus(event: AgentEvent): string {
  if (event.type === "tool_call") {
    return `Requesting tool: ${event.action.tool}`;
  }

  return event.observation.ok ? "Tool observation received; continuing model request..." : "Tool failed; continuing model request...";
}
