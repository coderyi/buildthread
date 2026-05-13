import { grepTool } from "./grep.js";
import { readFileTool } from "./read-file.js";
import { shellTool } from "./shell.js";
import type { ToolAction, ToolContext, ToolDefinition, ToolName, ToolObservation } from "./types.js";

const toolDefinitions: readonly ToolDefinition[] = [readFileTool, grepTool, shellTool];
const tools = new Map<ToolName, ToolDefinition>(toolDefinitions.map((tool) => [tool.name, tool]));

export async function executeToolAction(action: ToolAction, context: ToolContext): Promise<ToolObservation> {
  const tool = tools.get(action.tool);

  if (tool === undefined) {
    return { ok: false, tool: action.tool, error: `Unknown tool: ${action.tool}` };
  }

  return tool.execute(action.arguments, context);
}

export function isRegisteredToolName(value: unknown): value is ToolName {
  return typeof value === "string" && tools.has(value as ToolName);
}

export function listToolNames(): readonly ToolName[] {
  return toolDefinitions.map((tool) => tool.name);
}
