import type { RuntimeOptions } from "../cli/runtime.js";
import { formatSkills } from "../cli/skills.js";
import { McpManager } from "../mcp/manager.js";
import { formatMcpStatus } from "../mcp/render.js";
import { parseReviewArgs } from "../review/session.js";
import type { ReviewRequest } from "../review/types.js";
import { addMemory, getMemoryPath, removeMemory, showMemory } from "../memory/store.js";
import {
  formatMemoryAdded,
  formatMemoryRemoved,
  formatMemoryShow,
  formatMemoryUsage
} from "../memory/render.js";

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

const mcpManagers = new Map<string, McpManager>();

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
    name: "memory",
    usage: "/memory <show|add|remove|path>",
    handler: async (args, context) => {
      const [action, ...values] = args;
      if (action === "show" && values.length === 0) {
        return { content: formatMemoryShow(await showMemory(context.runtime.cwd)), statusText: "Memory shown." };
      }
      if (action === "path" && values.length === 0) {
        return { content: getMemoryPath(context.runtime.cwd), statusText: "Memory path shown." };
      }
      if (action === "add" && values.length > 0) {
        return {
          content: formatMemoryAdded(await addMemory(context.runtime.cwd, values.join(" "))),
          statusText: "Memory updated."
        };
      }
      if (action === "remove" && values.length === 1) {
        return {
          content: formatMemoryRemoved(await removeMemory(context.runtime.cwd, values[0]!)),
          statusText: "Memory updated."
        };
      }
      return {
        content: formatMemoryUsage("/memory"),
        statusText: "Memory command usage error."
      };
    }
  },
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
  },
  {
    name: "mcp",
    usage: "/mcp",
    handler: async (args, context) => {
      if (args.length > 0) {
        return {
          content: "Usage: /mcp",
          statusText: "Command usage error."
        };
      }

      const manager = getMcpManager(context.runtime.cwd);
      const result = await manager.refresh();

      return {
        content: formatMcpStatus(result).trimEnd(),
        statusText: result.status === "config_error" ? "MCP config error." : "MCP status refreshed."
      };
    }
  }
];

export function disposeSlashCommandResources(): void {
  for (const manager of mcpManagers.values()) {
    manager.dispose();
  }

  mcpManagers.clear();
}

function getMcpManager(cwd: string): McpManager {
  const existing = mcpManagers.get(cwd);

  if (existing !== undefined) {
    return existing;
  }

  const manager = new McpManager(cwd);
  mcpManagers.set(cwd, manager);
  return manager;
}

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

export function parseReviewSlashCommand(input: string): ReviewRequest | undefined {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    return undefined;
  }

  const [rawName, ...args] = trimmed.slice(1).split(/\s+/u);

  if (rawName?.toLowerCase() !== "review") {
    return undefined;
  }

  return parseReviewArgs(args);
}
