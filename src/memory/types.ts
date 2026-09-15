export const MEMORY_SCHEMA_VERSION = 1 as const;
export const MAX_MEMORY_FILE_BYTES = 32 * 1024;
export const MAX_MEMORY_TEXT_CHARS = 2_000;

export interface MemoryEntry {
  readonly id: string;
  readonly addedAt: string;
  readonly content: string;
}

export interface MemoryContext {
  readonly content?: string;
  readonly warning?: string;
  readonly truncated: boolean;
}

export interface AddMemoryResult {
  readonly entry: MemoryEntry;
  readonly duplicate: boolean;
}

export interface RemoveMemoryResult {
  readonly entry: MemoryEntry;
}
