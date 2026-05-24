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
