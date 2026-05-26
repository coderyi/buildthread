import type { ToolAction } from "../tools/types.js";

export type ToolCapability = "workspace_read" | "shell_command" | "external_tool";

export interface PermissionDecision {
  readonly capability: ToolCapability;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

export function getToolCapability(action: ToolAction): ToolCapability {
  if (action.tool === "shell") {
    return "shell_command";
  }

  if (action.tool === "mcp_call") {
    return "external_tool";
  }

  return "workspace_read";
}

export function decideToolPermission(action: ToolAction): PermissionDecision {
  const capability = getToolCapability(action);

  if (capability === "shell_command") {
    return {
      capability,
      requiresApproval: true,
      reason: "Shell commands require explicit user approval."
    };
  }

  if (capability === "external_tool") {
    return {
      capability,
      requiresApproval: true,
      reason: "External MCP tool calls require explicit user approval."
    };
  }

  return {
    capability,
    requiresApproval: false,
    reason: "Workspace read tools are allowed without approval."
  };
}
