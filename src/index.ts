#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { parseArgs, ArgParseError } from "./cli/args.js";
import { formatHelp } from "./cli/help.js";
import { readPackageVersion } from "./cli/version.js";
import { createRuntimeOptions, resolveWorkingDirectory, type RuntimeOptions } from "./cli/runtime.js";
import { runPromptMode } from "./cli/prompt-mode.js";
import { runReviewMode } from "./cli/review-mode.js";
import { formatSkills } from "./cli/skills.js";
import { App } from "./tui/App.js";
import { createAgentSession, restoreAgentSession } from "./agent/conversation.js";
import {
  createSession,
  findLastSessionId,
  forkStoredSession,
  listSessions,
  resumeSession,
  closeActiveSessions,
  type CreateSessionOptions,
  type ResumeSessionResult
} from "./sessions/store.js";
import { formatSessionList } from "./sessions/render.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(formatHelp());
    return;
  }

  if (args.version) {
    const version = await readPackageVersion();
    process.stdout.write(`buildthread ${version}\n`);
    return;
  }

  if (args.skills) {
    const cwd = await resolveWorkingDirectory(args.cwd);
    process.stdout.write(await formatSkills(cwd));
    return;
  }

  if (args.command === "sessions") {
    const cwd = await resolveWorkingDirectory(args.cwd);
    process.stdout.write(`${formatSessionList(await listSessions(cwd))}\n`);
    return;
  }

  const runtime = await createRuntimeOptions(args);

  if (args.command === "review") {
    await runReviewMode(runtime, args.reviewArgs);
    return;
  }

  const appVersion = await readPackageVersion();
  const sessionOptions = makeSessionOptions(runtime, appVersion);
  let persistent: ResumeSessionResult | undefined;

  if (args.command === "resume" || args.command === "fork") {
    const sessionId = args.last ? await findLastSessionId(runtime.cwd) : args.sessionId;
    if (sessionId === undefined) {
      throw new Error(`${args.command} requires a session ID or --last.`);
    }
    persistent = args.command === "resume"
      ? await resumeSession(sessionOptions, sessionId)
      : await forkStoredSession(sessionOptions, sessionId);
    writeCompatibilityWarnings(persistent.compatibilityWarnings);
    if (args.command === "fork") {
      process.stderr.write(`Forked ${sessionId} as ${persistent.handle.sessionId}. Conversation history was copied; working files are shared.\n`);
    }
  }

  if (args.prompt.length > 0) {
    persistent ??= await createSession(sessionOptions);
    process.stderr.write(`Session: ${persistent.handle.sessionId}\n`);
    const session = restoreAgentSession(runtime, persistent.loaded.reduced.messages);
    await runPromptMode(runtime, args.prompt, { session, handle: persistent.handle }, args.skill);
    return;
  }

  render(React.createElement(App, { runtime, appVersion, ...(persistent === undefined ? {} : { initialPersistent: persistent }) }));
}

let handlingSignal = false;
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]] as const) {
  process.once(signal, () => {
    if (handlingSignal) {
      return;
    }
    handlingSignal = true;
    void closeActiveSessions().finally(() => process.exit(exitCode));
  });
}

function makeSessionOptions(runtime: RuntimeOptions, appVersion: string): CreateSessionOptions {
  return {
    cwd: runtime.cwd,
    model: runtime.model,
    appVersion,
    maxHistoryTurns: createAgentSession(runtime).maxHistoryTurns,
    secrets: [runtime.apiKey]
  };
}

function writeCompatibilityWarnings(warnings: readonly string[]): void {
  for (const warning of warnings) {
    process.stderr.write(`Warning: ${warning}\n`);
  }
}

main().catch((error: unknown) => {
  if (error instanceof ArgParseError) {
    process.stderr.write(`Error: ${error.message}\n\n${formatHelp()}`);
    process.exitCode = 2;
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
});
