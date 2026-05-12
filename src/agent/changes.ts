import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createUnifiedDiff } from "../workspace/diff.js";
import { sha256 } from "../workspace/hash.js";
import { resolveWorkspacePath, normalizeRelativePath } from "../workspace/paths.js";

export type ProposedChange =
  | {
      readonly type: "create";
      readonly path: string;
      readonly content: string;
    }
  | {
      readonly type: "replace";
      readonly path: string;
      readonly previousContentHash: string;
      readonly content: string;
    };

export type PreparedChange =
  | {
      readonly type: "create";
      readonly path: string;
      readonly absolutePath: string;
      readonly content: string;
      readonly diff: string;
    }
  | {
      readonly type: "replace";
      readonly path: string;
      readonly absolutePath: string;
      readonly previousContentHash: string;
      readonly content: string;
      readonly diff: string;
    };

export interface ParsedAssistantResult {
  readonly message: string;
  readonly changes: readonly ProposedChange[];
}

interface AssistantJson {
  readonly message?: unknown;
  readonly changes?: unknown;
}

export function parseAssistantResult(text: string): ParsedAssistantResult {
  const jsonText = extractJson(text);

  if (jsonText === undefined) {
    return { message: text.trim(), changes: [] };
  }

  try {
    const parsed = JSON.parse(jsonText) as AssistantJson;
    return {
      message: typeof parsed.message === "string" ? parsed.message : text.trim(),
      changes: parseChanges(parsed.changes)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Assistant returned invalid JSON: ${message}`);
  }
}

export async function prepareChanges(root: string, changes: readonly ProposedChange[]): Promise<readonly PreparedChange[]> {
  const prepared: PreparedChange[] = [];

  for (const change of changes) {
    const relativePath = normalizeRelativePath(change.path);
    const absolutePath = resolveWorkspacePath(root, relativePath);

    if (change.type === "create") {
      const existing = await stat(absolutePath).catch(() => undefined);

      if (existing !== undefined) {
        throw new Error(`Cannot create ${relativePath}: file already exists.`);
      }

      prepared.push({
        type: "create",
        path: relativePath,
        absolutePath,
        content: change.content,
        diff: createUnifiedDiff(relativePath, "", change.content)
      });
      continue;
    }

    const currentContent = await readFile(absolutePath, "utf8").catch(() => undefined);

    if (currentContent === undefined) {
      throw new Error(`Cannot replace ${relativePath}: file does not exist.`);
    }

    const currentHash = sha256(currentContent);

    if (currentHash !== change.previousContentHash) {
      throw new Error(`Cannot replace ${relativePath}: file changed since context was prepared.`);
    }

    prepared.push({
      type: "replace",
      path: relativePath,
      absolutePath,
      previousContentHash: change.previousContentHash,
      content: change.content,
      diff: createUnifiedDiff(relativePath, currentContent, change.content)
    });
  }

  return prepared;
}

export async function applyPreparedChanges(changes: readonly PreparedChange[]): Promise<void> {
  for (const change of changes) {
    if (change.type === "create") {
      const existing = await stat(change.absolutePath).catch(() => undefined);

      if (existing !== undefined) {
        throw new Error(`Cannot create ${change.path}: file already exists.`);
      }
    } else {
      const currentContent = await readFile(change.absolutePath, "utf8").catch(() => undefined);

      if (currentContent === undefined) {
        throw new Error(`Cannot replace ${change.path}: file does not exist.`);
      }

      if (sha256(currentContent) !== change.previousContentHash) {
        throw new Error(`Cannot replace ${change.path}: file changed before write.`);
      }
    }

    await mkdir(path.dirname(change.absolutePath), { recursive: true });
    await writeFile(change.absolutePath, change.content, "utf8");
  }
}

export function formatPreparedDiff(changes: readonly PreparedChange[]): string {
  return changes.map((change) => change.diff).join("\n\n");
}

function parseChanges(value: unknown): readonly ProposedChange[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parseChange);
}

function parseChange(value: unknown): ProposedChange {
  if (!isObject(value)) {
    throw new Error("Assistant change must be an object.");
  }

  const content = parseContentLines(value.contentLines);

  if (value.type === "create" && typeof value.path === "string" && content !== undefined) {
    return { type: "create", path: value.path, content };
  }

  if (
    value.type === "replace" &&
    typeof value.path === "string" &&
    typeof value.previousContentHash === "string" &&
    content !== undefined
  ) {
    return {
      type: "replace",
      path: value.path,
      previousContentHash: value.previousContentHash,
      content
    };
  }

  throw new Error("Assistant change must match the create or replace schema.");
}

function parseContentLines(value: unknown): string | undefined {
  if (Array.isArray(value) && value.every((line) => typeof line === "string")) {
    return value.join("\n");
  }

  return undefined;
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
