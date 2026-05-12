import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { RuntimeOptions } from "./runtime.js";
import { writeLine } from "./output.js";
import { runAgent } from "../agent/session.js";
import { createAgentSession } from "../agent/conversation.js";
import { applyPreparedChanges } from "../agent/changes.js";

export async function runPromptMode(runtime: RuntimeOptions, prompt: string): Promise<void> {
  const result = await runAgent({ session: createAgentSession(runtime), prompt });

  if (result.message.length > 0) {
    writeLine(result.message);
  }

  if (result.changes.length === 0) {
    return;
  }

  writeLine();
  writeLine(result.diff);
  writeLine();

  const confirmed = await confirm("Apply these changes? [y/N] ");

  if (!confirmed) {
    writeLine("No files changed.");
    return;
  }

  await applyPreparedChanges(result.changes);
  writeLine(`Applied ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}.`);
}

async function confirm(question: string): Promise<boolean> {
  const readline = createInterface({ input, output });

  try {
    const answer = await readline.question(question);
    return answer.trim().toLowerCase() === "y";
  } finally {
    readline.close();
  }
}
