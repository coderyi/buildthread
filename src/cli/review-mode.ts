import type { RuntimeOptions } from "./runtime.js";
import { writeLine } from "./output.js";
import { parseReviewArgs, runReview } from "../review/session.js";

export async function runReviewMode(runtime: RuntimeOptions, args: readonly string[]): Promise<void> {
  const request = parseReviewArgs(args);
  writeLine(request.userFacingHint);

  const result = await runReview({
    runtime,
    request,
    onEvent: (event) => {
      if (event.type === "diff_collected") {
        writeLine(`Collected diff (${event.byteLength} bytes).`);
      }
    }
  });

  writeLine();
  writeLine(result.formatted);
}

