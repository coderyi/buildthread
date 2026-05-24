import { readFile } from "node:fs/promises";
import path from "node:path";
import type { McpConfig, McpConfigLoadResult, McpServerConfig } from "./types.js";

const MCP_CONFIG_PATH = path.join(".buildthread", "mcp.json");
const SERVER_NAME_PATTERN = /^[A-Za-z0-9_.-]+$/u;

export async function loadMcpConfig(cwd: string): Promise<McpConfigLoadResult> {
  const configPath = path.join(cwd, MCP_CONFIG_PATH);

  let raw: string;

  try {
    raw = await readFile(configPath, "utf8");
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        status: "not_found",
        path: configPath
      };
    }

    return {
      status: "error",
      error: {
        path: configPath,
        message: `Failed to read MCP config: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    return {
      status: "error",
      error: {
        path: configPath,
        message: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
      }
    };
  }

  try {
    return {
      status: "loaded",
      config: validateMcpConfig(parsed, configPath)
    };
  } catch (error: unknown) {
    return {
      status: "error",
      error: {
        path: configPath,
        message: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function validateMcpConfig(value: unknown, configPath: string): McpConfig {
  if (!isRecord(value)) {
    throw new Error("MCP config must be a JSON object.");
  }

  const servers = value.mcpServers;

  if (!isRecord(servers)) {
    throw new Error("MCP config field `mcpServers` must be an object.");
  }

  return {
    path: configPath,
    servers: Object.entries(servers).map(([name, server]) => validateServerConfig(name, server))
  };
}

function validateServerConfig(name: string, value: unknown): McpServerConfig {
  if (name.length === 0 || !SERVER_NAME_PATTERN.test(name)) {
    throw new Error(
      `MCP server name \`${name}\` is invalid. Use letters, numbers, underscore, dash, or dot.`
    );
  }

  if (!isRecord(value)) {
    throw new Error(`MCP server \`${name}\` must be an object.`);
  }

  if (typeof value.command !== "string" || value.command.trim().length === 0) {
    if (typeof value.url === "string" || typeof value.httpUrl === "string") {
      throw new Error(`MCP server \`${name}\` uses a remote transport, which is not supported yet.`);
    }

    throw new Error(`MCP server \`${name}\` field \`command\` must be a non-empty string for stdio transport.`);
  }

  if (value.transport !== undefined && value.transport !== "stdio") {
    throw new Error(`MCP server \`${name}\` field \`transport\` must be "stdio" when using command-based config.`);
  }

  if (value.args !== undefined && (!Array.isArray(value.args) || !value.args.every((arg) => typeof arg === "string"))) {
    throw new Error(`MCP server \`${name}\` field \`args\` must be a string array.`);
  }

  const config: McpServerConfig = {
    name,
    transport: "stdio",
    command: value.command,
    args: value.args ?? []
  };

  if (value.env !== undefined) {
    if (!isRecord(value.env)) {
      throw new Error(`MCP server \`${name}\` field \`env\` must be an object with string values.`);
    }

    const env: Record<string, string> = {};

    for (const [key, envValue] of Object.entries(value.env)) {
      if (typeof envValue !== "string") {
        throw new Error(`MCP server \`${name}\` field \`env.${key}\` must be a string.`);
      }

      env[key] = envValue;
    }

    return {
      ...config,
      env
    };
  }

  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
