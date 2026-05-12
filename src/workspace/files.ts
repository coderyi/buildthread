import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { sha256 } from "./hash.js";
import { isIgnoredDirectoryName, shouldSkipFileContent } from "./ignore.js";

const DEFAULT_MAX_FILES = 300;
const DEFAULT_MAX_FILE_BYTES = 128 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 768 * 1024;

export interface WorkspaceFile {
  readonly path: string;
  readonly size: number;
  readonly hash?: string;
  readonly content?: string;
  readonly skippedReason?: string;
}

export interface WorkspaceSnapshot {
  readonly root: string;
  readonly files: readonly WorkspaceFile[];
  readonly tree: string;
}

export interface ScanWorkspaceOptions {
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalBytes?: number;
}

interface FileEntry {
  readonly path: string;
  readonly absolutePath: string;
  readonly size: number;
}

export async function scanWorkspace(root: string, options: ScanWorkspaceOptions = {}): Promise<WorkspaceSnapshot> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const entries: FileEntry[] = [];

  await collectFiles(root, "", entries, maxFiles);
  entries.sort((left, right) => left.path.localeCompare(right.path));

  let totalBytes = 0;
  const files: WorkspaceFile[] = [];

  for (const entry of entries) {
    if (entry.size > maxFileBytes) {
      files.push({ path: entry.path, size: entry.size, skippedReason: "file too large" });
      continue;
    }

    if (shouldSkipFileContent(entry.path)) {
      files.push({ path: entry.path, size: entry.size, skippedReason: "content skipped" });
      continue;
    }

    if (totalBytes + entry.size > maxTotalBytes) {
      files.push({ path: entry.path, size: entry.size, skippedReason: "context limit reached" });
      continue;
    }

    const buffer = await readFile(entry.absolutePath);

    if (looksBinary(buffer)) {
      files.push({ path: entry.path, size: entry.size, skippedReason: "binary file" });
      continue;
    }

    const content = buffer.toString("utf8");
    totalBytes += Buffer.byteLength(content, "utf8");
    files.push({
      path: entry.path,
      size: entry.size,
      hash: sha256(content),
      content
    });
  }

  return {
    root,
    files,
    tree: renderTree(entries.map((entry) => entry.path))
  };
}

async function collectFiles(root: string, relativeDirectory: string, entries: FileEntry[], maxFiles: number): Promise<void> {
  if (entries.length >= maxFiles) {
    return;
  }

  const absoluteDirectory = path.join(root, relativeDirectory);
  const children = await readdir(absoluteDirectory, { withFileTypes: true }).catch(() => []);
  children.sort((left, right) => left.name.localeCompare(right.name));

  for (const child of children) {
    if (entries.length >= maxFiles) {
      return;
    }

    if (child.name === ".DS_Store") {
      continue;
    }

    const relativePath = joinRelative(relativeDirectory, child.name);

    if (child.isDirectory()) {
      if (!isIgnoredDirectoryName(child.name)) {
        await collectFiles(root, relativePath, entries, maxFiles);
      }
      continue;
    }

    if (!child.isFile()) {
      continue;
    }

    const absolutePath = path.join(root, relativePath);
    const info = await stat(absolutePath).catch(() => undefined);

    if (info === undefined || !info.isFile()) {
      continue;
    }

    entries.push({
      path: relativePath.replaceAll(path.sep, "/"),
      absolutePath,
      size: info.size
    });
  }
}

function joinRelative(directory: string, name: string): string {
  return directory.length === 0 ? name : path.join(directory, name);
}

function looksBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  return sample.includes(0);
}

function renderTree(paths: readonly string[]): string {
  if (paths.length === 0) {
    return "(empty)";
  }

  return paths.map((filePath) => `- ${filePath}`).join("\n");
}
