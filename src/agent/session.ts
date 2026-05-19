import { DeepSeekClient } from "../model/deepseek.js";
import type { AssistantResponse, ChatMessage, ModelClient } from "../model/types.js";
import { decideToolPermission } from "../policy/permissions.js";
import { executeToolAction, isRegisteredToolName } from "../tools/registry.js";
import type { ToolAction, ToolObservation } from "../tools/types.js";
import { scanWorkspace, type WorkspaceSnapshot } from "../workspace/files.js";
import { activateExplicitSkill } from "../skills/selector.js";
import { buildMessages } from "./prompt.js";
import {
  formatPreparedDiff,
  parseAssistantResult,
  prepareChanges,
  type PreparedChange
} from "./changes.js";
import { appendAgentTurn, getHistoryWindow, type AgentSession } from "./conversation.js";

export interface AgentRunOptions {
  readonly session: AgentSession;
  readonly prompt: string;
  readonly skillName?: string;
  readonly client?: ModelClient;
  readonly onToken?: (token: string) => void;
  readonly onEvent?: (event: AgentEvent) => void;
  readonly requestApproval?: (request: ApprovalRequest) => Promise<boolean>;
}

export interface AgentResult {
  readonly message: string;
  readonly rawResponse: string;
  readonly session: AgentSession;
  readonly snapshot: WorkspaceSnapshot;
  readonly changes: readonly PreparedChange[];
  readonly diff: string;
}

export type AgentEvent =
  | {
      readonly type: "skill_selected";
      readonly name: string;
      readonly source: "project" | "user";
      readonly directory: string;
    }
  | {
      readonly type: "tool_call";
      readonly round: number;
      readonly action: ToolAction;
    }
  | {
      readonly type: "approval_requested";
      readonly round: number;
      readonly request: ApprovalRequest;
    }
  | {
      readonly type: "approval_granted";
      readonly round: number;
      readonly request: ApprovalRequest;
    }
  | {
      readonly type: "approval_denied";
      readonly round: number;
      readonly request: ApprovalRequest;
      readonly observation: ToolObservation;
    }
  | {
      readonly type: "command_finished";
      readonly round: number;
      readonly observation: ToolObservation;
    }
  | {
      readonly type: "tool_observation";
      readonly round: number;
      readonly observation: ToolObservation;
    };

const MAX_TOOL_ROUNDS = 4;

export interface ApprovalRequest {
  readonly id: string;
  readonly action: ToolAction;
  readonly command: string;
  readonly reason: string;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { runtime } = options.session;
  const skill =
    options.skillName === undefined ? undefined : await activateExplicitSkill(runtime.cwd, options.skillName);

  if (skill !== undefined) {
    options.onEvent?.({
      type: "skill_selected",
      name: skill.name,
      source: skill.source,
      directory: skill.directory
    });
  }

  const snapshot = await scanWorkspace(runtime.cwd);
  const client = options.client ?? new DeepSeekClient({ apiKey: runtime.apiKey });
  const messages: ChatMessage[] = [...buildMessages(options.prompt, snapshot, getHistoryWindow(options.session), skill)];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const rawResponse = runtime.stream
      ? await readStreamedResponse(client, runtime.model, messages)
      : await readCompleteResponse(client, runtime.model, messages);
    const assistantResponse = parseAssistantResponse(rawResponse);

    if (assistantResponse.type === "message") {
      if (runtime.stream) {
        options.onToken?.(rawResponse);
      }

      const parsed = parseAssistantResult(assistantResponse.content);
      const changes = await prepareChanges(runtime.cwd, parsed.changes);
      const nextSession = appendAgentTurn(options.session, options.prompt, parsed.message);

      return {
        message: parsed.message,
        rawResponse,
        session: nextSession,
        snapshot,
        changes,
        diff: formatPreparedDiff(changes)
      };
    }

    if (round >= MAX_TOOL_ROUNDS) {
      throw new Error(`Model exceeded the maximum of ${MAX_TOOL_ROUNDS} tool round(s).`);
    }

