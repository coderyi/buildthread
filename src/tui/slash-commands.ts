import type { RuntimeOptions } from "../cli/runtime.js";
import { formatSkills } from "../cli/skills.js";

interface SlashCommandContext {
  readonly runtime: RuntimeOptions;
}

interface SlashCommandOutput {
  readonly content: string;
  readonly statusText: string;
}

type SlashCommandHandler = (args: readonly string[], context: SlashCommandContext) => Promise<SlashCommandOutput>;

interface SlashCommandDefinition {
  readonly name: string;
  readonly usage: string;
  readonly handler: SlashCommandHandler;
}

export type SlashCommandResult =
  | {
      readonly handled: false;
    }
  | {
      readonly handled: true;
      readonly output: Promise<SlashCommandOutput>;
    };

const slashCommands: readonly SlashCommandDefinition[] = [
  {
    name: "skills",
    usage: "/skills",
    handler: async (args, context) => {
      if (args.length > 0) {
        return {
          content: "Usage: /skills",
          statusText: "Command usage error."
        };
      }

      return {
        content: (await formatSkills(context.runtime.cwd)).trimEnd(),
        statusText: "Skills listed."
      };
    }
  }
];

export function executeSlashCommand(input: string, context: SlashCommandContext): SlashCommandResult {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return { handled: false };
  }

  const [rawName, ...args] = trimmed.slice(1).split(/\s+/u);
  const name = rawName?.toLowerCase() ?? "";
  const command = slashCommands.find((candidate) => candidate.name === name);

  if (command === undefined) {
    return { handled: false };
  }

  return {
    handled: true,
    output: command.handler(args, context)
  };
}
