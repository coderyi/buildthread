import React, { useCallback, useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput } from "ink";
import type { RuntimeOptions } from "../cli/runtime.js";
import { runAgent, type AgentEvent, type ApprovalRequest } from "../agent/session.js";
import { createAgentSession, type AgentSession } from "../agent/conversation.js";
import { applyPreparedChanges, type PreparedChange } from "../agent/changes.js";
import { parseSkillInput } from "../agent/skill-input.js";
import { MessageList, type UiMessage } from "./components/MessageList.js";
import { InputBox } from "./components/InputBox.js";
import { StatusLine } from "./components/StatusLine.js";
import { DiffView } from "./components/DiffView.js";
import { disposeSlashCommandResources, executeSlashCommand, parseReviewSlashCommand } from "./slash-commands.js";
import { runReview, type ReviewEvent } from "../review/session.js";

interface AppProps {
  readonly runtime: RuntimeOptions;
}

type AppStatus = "idle" | "working" | "approving" | "confirming" | "applying" | "error";

export function App({ runtime }: AppProps): React.ReactElement {
  const { exit } = useApp();
  const [messages, setMessages] = useState<readonly UiMessage[]>([]);
  const [agentSession, setAgentSession] = useState<AgentSession>(() => createAgentSession(runtime));
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<AppStatus>("idle");
  const [statusText, setStatusText] = useState("Ready");
  const [diff, setDiff] = useState("");
  const [pendingChanges, setPendingChanges] = useState<readonly PreparedChange[]>([]);
  const [pendingApproval, setPendingApproval] = useState<ApprovalRequest | undefined>(undefined);
  const approvalResolver = useRef<((approved: boolean) => void) | undefined>(undefined);

  useEffect(() => {
    return () => {
      disposeSlashCommandResources();
    };
  }, []);

  const submit = useCallback(
    (prompt: string) => {
      setMessages((current) => [...current, { role: "user", content: prompt }]);
      setInput("");
      setDiff("");
      setPendingChanges([]);
      setPendingApproval(undefined);

      let reviewRequest: ReturnType<typeof parseReviewSlashCommand>;

      try {
        reviewRequest = parseReviewSlashCommand(prompt);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setMessages((current) => [...current, { role: "system", content: message }]);
        setStatus("error");
        setStatusText("Review usage error. Press Enter to continue or Ctrl+C to exit.");
        return;
      }

      if (reviewRequest !== undefined) {
        setStatus("working");
        setStatusText(reviewRequest.userFacingHint);

        void runReview({
          runtime,
          request: reviewRequest,
          onEvent: (event) => {
            setStatusText(formatReviewStatus(event));
          }
        })
          .then((result) => {
            setMessages((current) => [...current, { role: "assistant", content: result.formatted }]);
            setStatus("idle");
            setStatusText("Ready");
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setMessages((current) => [...current, { role: "system", content: message }]);
            setStatus("error");
            setStatusText("Review failed. Press Enter to continue or Ctrl+C to exit.");
          });
        return;
      }

      const slashCommand = executeSlashCommand(prompt, { runtime });

      if (slashCommand.handled) {
        setStatus("working");
        setStatusText("Running command...");

        void slashCommand.output
          .then((output) => {
            setMessages((current) => [...current, { role: "system", content: output.content }]);
            setStatus("idle");
            setStatusText(output.statusText);
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            setMessages((current) => [...current, { role: "system", content: message }]);
            setStatus("error");
            setStatusText("Command failed. Press Enter to continue or Ctrl+C to exit.");
          });
        return;
      }

      let parsedPrompt: ReturnType<typeof parseSkillInput>;

      try {
        parsedPrompt = parseSkillInput(prompt);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        setMessages((current) => [...current, { role: "system", content: message }]);
        setStatus("error");
        setStatusText("Input error. Press Enter to continue or Ctrl+C to exit.");
        return;
      }

      setStatus("working");
      setStatusText("Reading workspace and requesting model...");

      void runAgent({
        session: agentSession,
        prompt: parsedPrompt.prompt,
        ...(parsedPrompt.skillName === undefined ? {} : { skillName: parsedPrompt.skillName }),
        onEvent: (event) => {
          setMessages((current) => [...current, formatAgentEvent(event)]);
          setStatusText(formatAgentStatus(event));
        },
        requestApproval: (request) => {
          return new Promise<boolean>((resolve) => {
            approvalResolver.current = resolve;
            setPendingApproval(request);
            setStatus("approving");
            setStatusText(`Approve ${formatApprovalKind(request)}? Press y to run, n to deny.`);
          });
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
    [agentSession, runtime]
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

  const answerApproval = useCallback((approved: boolean) => {
    const resolve = approvalResolver.current;
    approvalResolver.current = undefined;
    setPendingApproval(undefined);
    setStatus("working");
    setStatusText(approved ? "Tool call approved; running..." : "Tool call denied; continuing...");
    resolve?.(approved);
  }, []);

  useInput((inputChar, key) => {
    if (key.ctrl && inputChar === "c") {
      disposeSlashCommandResources();
      exit();
      return;
    }

    if (status === "approving") {
      if (inputChar.toLowerCase() === "y") {
        answerApproval(true);
      } else if (inputChar.toLowerCase() === "n" || key.escape) {
        answerApproval(false);
      }
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
        <CommandApprovalView request={pendingApproval} />
        <DiffView diff={diff} />
      </Box>
      <InputBox
        value={input}
        disabled={status === "working" || status === "applying" || status === "approving" || status === "confirming"}
      />
    </Box>
  );
}

function CommandApprovalView({ request }: { readonly request: ApprovalRequest | undefined }): React.ReactElement | null {
  if (request === undefined) {
    return null;
  }

  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1} flexDirection="column">
      <Text color="yellow">{formatApprovalTitle(request)}</Text>
      <Text>{formatApprovalDetails(request)}</Text>
      {request.reason.length > 0 ? <Text color="gray">{request.reason}</Text> : null}
      <Text color="gray">Press y to run, n to deny.</Text>
    </Box>
  );
}

function formatAgentEvent(event: AgentEvent): UiMessage {
  if (event.type === "skill_selected") {
    return {
      role: "system",
      content: `Using skill: ${event.name} (${event.source})`
    };
  }

  if (event.type === "tool_call") {
    return {
      role: "system",
      content: formatToolCall(event)
    };
  }

  if (event.type === "approval_requested") {
    return {
      role: "system",
      content: `Approval requested for ${formatApprovalKind(event.request)}: ${formatApprovalDetails(event.request)}`
    };
  }

  if (event.type === "approval_granted") {
    return {
      role: "system",
      content: `Approval granted: ${formatApprovalDetails(event.request)}`
    };
  }

  if (event.type === "approval_denied") {
    return {
      role: "system",
      content: `Approval denied: ${formatApprovalDetails(event.request)}`
    };
  }

  if (event.type === "command_finished") {
    return {
      role: "system",
      content: formatCommandFinishedSummary(event.observation)
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

  if (action.tool === "shell") {
    const command = action.arguments.command;
    return `Model requested shell${typeof command === "string" ? `: ${command}` : ""}`;
  }

  if (action.tool === "mcp_call") {
    const server = action.arguments.server;
    const name = action.arguments.name;
    const target = typeof server === "string" && typeof name === "string" ? `${server}.${name}` : "";
    return `Model requested mcp_call${target.length > 0 ? `: ${target}` : ""}`;
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

  if (observation.tool === "shell") {
    return formatCommandFinished(observation);
  }

  if (observation.tool === "mcp_call") {
    const status = observation.isError ? "business error" : "completed";
    return `Runtime mcp_call ${status}: ${observation.server}.${observation.name}\n${truncateForDisplay(
      JSON.stringify(observation.result, null, 2)
    )}`;
  }

  const header = `Runtime grep completed: ${observation.matchCount} match${
    observation.matchCount === 1 ? "" : "es"
  } after searching ${observation.searchedFiles} file${observation.searchedFiles === 1 ? "" : "s"}`;
  const matches = observation.matches.map((match) => `${match.path}:${match.line}: ${match.text}`);
  const truncated = observation.truncated ? ["...results truncated"] : [];
  return [header, ...matches, ...truncated].join("\n");
}

function formatAgentStatus(event: AgentEvent): string {
  if (event.type === "skill_selected") {
    return `Using skill: ${event.name}`;
  }

  if (event.type === "tool_call") {
    return `Requesting tool: ${event.action.tool}`;
  }

  if (event.type === "approval_requested") {
    return `Waiting for ${formatApprovalKind(event.request)} approval...`;
  }

  if (event.type === "approval_granted") {
    return "Tool call approved; running...";
  }

  if (event.type === "approval_denied") {
    return "Tool call denied; continuing model request...";
  }

  if (event.type === "command_finished") {
    return "Shell command finished; continuing model request...";
  }

  return event.observation.ok ? "Tool observation received; continuing model request..." : "Tool failed; continuing model request...";
}

function formatReviewStatus(event: ReviewEvent): string {
  if (event.type === "entered_review_mode") {
    return event.hint;
  }

  if (event.type === "diff_collected") {
    return `Collected diff (${event.byteLength} bytes); requesting review...`;
  }

  if (event.type === "model_request_started") {
    return "Reviewer is analyzing the diff...";
  }

  return "Review finished.";
}

function formatCommandFinished(observation: Extract<AgentEvent, { readonly type: "command_finished" }>["observation"]): string {
  if (!observation.ok) {
    return `Runtime ${observation.tool} failed: ${observation.error}`;
  }

  if (observation.tool !== "shell") {
    return formatToolObservation(observation);
  }

  const exitCode = observation.exitCode === null ? "null" : String(observation.exitCode);
  const timedOut = observation.timedOut ? " (timed out)" : "";
  const header = `Command finished${timedOut}: exitCode=${exitCode}, duration=${observation.durationMs}ms`;
  const stdout = observation.stdout.length > 0 ? `stdout:\n${truncateForDisplay(observation.stdout)}` : "stdout: (empty)";
  const stderr = observation.stderr.length > 0 ? `\nstderr:\n${truncateForDisplay(observation.stderr)}` : "";
  const truncated = observation.truncated ? "\n(output truncated)" : "";

  return `${header}\n${stdout}${stderr}${truncated}`;
}

function formatCommandFinishedSummary(
  observation: Extract<AgentEvent, { readonly type: "command_finished" }>["observation"]
): string {
  if (!observation.ok) {
    return `Command failed before completion: ${observation.error}`;
  }

  if (observation.tool !== "shell") {
    return `Runtime ${observation.tool} completed.`;
  }

  const exitCode = observation.exitCode === null ? "null" : String(observation.exitCode);
  const timedOut = observation.timedOut ? " (timed out)" : "";
  return `Command finished${timedOut}: ${observation.command} (exitCode=${exitCode})`;
}

function truncateForDisplay(value: string): string {
  const maxChars = 4_000;

  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n...display truncated`;
}

function formatApprovalKind(request: ApprovalRequest): string {
  return request.action.tool === "mcp_call" ? "MCP tool call" : "shell command";
}

function formatApprovalTitle(request: ApprovalRequest): string {
  return request.action.tool === "mcp_call" ? "MCP tool approval required" : "Shell command approval required";
}

function formatApprovalDetails(request: ApprovalRequest): string {
  if (request.action.tool !== "mcp_call") {
    return request.command;
  }

  const server = request.action.arguments.server;
  const name = request.action.arguments.name;
  const toolArguments = request.action.arguments.arguments;
  const target = typeof server === "string" && typeof name === "string" ? `${server}.${name}` : request.command;
  const argsText = JSON.stringify(toolArguments ?? {});
  return `${target} ${argsText}`;
}