    const toolRound = round + 1;
    options.onEvent?.({ type: "tool_call", round: toolRound, action: assistantResponse.action });
    const observation = await executeToolActionWithApproval(assistantResponse.action, toolRound, options);
    messages.push(
      { role: "assistant", content: rawResponse },
      { role: "user", content: renderToolObservation(observation) }
    );
  }

  throw new Error(`Model exceeded the maximum of ${MAX_TOOL_ROUNDS} tool round(s).`);
}

async function executeToolActionWithApproval(
  action: ToolAction,
  round: number,
  options: AgentRunOptions
): Promise<ToolObservation> {
  const decision = decideToolPermission(action);

  if (!decision.requiresApproval) {
    const observation = await executeToolAction(action, { cwd: options.session.runtime.cwd });
    options.onEvent?.({ type: "tool_observation", round, observation });
    return observation;
  }

  const command = getShellCommand(action);

  if (command === undefined) {
    const observation = await executeToolAction(action, { cwd: options.session.runtime.cwd });
    options.onEvent?.({ type: "tool_observation", round, observation });
    return observation;
  }

  const request: ApprovalRequest = {
    id: `${round}-${Date.now()}`,
    action,
    command,
    reason: decision.reason
  };
  options.onEvent?.({ type: "approval_requested", round, request });

  if (options.requestApproval === undefined) {
    const observation: ToolObservation = {
      ok: false,
      tool: action.tool,
      error: `Shell command requires user approval, but no approval handler is available: ${command}`
    };
    options.onEvent?.({ type: "approval_denied", round, request, observation });
    return observation;
  }

  const approved = await options.requestApproval(request);

  if (!approved) {
    const observation: ToolObservation = {
      ok: false,
      tool: action.tool,
      error: `Shell command denied by user: ${command}`
    };
    options.onEvent?.({ type: "approval_denied", round, request, observation });
    return observation;
  }

  options.onEvent?.({ type: "approval_granted", round, request });
  const observation = await executeToolAction(action, { cwd: options.session.runtime.cwd });
  options.onEvent?.({ type: "command_finished", round, observation });
  options.onEvent?.({ type: "tool_observation", round, observation });
  return observation;
}

function getShellCommand(action: ToolAction): string | undefined {
  if (action.tool !== "shell") {
    return undefined;
  }

  const command = action.arguments.command;
  return typeof command === "string" && command.trim().length > 0 ? command : undefined;
}

async function readCompleteResponse(
  client: ModelClient,
  model: string,
  messages: Parameters<ModelClient["complete"]>[0]["messages"]
): Promise<string> {
  const response = await client.complete({
    model,
    messages,
    temperature: 0.2
  });

  return response.content;
}

async function readStreamedResponse(
  client: ModelClient,
  model: string,
  messages: Parameters<ModelClient["stream"]>[0]["messages"]
): Promise<string> {
  let content = "";

  for await (const event of client.stream({ model, messages, temperature: 0.2 })) {
    if (event.type === "content") {
      content += event.content;
    }
  }

  return content;
}

function parseAssistantResponse(text: string): AssistantResponse {
  const jsonText = extractJson(text);

  if (jsonText === undefined) {
    return { type: "message", content: text };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { type: "message", content: text };
  }

  if (!isObject(parsed) || parsed.action === undefined) {
    return { type: "message", content: text };
  }

  const action = parsed.action;

  if (!isObject(action)) {
    throw new Error("Assistant action must be an object.");
  }

  if (!isRegisteredToolName(action.tool)) {
    throw new Error(`Assistant action tool is not registered: ${String(action.tool)}`);
  }

  if (!isObject(action.arguments)) {
    throw new Error("Assistant action arguments must be an object.");
  }

  return {
    type: "action",
    action: {
      tool: action.tool,
      arguments: action.arguments
    }
  };
}

function renderToolObservation(observation: ToolObservation): string {
  return `Tool observation:\n${JSON.stringify(observation, null, 2)}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function extractJson(text: string): string | undefined {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }

  return undefined;
}
