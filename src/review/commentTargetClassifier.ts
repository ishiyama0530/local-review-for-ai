import { classifyLineTarget, type DiffMap, type DiffSide } from "../git/diffMapBuilder";
import type { ReviewTarget } from "../types";

export interface ClassifierInput {
  readonly diffMap?: DiffMap;
  readonly side: DiffSide;
  readonly lineNumber?: number;
  readonly lineEndNumber?: number;
  readonly isFileLevel: boolean;
}

export function classifyCommentTarget(input: ClassifierInput): ReviewTarget {
  if (input.isFileLevel) {
    return "file";
  }
  if (input.lineNumber === undefined) {
    return "file";
  }
  if (!input.diffMap) {
    return "unchanged";
  }
  const lineStart = input.lineNumber;
  const lineEnd = Math.max(lineStart, input.lineEndNumber ?? lineStart);
  let detectedTarget: ReviewTarget | undefined;
  for (let line = lineStart; line <= lineEnd; line += 1) {
    const currentTarget = classifyLineTarget(input.diffMap, input.side, line) ?? "unchanged";
    if (!detectedTarget) {
      detectedTarget = currentTarget;
      continue;
    }
    if (detectedTarget !== currentTarget) {
      return "file";
    }
  }
  return detectedTarget ?? "file";
}
