import type { McpOverview, McpServerConnectionStatus, McpServerSnapshot, McpTool } from "./types.js";

export function formatMcpStatus(result: McpOverview): string {
  if (result.status === "not_configured") {
    return `未配置 MCP Server\n配置文件: ${result.path}\n`;
  }

  if (result.status === "config_error") {
    return [`MCP 配置错误`, `配置文件: ${result.error.path}`, result.error.message, ""].join("\n");
  }

  const lines = ["MCP Server 状态:", `配置文件: ${result.path}`, ""];

  for (const server of result.servers) {
    lines.push(...formatServer(server), "");
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function formatServer(server: McpServerSnapshot): string[] {
  const lines = [
    `- ${server.name}`,
    `  状态: ${formatStatus(server.status)}`,
    `  transport: ${server.config.transport}`,
    `  command: ${server.config.command}`,
    `  args: ${JSON.stringify(server.config.args)}`
  ];

  if (server.serverInfo !== undefined) {
    lines.push(
      `  server: ${server.serverInfo.name}${server.serverInfo.version === undefined ? "" : ` ${server.serverInfo.version}`}`
    );
  }

  if (server.capabilities !== undefined) {
    lines.push(`  capabilities: ${server.capabilities.tools ? "tools" : "无 tools"}`);
  }

  if (server.error !== undefined) {
    lines.push(`  error: ${server.error}`);
  }

  if (server.toolsListError !== undefined) {
    lines.push(`  tools/list error: ${server.toolsListError}`);
  }

  if (server.status === "connected") {
    if (server.capabilities?.tools !== true) {
      lines.push("  tools: Server 未声明 tools 能力");
    } else if (server.tools.length === 0) {
      lines.push("  tools: 无");
    } else {
      lines.push("  tools:");

      for (const tool of server.tools) {
        lines.push(...formatTool(tool));
      }
    }
  }

  if (server.stderr !== undefined && server.stderr.length > 0) {
    lines.push(`  stderr${server.stderrTruncated === true ? " (已截断)" : ""}:`);
    for (const line of server.stderr.split(/\r?\n/u)) {
      lines.push(`    ${line}`);
    }
  }

  return lines;
}

function formatTool(tool: McpTool): string[] {
  return [
    `    - ${tool.name}`,
    `      描述: ${tool.description === undefined || tool.description.trim().length === 0 ? "无" : singleLine(tool.description)}`,
    `      输入: ${summarizeInputSchema(tool.inputSchema)}`
  ];
}

function formatStatus(status: McpServerConnectionStatus): string {
  if (status === "connected") {
    return "已连接";
  }

  if (status === "start_failed") {
    return "启动失败";
  }

  if (status === "initialize_failed") {
    return "初始化失败";
  }

  return "已断开";
}

function summarizeInputSchema(schema: unknown): string {
  if (!isRecord(schema)) {
    return "无";
  }

  const type = typeof schema.type === "string" ? schema.type : "object";
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  const required = Array.isArray(schema.required)
    ? new Set(schema.required.filter((name): name is string => typeof name === "string"))
    : new Set<string>();

  if (properties === undefined || Object.keys(properties).length === 0) {
    return `type=${type}`;
  }

  const propertySummaries = Object.entries(properties)
    .slice(0, 8)
    .map(([name, value]) => `${name}${required.has(name) ? "*" : ""}: ${summarizeSchemaType(value)}`);
  const remaining = Object.keys(properties).length - propertySummaries.length;

  if (remaining > 0) {
    propertySummaries.push(`... +${remaining}`);
  }

  return `type=${type}; properties: ${propertySummaries.join(", ")}`;
}

function summarizeSchemaType(value: unknown): string {
  if (!isRecord(value)) {
    return "unknown";
  }

  if (typeof value.type === "string") {
    if (value.type === "array" && isRecord(value.items)) {
      return `array<${summarizeSchemaType(value.items)}>`;
    }

    return value.type;
  }

  if (Array.isArray(value.type)) {
    return value.type.filter((item): item is string => typeof item === "string").join("|") || "unknown";
  }

  if (Array.isArray(value.enum)) {
    return `enum(${value.enum
      .slice(0, 4)
      .map((item) => JSON.stringify(item))
      .join("|")}${value.enum.length > 4 ? "|..." : ""})`;
  }

  return "unknown";
}

function singleLine(value: string): string {
  const text = value.replace(/\s+/gu, " ").trim();
  return text.length > 160 ? `${text.slice(0, 157)}...` : text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
