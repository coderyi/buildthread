import type { ChatMessage } from "../model/types.js";
import type { ActivatedSkill } from "../skills/types.js";
import type { WorkspaceSnapshot } from "../workspace/files.js";
import type { ConversationMessage } from "./conversation.js";

export function buildMessages(
  userPrompt: string,
  snapshot: WorkspaceSnapshot,
  history: readonly ConversationMessage[] = [],
  skill?: ActivatedSkill
): readonly ChatMessage[] {
  return [
    {
      role: "system",
      content: buildSystemPrompt()
    },
    ...renderSkillMessage(skill),
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
Do not invent files that are not required.

Return valid JSON only. Do not include prose, Markdown, comments, code fences, or trailing commas outside the JSON object.
You may either request a tool action or return a final result.

Tool action schema:

Search for text:

{
  "action": {
    "tool": "grep",
    "arguments": {
      "query": "literal text to find",
      "include": "optional/path-or-glob"
    }
  }
}

Read an exact file:

{
  "action": {
    "tool": "read_file",
    "arguments": {
      "path": "relative/path.ts"
    }
  }
}

Run a shell command in the working directory:

{
  "action": {
    "tool": "shell",
    "arguments": {
      "command": "npm run build",
      "timeoutMs": 120000
    }
  }
}

Tool rules:
- Use grep when you need to find relevant files by text. grep searches literal text, accepts query and optional include, returns matching paths, line numbers, and lines, and may truncate large result sets.
- Use read_file when you need exact file contents before answering or editing.
- Use shell only when the user asks you to run a command or when a command result is necessary to answer accurately. Shell commands always run in the working directory and require user approval before execution. Do not assume a denied command ran.
- For requests that ask you to find where a UI, component, function, or behavior is implemented and explain it, request grep first when the relevant file is not already clear, then read_file for the most relevant file before returning your final result.

After tool observations, return one final JSON object matching this schema:

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
- Preserve exact file content by splitting it into contentLines; Markdown code fences are ordinary line strings.
- Do not include both action and changes in the same response.`;
}

function renderSkillMessage(skill: ActivatedSkill | undefined): readonly ChatMessage[] {
  if (skill === undefined) {
    return [];
  }

  return [
    {
      role: "system",
      content: buildSkillPrompt(skill)
    }
  ];
}

function buildSkillPrompt(skill: ActivatedSkill): string {
  return `An explicit skill is active for this request.

Skill name: ${skill.name}
Skill source: ${skill.source}
Skill directory: ${skill.directory}

Full SKILL.md:
${skill.content}`;
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
