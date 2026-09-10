export interface CliArgs {
  readonly command: "chat" | "review" | "sessions" | "resume" | "fork";
  readonly model: string;
  readonly cwd: string;
  readonly apiKey?: string;
  readonly stream: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly skills: boolean;
  readonly skill?: string;
  readonly prompt: string;
  readonly reviewArgs: readonly string[];
  readonly sessionId?: string;
  readonly last: boolean;
}

export class ArgParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArgParseError";
  }
}

const DEFAULT_MODEL = "deepseek-v4-flash";

export function parseArgs(argv: readonly string[]): CliArgs {
  let model = DEFAULT_MODEL;
  let cwd = process.cwd();
  let apiKey: string | undefined;
  let stream = true;
  let help = false;
  let version = false;
  let skills = false;
  let skill: string | undefined;
  let command: CliArgs["command"] = "chat";
  let last = false;
  let selectorBeforeLast = false;
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === undefined) {
      continue;
    }

    if (arg === "--") {
      promptParts.push(...argv.slice(index + 1));
      break;
    }

    if (!arg.startsWith("--")) {
      if (promptParts.length === 0 && command === "chat") {
        if (arg === "review") {
          command = "review";
          promptParts.push(...argv.slice(index));
          break;
        }
        if (arg === "sessions" || arg === "resume" || arg === "fork") {
          command = arg;
          continue;
        }
      }

      if ((command === "resume" || command === "fork") && !last && promptParts.length === 0) {
        selectorBeforeLast = true;
      }
      promptParts.push(arg);
      continue;
    }

    switch (arg) {
      case "--model":
        model = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "--cwd":
        cwd = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "--api-key":
        apiKey = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "--no-stream":
        stream = false;
        break;
      case "--help":
        help = true;
        break;
      case "--version":
        version = true;
        break;
      case "--skills":
        skills = true;
        break;
      case "--skill":
        skill = readOptionValue(argv, index, arg);
        index += 1;
        break;
      case "--last":
        if (selectorBeforeLast) {
          throw new ArgParseError(`${command} cannot combine a session ID with --last.`);
        }
        last = true;
        break;
      default:
        throw new ArgParseError(`Unknown option: ${arg}`);
    }
  }

  let sessionId: string | undefined;
  let commandPromptParts = promptParts;
  if ((command === "resume" || command === "fork") && !last) {
    sessionId = promptParts[0];
    commandPromptParts = promptParts.slice(1);
  }
  const prompt = commandPromptParts.join(" ").trim();
  const reviewArgs = command === "review" ? promptParts.slice(1) : [];
  const informational = help || version || skills;

  if (!informational && command === "sessions" && promptParts.length > 0) {
    throw new ArgParseError("sessions does not accept positional arguments.");
  }
  if (!informational && (command === "resume" || command === "fork") && !last && sessionId === undefined) {
    throw new ArgParseError(`${command} requires a session ID or --last.`);
  }
  if (!informational && last && command !== "resume" && command !== "fork") {
    throw new ArgParseError("--last can only be used with resume or fork.");
  }
  if (skill !== undefined && (command === "review" || command === "sessions") && !informational) {
    throw new ArgParseError(`--skill cannot be used with ${command}.`);
  }

  if (skill !== undefined && prompt.length === 0 && !help && !version && !skills) {
    throw new ArgParseError("--skill requires a prompt. Use /skill:<name> inside the TUI.");
  }

  const parsed: CliArgs = {
    command,
    model,
    cwd,
    stream,
    help,
    version,
    skills,
    last,
    prompt: command === "review" ? "" : prompt,
    reviewArgs
  };

  const withSessionId = sessionId === undefined ? parsed : { ...parsed, sessionId };
  const withApiKey = apiKey === undefined ? withSessionId : { ...withSessionId, apiKey };
  return skill === undefined ? withApiKey : { ...withApiKey, skill };
}

function readOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];

  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new ArgParseError(`Missing value for ${option}`);
  }

  return value;
}
