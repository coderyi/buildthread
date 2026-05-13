import type { ToolAction } from "../tools/types.js";

export type ToolCapability = "workspace_read" | "shell_command";

export interface PermissionDecision {
  readonly capability: ToolCapability;
  readonly requiresApproval: boolean;
  readonly reason: string;
}

export function getToolCapability(action: ToolAction): ToolCapability {
  return action.tool === "shell" ? "shell_command" : "workspace_read";
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

  return {
    capability,
    requiresApproval: false,
    reason: "Workspace read tools are allowed without approval."
  };
}
