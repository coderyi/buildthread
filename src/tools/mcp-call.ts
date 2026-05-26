import type { ToolContext, ToolDefinition, ToolObservation } from "./types.js";

export const mcpCallTool: ToolDefinition = {
  name: "mcp_call",
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolObservation> {
    const server = args.server;
    const name = args.name;
    const toolArguments = args.arguments;

    if (typeof server !== "string" || server.length === 0) {
      return { ok: false, tool: "mcp_call", error: "mcp_call requires arguments.server to be a non-empty string." };
    }

    if (typeof name !== "string" || name.length === 0) {
      return { ok: false, tool: "mcp_call", error: "mcp_call requires arguments.name to be a non-empty string." };
    }

    if (!isRecord(toolArguments)) {
      return { ok: false, tool: "mcp_call", error: "mcp_call requires arguments.arguments to be an object." };
    }

    if (context.mcpManager === undefined) {
      return { ok: false, tool: "mcp_call", error: "MCP tools are not available in this agent context." };
    }

    try {
      const result = await context.mcpManager.callTool(server, name, toolArguments);

      return {
        ok: true,
        tool: "mcp_call",
        server,
        name,
        arguments: toolArguments,
        result: result.result,
        isError: result.isError
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, tool: "mcp_call", error: `Runtime MCP tool call failed: ${message}` };
    }
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
