import type { AddMemoryResult, RemoveMemoryResult } from "./types.js";

export function formatMemoryShow(content: string | undefined): string {
  return content === undefined ? "No project memory has been saved for this working directory." : content.trimEnd();
}

export function formatMemoryAdded(result: AddMemoryResult): string {
  return result.duplicate
    ? `Memory already exists: ${result.entry.id}`
    : `Memory added: ${result.entry.id}`;
}

export function formatMemoryRemoved(result: RemoveMemoryResult): string {
  return `Memory removed: ${result.entry.id}`;
}

export function formatMemoryUsage(prefix = "buildthread memory"): string {
  return `Usage:
  ${prefix} show
  ${prefix} add <text>
  ${prefix} remove <memory-id>
  ${prefix} path`;
}
