import { loadMcpConfig } from "./config.js";
import { McpClient, McpInitializationError, McpStartError } from "./client.js";
import type { McpOverview, McpServerConfig, McpServerSnapshot, McpTool, McpToolCallResult } from "./types.js";

interface ManagedServer {
  readonly configKey: string;
  readonly config: McpServerConfig;
  client?: McpClient;
  snapshot: McpServerSnapshot;
}

export class McpManager {
  private readonly servers = new Map<string, ManagedServer>();

  constructor(private readonly cwd: string) {}

  async refresh(): Promise<McpOverview> {
    const configResult = await loadMcpConfig(this.cwd);

    if (configResult.status === "not_found") {
      this.dispose();
      return {
        status: "not_configured",
        path: configResult.path
      };
    }

    if (configResult.status === "error") {
      this.dispose();
      return {
        status: "config_error",
        error: configResult.error
      };
    }

    if (configResult.config.servers.length === 0) {
      this.dispose();
      return {
        status: "not_configured",
        path: configResult.config.path
      };
    }

    const configuredNames = new Set(configResult.config.servers.map((server) => server.name));

    for (const [name, server] of this.servers.entries()) {
      if (!configuredNames.has(name)) {
        server.client?.close();
        this.servers.delete(name);
      }
    }

    const snapshots: McpServerSnapshot[] = [];

    for (const config of configResult.config.servers) {
      const snapshot = await this.refreshServer(config);
      snapshots.push(snapshot);
    }

    return {
      status: "loaded",
      path: configResult.config.path,
      servers: snapshots
    };
  }

  dispose(): void {
    for (const server of this.servers.values()) {
      server.client?.close();
    }

    this.servers.clear();
  }

  async callTool(
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
    timeoutMs?: number
  ): Promise<McpToolCallResult> {
    const server = this.servers.get(serverName);

    if (server === undefined) {
      throw new Error(`MCP server \`${serverName}\` is not in the discovered MCP directory.`);
    }

    if (server.snapshot.status !== "connected" || server.client === undefined || !server.client.isConnected()) {
      throw new Error(`MCP server \`${serverName}\` is not connected.`);
    }

    if (!server.snapshot.tools.some((tool) => tool.name === toolName)) {
      throw new Error(`MCP tool \`${serverName}.${toolName}\` is not in the discovered MCP directory.`);
    }

    return server.client.callTool(toolName, args, timeoutMs);
  }

  private async refreshServer(config: McpServerConfig): Promise<McpServerSnapshot> {
    const configKey = serializeServerConfig(config);
    const existing = this.servers.get(config.name);

    if (existing !== undefined && existing.configKey !== configKey) {
      existing.client?.close();
      this.servers.delete(config.name);
    }

    const current = this.servers.get(config.name);

    if (current?.client !== undefined && current.client.isConnected()) {
      current.snapshot = await this.refreshConnectedServer(config, current.client, current.snapshot.tools);
      return current.snapshot;
    }

    const managed: ManagedServer = {
      configKey,
      config,
      snapshot: {
        name: config.name,
        config,
        status: "disconnected",
        tools: []
      }
    };
    this.servers.set(config.name, managed);

    try {
      const client = await McpClient.connect(config, this.cwd);
      managed.client = client;
      client.onExit((message) => {
        if (managed.client !== client) {
          return;
        }

        const stderr = client.stderr();
        delete managed.client;
        managed.snapshot = {
          ...managed.snapshot,
          status: "disconnected",
          error: message,
          stderr: stderr.text,
          stderrTruncated: stderr.truncated
        };
      });

      managed.snapshot = await this.refreshConnectedServer(config, client, []);
      return managed.snapshot;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const status = error instanceof McpStartError ? "start_failed" : "initialize_failed";

      managed.snapshot = {
        name: config.name,
        config,
        status,
        tools: [],
        error: errorMessage,
        ...(error instanceof McpInitializationError && error.stderr !== undefined ? { stderr: error.stderr } : {}),
        ...(error instanceof McpInitializationError && error.stderrTruncated === true ? { stderrTruncated: true } : {})
      };

      if (!(error instanceof McpStartError) && !(error instanceof McpInitializationError)) {
        managed.snapshot = {
          ...managed.snapshot,
          error: `Unexpected MCP error: ${errorMessage}`
        };
      }

      return managed.snapshot;
    }
  }

  private async refreshConnectedServer(
    config: McpServerConfig,
    client: McpClient,
    cachedTools: readonly McpTool[]
  ): Promise<McpServerSnapshot> {
    const stderr = client.stderr();
    const capabilities = client.capabilities();
    const serverInfo = client.serverInfo();
    let tools = cachedTools;
    let toolsListError: string | undefined;

    if (client.supportsTools()) {
      try {
        tools = await client.listTools();
      } catch (error: unknown) {
        toolsListError = error instanceof Error ? error.message : String(error);
      }
    }

    return {
      name: config.name,
      config,
      status: "connected",
      tools,
      ...(capabilities === undefined ? {} : { capabilities }),
      ...(serverInfo === undefined ? {} : { serverInfo }),
      ...(toolsListError === undefined ? {} : { toolsListError }),
      ...(stderr.text.length === 0 ? {} : { stderr: stderr.text }),
      ...(stderr.truncated ? { stderrTruncated: true } : {})
    };
  }
}

function serializeServerConfig(config: McpServerConfig): string {
  return JSON.stringify({
    transport: config.transport,
    command: config.command,
    args: config.args,
    env: config.env ?? {}
  });
}
