import type { SessionListItem } from "./types.js";

export function formatSessionList(items: readonly SessionListItem[]): string {
  if (items.length === 0) {
    return "No sessions found for this working directory.";
  }

  const lines = ["SESSION ID                            UPDATED                   TURNS  PREVIEW"];
  for (const item of items) {
    lines.push(`${item.sessionId}  ${formatTimestamp(item.updatedAt).padEnd(24)}  ${String(item.turnCount).padStart(5)}  ${item.preview}`);
  }
  return lines.join("\n");
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}
