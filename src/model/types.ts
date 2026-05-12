export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
}

export interface ModelRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly maxTokens?: number;
  readonly temperature?: number;
}

export interface ModelResponse {
  readonly content: string;
  readonly finishReason?: string;
}

export type ModelStreamEvent =
  | {
      readonly type: "content";
      readonly content: string;
    }
  | {
      readonly type: "done";
      readonly finishReason?: string;
    };

export interface ModelClient {
  complete(request: ModelRequest): Promise<ModelResponse>;
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>;
}
