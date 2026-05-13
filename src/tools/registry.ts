import { readFileTool } from "./read-file.js";
import type { ToolAction, ToolContext, ToolDefinition, ToolObservation } from "./types.js";

const tools = new Map<string, ToolDefinition>([[readFileTool.name, readFileTool]]);

export async function executeToolAction(action: ToolAction, context: ToolContext): Promise<ToolObservation> {
  const tool = tools.get(action.tool);

  if (tool === undefined) {
    return { ok: false, tool: action.tool, error: `Unknown tool: ${action.tool}` };
  }

  return tool.execute(action.arguments, context);
}
