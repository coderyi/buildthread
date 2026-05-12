export class ModelError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "ModelError";
    if (status !== undefined) {
      this.status = status;
    }
  }
}

export function toModelError(error: unknown): ModelError {
  if (error instanceof ModelError) {
    return error;
  }

  if (error instanceof Error) {
    return new ModelError(error.message);
  }

  return new ModelError(String(error));
}
