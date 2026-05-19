export interface CliArgs {
  readonly model: string;
  readonly cwd: string;
  readonly apiKey?: string;
  readonly stream: boolean;
  readonly help: boolean;
  readonly version: boolean;
  readonly skills: boolean;
  readonly skill?: string;
  readonly prompt: string;
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
      default:
        throw new ArgParseError(`Unknown option: ${arg}`);
    }
  }

  const prompt = promptParts.join(" ").trim();

  if (skill !== undefined && prompt.length === 0 && !help && !version && !skills) {
    throw new ArgParseError("--skill requires a prompt. Use /skill:<name> inside the TUI.");
  }

  const parsed: CliArgs = {
    model,
    cwd,
    stream,
    help,
    version,
    skills,
    prompt
  };

  const withApiKey = apiKey === undefined ? parsed : { ...parsed, apiKey };
  return skill === undefined ? withApiKey : { ...withApiKey, skill };
}

function readOptionValue(argv: readonly string[], index: number, option: string): string {
  const value = argv[index + 1];

  if (value === undefined || value.length === 0 || value.startsWith("--")) {
    throw new ArgParseError(`Missing value for ${option}`);
  }

  return value;
}
