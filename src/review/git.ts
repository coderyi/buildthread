import { spawn } from "node:child_process";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { createUnifiedDiff } from "../workspace/diff.js";

const GIT_TIMEOUT_MS = 120_000;
const MAX_COMMAND_OUTPUT_CHARS = 1_500_000;
const MAX_UNTRACKED_FILE_BYTES = 128 * 1024;

interface GitResult {
  readonly stdout: string;
  readonly stderr: string;
}

export async function collectUncommittedDiff(cwd: string): Promise<string> {
  await assertGitRepository(cwd);

  const [staged, unstaged, untracked] = await Promise.all([
    git(["diff", "--cached", "--no-ext-diff", "--find-renames"], cwd),
    git(["diff", "--no-ext-diff", "--find-renames"], cwd),
    collectUntrackedDiff(cwd)
  ]);

  return joinDiffs([staged.stdout, unstaged.stdout, untracked]);
}

export async function collectBaseBranchDiff(cwd: string, branch: string): Promise<string> {
  await assertGitRepository(cwd);
  const mergeBase = (await git(["merge-base", "HEAD", branch], cwd)).stdout.trim();

  if (mergeBase.length === 0) {
    throw new Error(`Could not find merge base with branch: ${branch}`);
  }

  const diff = await git(["diff", "--no-ext-diff", "--find-renames", mergeBase, "HEAD"], cwd);
  return diff.stdout;
}

export async function collectCommitDiff(cwd: string, sha: string): Promise<string> {
  await assertGitRepository(cwd);
  const diff = await git(["show", "--format=fuller", "--stat", "--patch", "--find-renames", sha], cwd);
  return diff.stdout;
}

async function assertGitRepository(cwd: string): Promise<void> {
  await git(["rev-parse", "--is-inside-work-tree"], cwd);
}

async function collectUntrackedDiff(cwd: string): Promise<string> {
  const result = await git(["ls-files", "--others", "--exclude-standard", "-z"], cwd);
  const files = result.stdout
    .split("\0")
    .filter((file) => file.length > 0);

  const diffs: string[] = [];

  for (const file of files) {
    const absolutePath = path.resolve(cwd, file);
    const relative = path.relative(cwd, absolutePath);

    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      continue;
    }

    const info = await lstat(absolutePath).catch(() => undefined);

    if (info === undefined || info.isSymbolicLink() || !info.isFile()) {
      continue;
    }

    const buffer = await readFile(absolutePath).catch(() => undefined);

    if (buffer === undefined || buffer.includes(0)) {
      continue;
    }

    if (buffer.byteLength > MAX_UNTRACKED_FILE_BYTES) {
      diffs.push(`--- ${file}\n+++ ${file}\n@@\n+Skipped untracked file: file too large (${buffer.byteLength} bytes)`);
      continue;
    }

    diffs.push(createUnifiedDiff(file, "", buffer.toString("utf8")));
  }

  return diffs.join("\n\n");
}

function git(args: readonly string[], cwd: string): Promise<GitResult> {
  const child = spawn("git", args, {
    cwd,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;
  let settled = false;

  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
  }, GIT_TIMEOUT_MS);

  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    const next = appendLimited(stdout, chunk);
    stdout = next.value;
    stdoutTruncated ||= next.truncated;
  });

  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    const next = appendLimited(stderr, chunk);
    stderr = next.value;
    stderrTruncated ||= next.truncated;
  });

  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      reject(error);
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);

      if (exitCode !== 0) {
        const message = stderr.trim().length > 0 ? stderr.trim() : `git ${args.join(" ")} failed`;
        reject(new Error(message));
        return;
      }

      const truncated = stdoutTruncated || stderrTruncated ? "\n\n[git output truncated]" : "";
      resolve({ stdout: `${stdout}${stdoutTruncated ? truncated : ""}`, stderr: `${stderr}${stderrTruncated ? truncated : ""}` });
    });
  });
}

function appendLimited(current: string, chunk: string): { readonly value: string; readonly truncated: boolean } {
  if (current.length >= MAX_COMMAND_OUTPUT_CHARS) {
    return { value: current, truncated: true };
  }

  const remaining = MAX_COMMAND_OUTPUT_CHARS - current.length;

  if (chunk.length <= remaining) {
    return { value: current + chunk, truncated: false };
  }

  return { value: current + chunk.slice(0, remaining), truncated: true };
}

function joinDiffs(diffs: readonly string[]): string {
  return diffs.map((diff) => diff.trim()).filter((diff) => diff.length > 0).join("\n\n");
}
