import type { ChatMessage } from "../model/types.js";
import type { WorkspaceSnapshot } from "../workspace/files.js";
import type { ConversationMessage } from "./conversation.js";

export function buildMessages(
  userPrompt: string,
  snapshot: WorkspaceSnapshot,
  history: readonly ConversationMessage[] = []
): readonly ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt()
    },
    ...renderHistory(history),
    {
      role: "user",
      content: buildUserPrompt(userPrompt, snapshot)
    }
  ];
}

function buildSystemPrompt(): string {
  return `You are a programming assistant running inside a command line tool.

Work with the supplied project context only. Prefer small, direct changes.
Do not invent files that are not required. Do not request shell execution.

Return valid JSON only. Do not include prose, Markdown, comments, code fences, or trailing commas outside the JSON object.
The result must be one JSON object matching this schema:

{
  "message": "short explanation for the user",
  "changes": [
    {
      "type": "create",
      "path": "relative/path.ts",
      "contentLines": ["complete file content, one line per array item"]
    },
    {
      "type": "replace",
      "path": "relative/path.ts",
      "previousContentHash": "sha256 hash from context",
      "contentLines": ["complete replacement file content, one line per array item"]
    }
  ]
}

Schema rules:
- message: string.
- changes: array; use [] when no file change is needed.
- changes[].type: "create" or "replace".
- changes[].path: relative path inside the working directory.
- changes[].previousContentHash: required only for replace, using the sha256 hash from the loaded file context.
- changes[].contentLines: string[] containing complete file content, one line per item, with no newline characters inside items.
- Preserve exact file content by splitting it into contentLines; Markdown code fences are ordinary line strings.`;
}

function buildUserPrompt(userPrompt: string, snapshot: WorkspaceSnapshot): string {
  return `Current user request:
${userPrompt}

Working directory:
${snapshot.root}

Project files:
${snapshot.tree}

Loaded file contents:
${renderLoadedFiles(snapshot)}`;
}

function renderLoadedFiles(snapshot: WorkspaceSnapshot): string {
  const parts: string[] = [];

  for (const file of snapshot.files) {
    if (file.content === undefined || file.hash === undefined) {
      parts.push(`\n--- ${file.path}\nSkipped: ${file.skippedReason ?? "not loaded"}; size=${file.size}`);
      continue;
    }

    parts.push(`\n--- ${file.path}\nsha256: ${file.hash}\n${file.content}`);
  }

  return parts.length === 0 ? "(none)" : parts.join("\n");
}

function renderHistory(history: readonly ConversationMessage[]): readonly ChatMessage[] {
  return history.map((message) => ({
    role: message.role,
    content: message.role === "assistant" ? renderAssistantHistoryMessage(message.content) : message.content
  }));
}

function renderAssistantHistoryMessage(content: string): string {
  return JSON.stringify({ message: content, changes: [] });
}
