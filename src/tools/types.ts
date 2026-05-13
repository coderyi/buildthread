export type ToolName = "read_file";

export interface ToolAction {
  readonly tool: ToolName;
  readonly arguments: Record<string, unknown>;
}

export interface ToolContext {
  readonly cwd: string;
}

export interface ToolSuccessObservation {
  readonly ok: true;
  readonly tool: ToolName;
  readonly path: string;
  readonly content: string;
  readonly hash: string;
  readonly size: number;
}

export interface ToolErrorObservation {
  readonly ok: false;
  readonly tool: ToolName;
  readonly error: string;
}

export type ToolObservation = ToolSuccessObservation | ToolErrorObservation;

export interface ToolDefinition {
  readonly name: ToolName;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolObservation>;
}
