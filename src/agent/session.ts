import { DeepSeekClient } from "../model/deepseek.js";
import type { ModelClient } from "../model/types.js";
import { scanWorkspace, type WorkspaceSnapshot } from "../workspace/files.js";
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
  readonly client?: ModelClient;
  readonly onToken?: (token: string) => void;
}

export interface AgentResult {
  readonly message: string;
  readonly rawResponse: string;
  readonly session: AgentSession;
  readonly snapshot: WorkspaceSnapshot;
  readonly changes: readonly PreparedChange[];
  readonly diff: string;
}

export async function runAgent(options: AgentRunOptions): Promise<AgentResult> {
  const { runtime } = options.session;
  const snapshot = await scanWorkspace(runtime.cwd);
  const client = options.client ?? new DeepSeekClient({ apiKey: runtime.apiKey });
  const messages = buildMessages(options.prompt, snapshot, getHistoryWindow(options.session));
  const rawResponse = runtime.stream
    ? await readStreamedResponse(client, runtime.model, messages, options.onToken)
    : await readCompleteResponse(client, runtime.model, messages);
  const parsed = parseAssistantResult(rawResponse);
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
  messages: Parameters<ModelClient["stream"]>[0]["messages"],
  onToken?: (token: string) => void
): Promise<string> {
  let content = "";

  for await (const event of client.stream({ model, messages, temperature: 0.2 })) {
    if (event.type === "content") {
      content += event.content;
      onToken?.(event.content);
    }
  }

  return content;
}
