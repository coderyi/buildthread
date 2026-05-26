export type McpTransport = "stdio";

export interface McpServerConfig {
  readonly name: string;
  readonly transport: McpTransport;
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
}

export interface McpConfig {
  readonly path: string;
  readonly servers: readonly McpServerConfig[];
}

export interface McpConfigLoadError {
  readonly path: string;
  readonly message: string;
}

export type McpConfigLoadResult =
  | {
      readonly status: "not_found";
      readonly path: string;
    }
  | {
      readonly status: "loaded";
      readonly config: McpConfig;
    }
  | {
      readonly status: "error";
      readonly error: McpConfigLoadError;
    };

export interface McpServerInfo {
  readonly name: string;
  readonly version?: string;
}

export interface McpServerCapabilities {
  readonly tools: boolean;
  readonly raw: unknown;
}

export interface McpTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: unknown;
}

export interface McpToolCallResult {
  readonly result: unknown;
  readonly isError: boolean;
}

export type McpServerConnectionStatus = "connected" | "start_failed" | "initialize_failed" | "disconnected";

export interface McpServerSnapshot {
  readonly name: string;
  readonly config: McpServerConfig;
  readonly status: McpServerConnectionStatus;
  readonly capabilities?: McpServerCapabilities;
  readonly serverInfo?: McpServerInfo;
  readonly tools: readonly McpTool[];
  readonly toolsListError?: string;
  readonly error?: string;
  readonly stderr?: string;
  readonly stderrTruncated?: boolean;
}

export type McpOverview =
  | {
      readonly status: "not_configured";
      readonly path: string;
    }
  | {
      readonly status: "config_error";
      readonly error: McpConfigLoadError;
    }
  | {
      readonly status: "loaded";
      readonly path: string;
      readonly servers: readonly McpServerSnapshot[];
    };
