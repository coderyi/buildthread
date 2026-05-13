import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { isIgnoredDirectoryName } from "../workspace/ignore.js";
import type { GrepMatch, ToolContext, ToolDefinition, ToolObservation } from "./types.js";

const MAX_SEARCH_FILE_BYTES = 1024 * 1024;
const MAX_SEARCH_FILES = 1000;
const MAX_SEARCH_BYTES = 16 * 1024 * 1024;
const MAX_MATCHES = 100;
const MAX_OUTPUT_CHARS = 20_000;
const MAX_LINE_CHARS = 500;

export const grepTool: ToolDefinition = {
  name: "grep",
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolObservation> {
    const query = args.query;
    const include = args.include;

    if (typeof query !== "string" || query.length === 0) {
      return { ok: false, tool: "grep", error: "grep requires arguments.query to be a non-empty string." };
    }

    if (include !== undefined && typeof include !== "string") {
      return { ok: false, tool: "grep", error: "grep arguments.include must be a string when provided." };
    }

    try {
      const normalizedInclude = include === undefined ? undefined : normalizeInclude(include);
      const includeMatcher = normalizedInclude === undefined ? () => true : buildIncludeMatcher(normalizedInclude);
      const files = await collectSearchableFiles(context.cwd, includeMatcher);
      const matches: GrepMatch[] = [];
      let searchedFiles = 0;
      let searchedBytes = 0;
      let outputChars = 0;
      let truncated = false;

      for (const file of files) {
        if (truncated) {
          break;
        }

        const info = await stat(file.absolutePath).catch(() => undefined);

        if (info === undefined || !info.isFile() || info.size > MAX_SEARCH_FILE_BYTES) {
          continue;
        }

        if (searchedFiles >= MAX_SEARCH_FILES || searchedBytes + info.size > MAX_SEARCH_BYTES) {
          truncated = true;
          break;
        }

        const buffer = await readFile(file.absolutePath).catch(() => undefined);

        if (buffer === undefined || looksBinary(buffer)) {
          continue;
        }

        searchedFiles += 1;
        searchedBytes += buffer.byteLength;
        const lines = buffer.toString("utf8").split(/\n/);

        for (let index = 0; index < lines.length; index += 1) {
          const text = stripTrailingCarriageReturn(lines[index] ?? "");

          if (!text.includes(query)) {
            continue;
          }

          const match = {
            path: file.relativePath,
            line: index + 1,
            text: truncateLine(text)
          };
          const matchChars = match.path.length + match.text.length + 32;

          if (matches.length >= MAX_MATCHES || outputChars + matchChars > MAX_OUTPUT_CHARS) {
            truncated = true;
            break;
          }

          matches.push(match);
          outputChars += matchChars;
        }
      }

      return {
        ok: true,
        tool: "grep",
        query,
        ...(normalizedInclude === undefined ? {} : { include: normalizedInclude }),
        matches,
        matchCount: matches.length,
        searchedFiles,
        truncated
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, tool: "grep", error: message };
    }
  }
};

interface SearchableFile {
  readonly relativePath: string;
  readonly absolutePath: string;
}

type IncludeMatcher = (relativePath: string) => boolean;

async function collectSearchableFiles(root: string, includeMatcher: IncludeMatcher): Promise<readonly SearchableFile[]> {
  const files: SearchableFile[] = [];
  await collectSearchableFilesInDirectory(root, "", includeMatcher, files);
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

async function collectSearchableFilesInDirectory(
  root: string,
  relativeDirectory: string,
  includeMatcher: IncludeMatcher,
  files: SearchableFile[]
): Promise<void> {
  const absoluteDirectory = path.join(root, relativeDirectory);
  const children = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
  children.sort((left, right) => left.name.localeCompare(right.name));

  for (const child of children) {
    if (child.name === ".DS_Store") {
      continue;
    }

    const relativePath = joinRelative(relativeDirectory, child.name).replaceAll(path.sep, "/");

    if (child.isDirectory()) {
      if (!isIgnoredDirectoryName(child.name)) {
        await collectSearchableFilesInDirectory(root, relativePath, includeMatcher, files);
      }
      continue;
    }

    if (!child.isFile() || !includeMatcher(relativePath)) {
      continue;
    }

    files.push({
      relativePath,
      absolutePath: path.join(root, relativePath)
    });
  }
}

function normalizeInclude(include: string): string {
  const trimmed = include.trim().replaceAll("\\", "/").replace(/\/+$/u, "");

  if (trimmed.length === 0) {
    throw new Error("grep arguments.include must not be empty.");
  }

  if (path.isAbsolute(trimmed)) {
    throw new Error(`grep arguments.include must be relative: ${include}`);
  }

  if (trimmed.split("/").some((segment) => segment === "..")) {
    throw new Error(`grep arguments.include must not escape the working directory: ${include}`);
  }

  return trimmed;
}

function buildIncludeMatcher(include: string): IncludeMatcher {
  const hasPathSeparator = include.includes("/");
  const hasGlob = /[*?]/.test(include);

  if (!hasGlob) {
    return (relativePath) => {
      return relativePath === include || relativePath.startsWith(`${include}/`) || path.posix.basename(relativePath) === include;
    };
  }

  const matcher = globToRegExp(include);

  if (hasPathSeparator) {
    return (relativePath) => matcher.test(relativePath);
  }

  return (relativePath) => matcher.test(path.posix.basename(relativePath));
}

function globToRegExp(glob: string): RegExp {
  let source = "^";

  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    const next = glob[index + 1];

    if (char === "*" && next === "*") {
      if (glob[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
        continue;
      }

      source += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    if (char === "?") {
      source += "[^/]";
      continue;
    }

    source += escapeRegExp(char ?? "");
  }

  return new RegExp(`${source}$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

function joinRelative(directory: string, name: string): string {
  return directory.length === 0 ? name : path.join(directory, name);
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

function stripTrailingCarriageReturn(line: string): string {
  return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function truncateLine(line: string): string {
  if (line.length <= MAX_LINE_CHARS) {
    return line;
  }

  return `${line.slice(0, MAX_LINE_CHARS - 3)}...`;
}
