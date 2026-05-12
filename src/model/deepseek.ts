import { ModelError } from "./errors.js";
import { readServerSentEvents } from "./stream.js";
import type { ChatMessage, ModelClient, ModelRequest, ModelResponse, ModelStreamEvent } from "./types.js";

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const REQUEST_TIMEOUT_MS = 120_000;

interface DeepSeekClientOptions {
  readonly apiKey: string;
  readonly baseUrl?: string;
}

interface DeepSeekChoice {
  readonly finish_reason?: string;
  readonly message?: {
    readonly content?: string | null;
  };
  readonly delta?: {
    readonly content?: string | null;
    readonly reasoning_content?: string | null;
  };
}

interface DeepSeekResponse {
  readonly choices?: readonly DeepSeekChoice[];
  readonly error?: {
    readonly message?: string;
    readonly type?: string;
  };
}

export class DeepSeekClient implements ModelClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: DeepSeekClientOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = trimTrailingSlash(options.baseUrl ?? DEFAULT_BASE_URL);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const response = await this.request(request, false);
    const parsed = (await response.json()) as DeepSeekResponse;
    const choice = parsed.choices?.[0];
    const content = choice?.message?.content;

    if (typeof content !== "string") {
      throw new ModelError("Model response did not include text content.");
    }

    const finishReason = choice?.finish_reason;
    return finishReason === undefined ? { content } : { content, finishReason };
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const response = await this.request(request, true);

    if (response.body === null) {
      throw new ModelError("Streaming response did not include a body.");
    }

    let finishReason: string | undefined;

    for await (const event of readServerSentEvents(response.body)) {
      if (event === "[DONE]") {
        yield finishReason === undefined ? { type: "done" } : { type: "done", finishReason };
        return;
      }

      const parsed = JSON.parse(event) as DeepSeekResponse;
      const choice = parsed.choices?.[0];
      const delta = choice?.delta?.content;

      if (typeof choice?.finish_reason === "string") {
        finishReason = choice.finish_reason;
      }

      if (typeof delta === "string" && delta.length > 0) {
        yield { type: "content", content: delta };
      }
    }

    yield finishReason === undefined ? { type: "done" } : { type: "done", finishReason };
  }

  private async request(request: ModelRequest, stream: boolean): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(toDeepSeekBody(request, stream)),
        signal: controller.signal
      });

      if (!response.ok) {
        throw await createHttpError(response);
      }

      return response;
    } catch (error) {
      if (error instanceof ModelError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new ModelError("Model request timed out.");
      }

      if (error instanceof Error) {
        throw new ModelError(error.message);
      }

      throw new ModelError(String(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function toDeepSeekBody(request: ModelRequest, stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map(toDeepSeekMessage),
    thinking: { type: "disabled" },
    response_format: { type: "json_object" },
    stream
  };

  if (request.maxTokens !== undefined) {
    body.max_tokens = request.maxTokens;
  }

  if (request.temperature !== undefined) {
    body.temperature = request.temperature;
  }

  return body;
}

function toDeepSeekMessage(message: ChatMessage): Record<string, string> {
  return {
    role: message.role,
    content: message.content
  };
}

async function createHttpError(response: Response): Promise<ModelError> {
  const text = await response.text().catch(() => "");

  if (text.length > 0) {
    try {
      const parsed = JSON.parse(text) as DeepSeekResponse;
      const message = parsed.error?.message;

      if (typeof message === "string" && message.length > 0) {
        return new ModelError(`Model request failed: ${message}`, response.status);
      }
    } catch {}
  }

  const label = response.statusText.length > 0 ? response.statusText : "HTTP error";
  return new ModelError(`Model request failed with ${response.status} ${label}.`, response.status);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
