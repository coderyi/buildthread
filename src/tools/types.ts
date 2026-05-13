export type ToolName = "read_file" | "grep" | "shell";

export interface ToolAction {
  readonly tool: ToolName;
  readonly arguments: Record<string, unknown>;
}

export interface ToolContext {
  readonly cwd: string;
}

export interface ReadFileSuccessObservation {
  readonly ok: true;
  readonly tool: "read_file";
  readonly path: string;
  readonly content: string;
  readonly hash: string;
  readonly size: number;
}

export interface GrepMatch {
  readonly path: string;
  readonly line: number;
  readonly text: string;
}

export interface GrepSuccessObservation {
  readonly ok: true;
  readonly tool: "grep";
  readonly query: string;
  readonly include?: string;
  readonly matches: readonly GrepMatch[];
  readonly matchCount: number;
  readonly searchedFiles: number;
  readonly truncated: boolean;
}

export interface ShellSuccessObservation {
  readonly ok: true;
  readonly tool: "shell";
  readonly command: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly timedOut: boolean;
  readonly durationMs: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
}

export interface ToolErrorObservation {
  readonly ok: false;
  readonly tool: ToolName;
  readonly error: string;
}

export type ToolObservation =
  | ReadFileSuccessObservation
  | GrepSuccessObservation
  | ShellSuccessObservation
  | ToolErrorObservation;

export interface ToolDefinition {
  readonly name: ToolName;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolObservation>;
}
