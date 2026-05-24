import type { McpConfigLoadResult, McpServerConfig } from "./types.js";

export function formatMcpConfig(result: McpConfigLoadResult): string {
  if (result.status === "not_found") {
    return `未配置 MCP Server\n配置文件: ${result.path}\n`;
  }

  if (result.status === "error") {
    return [`MCP 配置错误`, `配置文件: ${result.error.path}`, result.error.message, ""].join("\n");
  }

  if (result.config.servers.length === 0) {
    return `未配置 MCP Server\n配置文件: ${result.config.path}\n`;
  }

  const lines = ["已配置 MCP Server:", `配置文件: ${result.config.path}`, ""];

  for (const server of result.config.servers) {
    lines.push(...formatServer(server), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatServer(server: McpServerConfig): string[] {
  return [
    `- ${server.name}`,
    `  transport: ${server.transport}`,
    `  command: ${server.command}`,
    `  args: ${JSON.stringify(server.args)}`
  ];
}
