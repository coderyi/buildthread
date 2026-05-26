import { JsonRpcClient } from "./json-rpc.js";
import { McpStdioProcess, type McpProcessExit } from "./stdio.js";
import type {
  McpServerCapabilities,
  McpServerConfig,
  McpServerInfo,
  McpTool,
  McpToolCallResult
} from "./types.js";

const DEFAULT_INITIALIZE_TIMEOUT_MS = 5_000;
const DEFAULT_TOOLS_LIST_TIMEOUT_MS = 5_000;
export const DEFAULT_TOOL_CALL_TIMEOUT_MS = 15_000;
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MAX_TOOL_LIST_PAGES = 10;

export class McpStartError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpStartError";
  }
}

export class McpInitializationError extends Error {
  constructor(
    message: string,
    readonly stderr?: string,
    readonly stderrTruncated?: boolean
  ) {
    super(message);
    this.name = "McpInitializationError";
  }
}

export interface McpClientOptions {
  readonly initializeTimeoutMs?: number;
}

export class McpClient {
  private readonly rpc: JsonRpcClient;
  private capabilitiesValue: McpServerCapabilities | undefined;
  private serverInfoValue: McpServerInfo | undefined;

  private constructor(private readonly transport: McpStdioProcess) {
    this.rpc = new JsonRpcClient(transport);
    this.transport.onMessage((message) => this.rpc.receive(message));
    this.transport.onError((error) => {
      this.rpc.dispose(error);
    });
    this.transport.onExit((exit) => {
      this.rpc.dispose(new Error(formatExit(exit)));
    });
  }

  static async connect(config: McpServerConfig, cwd: string, options: McpClientOptions = {}): Promise<McpClient> {
    let transport: McpStdioProcess;

    try {
      transport = await McpStdioProcess.start(config, cwd);
    } catch (error: unknown) {
      throw new McpStartError(error instanceof Error ? error.message : String(error));
    }

    const client = new McpClient(transport);

    try {
      await client.initialize(options.initializeTimeoutMs ?? DEFAULT_INITIALIZE_TIMEOUT_MS);
    } catch (error: unknown) {
      const stderr = client.stderr();
      client.close();
      throw new McpInitializationError(
        error instanceof Error ? error.message : String(error),
        stderr.text.length === 0 ? undefined : stderr.text,
        stderr.truncated
      );
    }

    return client;
  }

  capabilities(): McpServerCapabilities | undefined {
    return this.capabilitiesValue;
  }

  serverInfo(): McpServerInfo | undefined {
    return this.serverInfoValue;
  }

  supportsTools(): boolean {
    return this.capabilitiesValue?.tools === true;
  }

  async listTools(timeoutMs = DEFAULT_TOOLS_LIST_TIMEOUT_MS): Promise<readonly McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | undefined;

    for (let page = 0; page < MAX_TOOL_LIST_PAGES; page += 1) {
      const params = cursor === undefined ? {} : { cursor };
      const result = await this.rpc.request<unknown>("tools/list", params, timeoutMs);
      const pageResult = parseToolsListResult(result);
      tools.push(...pageResult.tools);

      if (pageResult.nextCursor === undefined) {
        return tools;
      }

      cursor = pageResult.nextCursor;
    }

    throw new Error(`MCP tools/list exceeded ${MAX_TOOL_LIST_PAGES} pages.`);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    timeoutMs = DEFAULT_TOOL_CALL_TIMEOUT_MS
  ): Promise<McpToolCallResult> {
    const result = await this.rpc.request<unknown>(
      "tools/call",
      {
        name,
        arguments: args
      },
      timeoutMs
    );

    return {
      result,
      isError: isRecord(result) && result.isError === true
    };
  }

  close(): void {
    this.rpc.dispose(new Error("MCP client closed."));
    this.transport.close();
  }

  isConnected(): boolean {
    return this.transport.isRunning();
  }

  stderr(): { readonly text: string; readonly truncated: boolean } {
    return this.transport.stderr();
  }

  onExit(listener: (message: string) => void): () => void {
    return this.transport.onExit((exit) => {
      listener(formatExit(exit));
    });
  }

  private async initialize(timeoutMs: number): Promise<void> {
    const result = await this.rpc.request<unknown>(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: "buildthread",
          version: "0.1.2"
        }
      },
      timeoutMs
    );
    const parsed = parseInitializeResult(result);
    this.capabilitiesValue = parsed.capabilities;
    this.serverInfoValue = parsed.serverInfo;
    this.rpc.notify("notifications/initialized");
  }
}

function parseInitializeResult(value: unknown): {
  readonly capabilities: McpServerCapabilities;
  readonly serverInfo?: McpServerInfo;
} {
  if (!isRecord(value)) {
    throw new Error("Invalid initialize result: expected object.");
  }

  const rawCapabilities = value.capabilities;

  if (!isRecord(rawCapabilities)) {
    throw new Error("Invalid initialize result: missing capabilities object.");
  }

  const serverInfo = parseServerInfo(value.serverInfo);

  return {
    capabilities: {
      tools: isRecord(rawCapabilities.tools),
      raw: rawCapabilities
    },
    ...(serverInfo === undefined ? {} : { serverInfo })
  };
}

function parseToolsListResult(value: unknown): { readonly tools: readonly McpTool[]; readonly nextCursor?: string } {
  if (!isRecord(value) || !Array.isArray(value.tools)) {
    throw new Error("Invalid tools/list result: expected tools array.");
  }

  const tools: McpTool[] = [];

  for (const tool of value.tools) {
    if (!isRecord(tool) || typeof tool.name !== "string" || tool.name.length === 0) {
      throw new Error("Invalid tools/list result: tool name must be a non-empty string.");
    }

    tools.push({
      name: tool.name,
      ...(typeof tool.description === "string" ? { description: tool.description } : {}),
      ...("inputSchema" in tool ? { inputSchema: tool.inputSchema } : {})
    });
  }

  return {
    tools,
    ...(typeof value.nextCursor === "string" && value.nextCursor.length > 0 ? { nextCursor: value.nextCursor } : {})
  };
}

function parseServerInfo(value: unknown): McpServerInfo | undefined {
  if (!isRecord(value) || typeof value.name !== "string" || value.name.length === 0) {
    return undefined;
  }

  return {
    name: value.name,
    ...(typeof value.version === "string" ? { version: value.version } : {})
  };
}

function formatExit(exit: McpProcessExit): string {
  if (exit.signal !== null) {
    return `MCP server exited with signal ${exit.signal}.`;
  }

  return `MCP server exited with code ${exit.code ?? "unknown"}.`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
