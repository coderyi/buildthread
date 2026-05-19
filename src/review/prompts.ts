import type { WorkspaceSnapshot } from "../workspace/files.js";
import type { ReviewRequest } from "./types.js";

export function buildReviewMessages(
  request: ReviewRequest,
  diff: string,
  snapshot: WorkspaceSnapshot
): readonly { readonly role: "system" | "user"; readonly content: string }[] {
  return [
    {
      role: "system",
      content: buildReviewSystemPrompt()
    },
    {
      role: "user",
      content: buildReviewUserPrompt(request, diff, snapshot)
    }
  ];
}

function buildReviewSystemPrompt(): string {
  return `You are a senior code reviewer. Review only the supplied change.

Report issues the author would plausibly fix before merging. Focus on correctness, regressions, security, data loss, race conditions, broken public contracts, and missing tests when they hide a real defect.

Do not propose broad refactors, style preferences, or speculative improvements. Do not ask to run commands. Do not modify files.

Return valid JSON only with this schema:
{
  "findings": [
    {
      "title": "short imperative issue title",
      "body": "specific explanation with impact and the minimal fix direction",
      "severity": "critical | high | medium | low",
      "file": "relative/path.ts",
      "line": 123
    }
  ],
  "overall_correctness": "patch is correct | patch is incorrect",
  "overall_explanation": "brief summary",
  "overall_confidence_score": 0.0
}

Use "patch is incorrect" when at least one finding indicates the change should not be merged as-is. If there are no actionable findings, return an empty findings array.`;
}

function buildReviewUserPrompt(request: ReviewRequest, diff: string, snapshot: WorkspaceSnapshot): string {
  const targetText = renderTarget(request);

  return `Review target:
${targetText}

Working directory:
${snapshot.root}

Project files:
${snapshot.tree}

Loaded file contents for context:
${renderLoadedFiles(snapshot)}

Diff to review:
${diff.length === 0 ? "(empty diff)" : diff}`;
}

function renderTarget(request: ReviewRequest): string {
  const { target } = request;

  if (target.type === "uncommitted") {
    return "Uncommitted changes";
  }

  if (target.type === "base_branch") {
    return `Changes from merge-base with ${target.branch} to HEAD`;
  }

  if (target.type === "commit") {
    return `Commit ${target.sha}`;
  }

  return `Uncommitted changes with custom review instructions:\n${target.instructions}`;
}

function renderLoadedFiles(snapshot: WorkspaceSnapshot): string {
  const parts: string[] = [];

  for (const file of snapshot.files) {
    if (file.content === undefined) {
      parts.push(`\n--- ${file.path}\nSkipped: ${file.skippedReason ?? "not loaded"}; size=${file.size}`);
      continue;
    }

    parts.push(`\n--- ${file.path}\n${file.content}`);
  }

  return parts.length === 0 ? "(none)" : parts.join("\n");
}
