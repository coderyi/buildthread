export type SessionCommand =
  | { readonly type: "sessions" }
  | { readonly type: "resume"; readonly sessionId?: string }
  | { readonly type: "fork" };

export function parseSessionCommand(input: string): SessionCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const [rawName, ...args] = trimmed.slice(1).split(/\s+/u);
  const name = rawName?.toLowerCase();
  if (name === "sessions") {
    if (args.length > 0) {
      throw new Error("Usage: /sessions");
    }
    return { type: "sessions" };
  }
  if (name === "resume") {
    if (args.length > 1) {
      throw new Error("Usage: /resume <session-id>");
    }
    return { type: "resume", ...(args[0] === undefined ? {} : { sessionId: args[0] }) };
  }
  if (name === "fork") {
    if (args.length > 0) {
      throw new Error("Usage: /fork");
    }
    return { type: "fork" };
  }
  return undefined;
}
