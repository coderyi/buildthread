import { DeepSeekClient } from "../model/deepseek.js";
import type { ModelClient } from "../model/types.js";
import type { RuntimeOptions } from "../cli/runtime.js";
import { scanWorkspace } from "../workspace/files.js";
import { buildReviewMessages } from "./prompts.js";
import { collectBaseBranchDiff, collectCommitDiff, collectUncommittedDiff } from "./git.js";
import type { ReviewFinding, ReviewOutput, ReviewRequest, ReviewTarget } from "./types.js";

export interface ReviewRunOptions {
  readonly runtime: RuntimeOptions;
  readonly request: ReviewRequest;
  readonly client?: ModelClient;
  readonly onEvent?: (event: ReviewEvent) => void;
}

export type ReviewEvent =
  | {
      readonly type: "entered_review_mode";
      readonly hint: string;
    }
  | {
      readonly type: "diff_collected";
      readonly byteLength: number;
    }
  | {
      readonly type: "model_request_started";
    }
  | {
      readonly type: "exited_review_mode";
    };

export interface ReviewResult {
  readonly output: ReviewOutput;
  readonly formatted: string;
  readonly rawResponse: string;
  readonly diff: string;
}

export function createReviewRequest(target: ReviewTarget): ReviewRequest {
  return {
    target,
    userFacingHint: formatReviewHint(target)
  };
}

export async function runReview(options: ReviewRunOptions): Promise<ReviewResult> {
  const { runtime, request } = options;

  options.onEvent?.({ type: "entered_review_mode", hint: request.userFacingHint });

  try {
    const [diff, snapshot] = await Promise.all([collectReviewDiff(runtime.cwd, request), scanWorkspace(runtime.cwd)]);
    options.onEvent?.({ type: "diff_collected", byteLength: Buffer.byteLength(diff, "utf8") });

    if (diff.trim().length === 0) {
      const output: ReviewOutput = {
        findings: [],
        overallCorrectness: "patch is correct",
        overallExplanation: "No diff was available for this review target.",
        overallConfidenceScore: 1
      };

      return {
        output,
        formatted: formatReviewOutput(output),
        rawResponse: JSON.stringify(toWireOutput(output)),
        diff
      };
    }

    const client = options.client ?? new DeepSeekClient({ apiKey: runtime.apiKey });
    const messages = buildReviewMessages(request, diff, snapshot);
    options.onEvent?.({ type: "model_request_started" });
    const response = await client.complete({
      model: runtime.model,
      messages,
      temperature: 0.1
    });
    const output = parseReviewOutput(response.content);

    return {
      output,
      formatted: formatReviewOutput(output),
      rawResponse: response.content,
      diff
    };
  } finally {
    options.onEvent?.({ type: "exited_review_mode" });
  }
}

export function parseReviewArgs(args: readonly string[]): ReviewRequest {
  if (args.length === 0) {
    return createReviewRequest({ type: "uncommitted" });
  }

  const [first, second, ...rest] = args;

  if ((first === "--base" || first === "-b") && second !== undefined && rest.length === 0) {
    return createReviewRequest({ type: "base_branch", branch: requireRevisionName(second, "base branch") });
  }

  if ((first === "--commit" || first === "-c") && second !== undefined && rest.length === 0) {
    return createReviewRequest({ type: "commit", sha: requireRevisionName(second, "commit sha") });
  }

  if (first === "--uncommitted" && args.length === 1) {
    return createReviewRequest({ type: "uncommitted" });
  }

  if (first?.startsWith("--") === true) {
    throw new Error("Usage: review [--uncommitted] [--base <branch>] [--commit <sha>] [custom instructions]");
  }

  return createReviewRequest({ type: "custom", instructions: requireNonEmpty(args.join(" "), "custom instructions") });
}

export function formatReviewOutput(output: ReviewOutput): string {
  const lines: string[] = [];

  lines.push(`Overall: ${output.overallCorrectness}`);
  lines.push(`Confidence: ${output.overallConfidenceScore.toFixed(2)}`);
  lines.push(output.overallExplanation);

  if (output.findings.length === 0) {
    lines.push("");
    lines.push("Findings: none");
    return lines.join("\n");
  }

  lines.push("");
  lines.push(`Findings (${output.findings.length}):`);

  for (const finding of output.findings) {
    const location = formatLocation(finding);
    lines.push(`- [${finding.severity}] ${finding.title}${location}`);
    lines.push(`  ${finding.body}`);
  }

  return lines.join("\n");
}

