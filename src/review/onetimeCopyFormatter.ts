import type { ReviewTarget } from "../types";
import {
  buildAiFieldGuideLines,
  buildCodeFenceLines,
  finalizeFormatterOutput,
  formatLineRange,
  formatOutputPath,
} from "./formatterUtils";
import { mapReviewTargetLabel } from "./markdownFormatter";

export interface OnetimeCopyBlockInput {
  readonly path: string;
  readonly target: ReviewTarget;
  readonly originalLine?: number;
  readonly originalLineEnd?: number;
  readonly modifiedLine?: number;
  readonly modifiedLineEnd?: number;
  readonly anchorSide?: "original" | "modified";
  readonly anchorLineStart?: number;
  readonly anchorLineEnd?: number;
  readonly code: string;
  readonly language: string;
  readonly isBinarySnippet?: boolean;
  readonly commentText?: string;
}

export function formatOnetimeCopyBlock(input: OnetimeCopyBlockInput): string {
  const lines: string[] = [...buildAiFieldGuideLines(), ""];
  lines.push(formatOutputPath(input.path));
  if (input.target !== "file") {
    lines.push(`- Line Status: ${mapReviewTargetLabel(input.target)}`);
  }
  if (input.target === "unchanged" && input.anchorLineStart !== undefined) {
    const anchorSideLabel = input.anchorSide === "original" ? "Original" : "Updated";
    lines.push(
      `- Line: ${formatLineRange(input.anchorLineStart, input.anchorLineEnd)} (${anchorSideLabel})`,
    );
  }
  if (input.originalLine !== undefined) {
    lines.push(`- Original Line: ${formatLineRange(input.originalLine, input.originalLineEnd)}`);
  }
  if (input.modifiedLine !== undefined) {
    lines.push(`- Modified Line: ${formatLineRange(input.modifiedLine, input.modifiedLineEnd)}`);
  }
  lines.push("");
  const codeLines = buildCodeFenceLines(input.code, input.language, input.isBinarySnippet);
  if (codeLines.length > 0) {
    lines.push(...codeLines);
  }
  const commentText = input.commentText?.trim();
  if (commentText && commentText.length > 0) {
    lines.push("");
    lines.push(commentText);
  }
  return finalizeFormatterOutput(lines);
}
