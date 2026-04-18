import type { ReviewTarget } from "../types";
import {
  buildCodeFenceLines,
  finalizeFormatterOutput,
  formatLineRange,
  NO_LONGER_EXISTS_IN_CURRENT_CODE_LABEL,
  formatOutputPath,
} from "./formatterUtils";

export interface OnetimeCopyBlockInput {
  readonly path: string;
  readonly target: ReviewTarget;
  readonly noLongerExistsInCurrentCode?: boolean;
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
  const lines: string[] = [];
  lines.push(formatOutputPath(input.path));
  const lineSummary = buildOnetimeLineSummary(input);
  if (lineSummary) {
    lines.push(lineSummary);
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

function resolveLineStart(input: OnetimeCopyBlockInput): number | undefined {
  return input.anchorLineStart ?? input.modifiedLine ?? input.originalLine;
}

function resolveLineEnd(input: OnetimeCopyBlockInput): number | undefined {
  return input.anchorLineEnd ?? input.modifiedLineEnd ?? input.originalLineEnd;
}

function buildOnetimeLineSummary(input: OnetimeCopyBlockInput): string | undefined {
  if (input.target === "file") {
    return undefined;
  }
  const lineStart = resolveLineStart(input);
  if (lineStart === undefined) {
    return undefined;
  }
  const lineEnd = resolveLineEnd(input) ?? lineStart;
  const lineRange = formatLineRange(lineStart, lineEnd);
  const isNoLongerExistingLine =
    input.noLongerExistsInCurrentCode ?? (input.target === "deleted" || input.target === "modified-before");
  if (isNoLongerExistingLine) {
    return `- Line: ${lineRange} (${NO_LONGER_EXISTS_IN_CURRENT_CODE_LABEL})`;
  }
  return `- Line: ${lineRange}`;
}
