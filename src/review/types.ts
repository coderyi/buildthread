export type ReviewTarget =
  | {
      readonly type: "uncommitted";
    }
  | {
      readonly type: "base_branch";
      readonly branch: string;
    }
  | {
      readonly type: "commit";
      readonly sha: string;
    }
  | {
      readonly type: "custom";
      readonly instructions: string;
    };

export interface ReviewRequest {
  readonly target: ReviewTarget;
  readonly userFacingHint: string;
}

export interface ReviewFinding {
  readonly title: string;
  readonly body: string;
  readonly severity: "critical" | "high" | "medium" | "low";
  readonly file?: string;
  readonly line?: number;
}

export interface ReviewOutput {
  readonly findings: readonly ReviewFinding[];
  readonly overallCorrectness: "patch is correct" | "patch is incorrect";
  readonly overallExplanation: string;
  readonly overallConfidenceScore: number;
}

