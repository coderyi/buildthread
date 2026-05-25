export type JsonRpcId = string | number;

export interface JsonRpcRequest {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcNotification {
  readonly jsonrpc: "2.0";
  readonly method: string;
  readonly params?: unknown;
}

export interface JsonRpcErrorObject {
  readonly code: number;
  readonly message: string;
  readonly data?: unknown;
}

export interface JsonRpcSuccessResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly result: unknown;
}

export interface JsonRpcErrorResponse {
  readonly jsonrpc: "2.0";
  readonly id: JsonRpcId;
  readonly error: JsonRpcErrorObject;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;
export type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

export interface JsonRpcWritable {
  sendJsonRpc(message: JsonRpcMessage): void;
}

interface PendingRequest {
  readonly method: string;
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
}

export class JsonRpcClient {
  private nextId = 1;
  private readonly pending = new Map<JsonRpcId, PendingRequest>();
  private disposed = false;

  constructor(private readonly transport: JsonRpcWritable) {}

  request<T>(method: string, params: unknown, timeoutMs: number): Promise<T> {
    if (this.disposed) {
      return Promise.reject(new Error(`Cannot send MCP request ${method}: JSON-RPC client is closed.`));
    }

    const id = this.nextId;
    this.nextId += 1;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request ${method} timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
      timer.unref?.();

      this.pending.set(id, {
        method,
        resolve: (value) => resolve(value as T),
        reject,
        timer
      });

      try {
        this.transport.sendJsonRpc({
          jsonrpc: "2.0",
          id,
          method,
          ...(params === undefined ? {} : { params })
        });
      } catch (error: unknown) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.disposed) {
      throw new Error(`Cannot send MCP notification ${method}: JSON-RPC client is closed.`);
    }

    this.transport.sendJsonRpc({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params })
    });
  }

  receive(message: JsonRpcMessage): void {
    if (isJsonRpcResponse(message)) {
      const pending = this.pending.get(message.id);

      if (pending === undefined) {
        return;
      }

      clearTimeout(pending.timer);
      this.pending.delete(message.id);

      if ("error" in message) {
        pending.reject(new Error(`MCP request ${pending.method} failed: ${message.error.message}`));
        return;
      }

      pending.resolve(message.result);
      return;
    }

    if (isJsonRpcRequest(message)) {
      this.transport.sendJsonRpc({
        jsonrpc: "2.0",
        id: message.id,
        error: {
          code: -32601,
          message: `Method not found: ${message.method}`
        }
      });
    }
  }

  dispose(reason: Error): void {
    if (this.disposed) {
      return;
    }

    this.disposed = true;

    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(reason);
    }

    this.pending.clear();
  }
}

export function parseJsonRpcMessage(raw: string): JsonRpcMessage {
  let parsed: unknown;

  try {
    parsed = JSON.parse(raw);
  } catch (error: unknown) {
    throw new Error(`Invalid JSON-RPC JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!isRecord(parsed) || parsed.jsonrpc !== "2.0") {
    throw new Error("Invalid JSON-RPC message: missing jsonrpc \"2.0\".");
  }

  if (typeof parsed.method === "string") {
    if ("id" in parsed) {
      const id = parseJsonRpcId(parsed.id);
      return {
        jsonrpc: "2.0",
        id,
        method: parsed.method,
        ...("params" in parsed ? { params: parsed.params } : {})
      };
    }

    return {
      jsonrpc: "2.0",
      method: parsed.method,
      ...("params" in parsed ? { params: parsed.params } : {})
    };
  }

  if ("id" in parsed && ("result" in parsed || "error" in parsed)) {
    const id = parseJsonRpcId(parsed.id);

    if ("error" in parsed) {
      if (!isRecord(parsed.error) || typeof parsed.error.code !== "number" || typeof parsed.error.message !== "string") {
        throw new Error("Invalid JSON-RPC error response.");
      }

      return {
        jsonrpc: "2.0",
        id,
        error: {
          code: parsed.error.code,
          message: parsed.error.message,
          ...("data" in parsed.error ? { data: parsed.error.data } : {})
        }
      };
    }

    return {
      jsonrpc: "2.0",
      id,
      result: parsed.result
    };
  }

  throw new Error("Invalid JSON-RPC message shape.");
}

function isJsonRpcResponse(message: JsonRpcMessage): message is JsonRpcResponse {
  return "id" in message && ("result" in message || "error" in message);
}

function isJsonRpcRequest(message: JsonRpcMessage): message is JsonRpcRequest {
  return "id" in message && "method" in message;
}

function parseJsonRpcId(value: unknown): JsonRpcId {
  if (typeof value === "string" || typeof value === "number") {
    return value;
  }

  throw new Error("Invalid JSON-RPC id.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