async function collectReviewDiff(cwd: string, request: ReviewRequest): Promise<string> {
  const { target } = request;

  if (target.type === "base_branch") {
    return collectBaseBranchDiff(cwd, target.branch);
  }

  if (target.type === "commit") {
    return collectCommitDiff(cwd, target.sha);
  }

  return collectUncommittedDiff(cwd);
}

function parseReviewOutput(text: string): ReviewOutput {
  const jsonText = extractJson(text);

  if (jsonText === undefined) {
    return {
      findings: [],
      overallCorrectness: "patch is incorrect",
      overallExplanation: text.trim().length === 0 ? "Reviewer returned an empty response." : text.trim(),
      overallConfidenceScore: 0
    };
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(jsonText);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Reviewer returned invalid JSON: ${message}`);
  }

  if (!isObject(parsed)) {
    throw new Error("Reviewer JSON must be an object.");
  }

  return {
    findings: parseFindings(parsed.findings),
    overallCorrectness: parseCorrectness(parsed.overall_correctness),
    overallExplanation:
      typeof parsed.overall_explanation === "string" ? parsed.overall_explanation : "No overall explanation provided.",
    overallConfidenceScore: parseConfidence(parsed.overall_confidence_score)
  };
}

function parseFindings(value: unknown): readonly ReviewFinding[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(parseFinding);
}

function parseFinding(value: unknown): ReviewFinding {
  if (!isObject(value)) {
    throw new Error("Review finding must be an object.");
  }

  const title = typeof value.title === "string" && value.title.trim().length > 0 ? value.title.trim() : "Untitled finding";
  const body = typeof value.body === "string" && value.body.trim().length > 0 ? value.body.trim() : "No details provided.";
  const severity = parseSeverity(value.severity);
  const file = typeof value.file === "string" && value.file.trim().length > 0 ? value.file.trim() : undefined;
  const line = Number.isInteger(value.line) && typeof value.line === "number" && value.line > 0 ? value.line : undefined;

  return {
    title,
    body,
    severity,
    ...(file === undefined ? {} : { file }),
    ...(line === undefined ? {} : { line })
  };
}

function parseSeverity(value: unknown): ReviewFinding["severity"] {
  if (value === "critical" || value === "high" || value === "medium" || value === "low") {
    return value;
  }

  return "medium";
}

function parseCorrectness(value: unknown): ReviewOutput["overallCorrectness"] {
  return value === "patch is incorrect" ? "patch is incorrect" : "patch is correct";
}

function parseConfidence(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function extractJson(text: string): string | undefined {
  const trimmed = text.trim();

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);

  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }

  return undefined;
}

function formatReviewHint(target: ReviewTarget): string {
  if (target.type === "uncommitted") {
    return "Reviewing uncommitted changes";
  }

  if (target.type === "base_branch") {
    return `Reviewing changes against ${target.branch}`;
  }

  if (target.type === "commit") {
    return `Reviewing commit ${target.sha}`;
  }

  return "Reviewing uncommitted changes with custom instructions";
}

function formatLocation(finding: ReviewFinding): string {
  if (finding.file === undefined) {
    return "";
  }

  return finding.line === undefined ? ` (${finding.file})` : ` (${finding.file}:${finding.line})`;
}

function requireNonEmpty(value: string, label: string): string {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new Error(`Review ${label} cannot be empty.`);
  }

  return trimmed;
}

function requireRevisionName(value: string, label: string): string {
  const trimmed = requireNonEmpty(value, label);

  if (trimmed.startsWith("-")) {
    throw new Error(`Review ${label} cannot start with "-".`);
  }

  return trimmed;
}

function toWireOutput(output: ReviewOutput): Record<string, unknown> {
  return {
    findings: output.findings,
    overall_correctness: output.overallCorrectness,
    overall_explanation: output.overallExplanation,
    overall_confidence_score: output.overallConfidenceScore
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
