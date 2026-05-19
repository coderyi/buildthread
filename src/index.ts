#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { parseArgs, ArgParseError } from "./cli/args.js";
import { formatHelp } from "./cli/help.js";
import { readPackageVersion } from "./cli/version.js";
import { createRuntimeOptions, resolveWorkingDirectory } from "./cli/runtime.js";
import { runPromptMode } from "./cli/prompt-mode.js";
import { formatSkills } from "./cli/skills.js";
import { App } from "./tui/App.js";

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

  const runtime = await createRuntimeOptions(args);

  if (args.prompt.length > 0) {
    await runPromptMode(runtime, args.prompt, args.skill);
    return;
  }

  render(React.createElement(App, { runtime }));
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
