import type { ReviewComment, ReviewSession, ReviewTarget } from "../types";
import {
  buildAiFieldGuideLines,
  buildCodeFenceLines,
  finalizeFormatterOutput,
  formatLineRange,
  formatOutputPath,
} from "./formatterUtils";

const TARGET_LABELS: Record<ReviewTarget, string> = {
  added: "Added",
  deleted: "Deleted",
  "modified-before": "Modified (Original)",
  "modified-after": "Modified (Updated)",
  unchanged: "Unchanged",
  file: "File",
};

export function mapReviewTargetLabel(target: ReviewTarget): string {
  return TARGET_LABELS[target];
}

export function formatReviewMarkdown(session: ReviewSession, _generatedAtUtc: string): string {
  const lines: string[] = [...buildAiFieldGuideLines(), ""];

  const orderedGroups = groupCommentsForOutput(sortCommentsForOutput(session.comments));
  for (const [groupIndex, group] of orderedGroups.entries()) {
    const leadComment = group.comments[0];
    lines.push(`## ${groupIndex + 1}. ${formatOutputPath(leadComment.path)}`);
    if (leadComment.target !== "file") {
      lines.push(`- Line Status: ${mapReviewTargetLabel(leadComment.target)}`);
    }
    if (leadComment.target === "unchanged") {
      const anchorStart = leadComment.anchorLineStart ?? leadComment.threadRangeStartLine;
      if (anchorStart !== undefined) {
        const anchorEnd =
          leadComment.anchorLineEnd ?? leadComment.threadRangeEndLine ?? anchorStart;
        const anchorSideLabel = leadComment.anchorSide === "original" ? "Original" : "Updated";
        lines.push(`- Line: ${formatLineRange(anchorStart, anchorEnd)} (${anchorSideLabel})`);
      }
    }
    if (leadComment.originalLine !== undefined) {
      lines.push(`- Original Line: ${leadComment.originalLine}`);
    }
    if (leadComment.modifiedLine !== undefined) {
      lines.push(
        `- Modified Line: ${formatLineRange(leadComment.modifiedLine, leadComment.threadRangeEndLine)}`,
      );
    }
    lines.push("");
    const codeFenceLines = buildCodeFenceLines(
      leadComment.code,
      leadComment.language,
      leadComment.isBinarySnippet,
    );
    if (codeFenceLines.length > 0) {
      lines.push(...codeFenceLines);
      lines.push("");
    }
    if (group.comments.length === 1) {
      lines.push(leadComment.comment);
      lines.push("");
      continue;
    }

    for (const [commentIndex, comment] of group.comments.entries()) {
      lines.push(`### ${groupIndex + 1}.${commentIndex + 1}.`);
      lines.push(comment.comment);
      lines.push("");
    }
    lines.push("");
  }

  return finalizeFormatterOutput(lines);
}

export function sortCommentsBySequence(comments: readonly ReviewComment[]): ReviewComment[] {
  return [...comments].sort((left, right) => left.sequence - right.sequence);
}

type NonEmptyReviewComments = [ReviewComment, ...ReviewComment[]];

interface OutputCommentGroup {
  comments: NonEmptyReviewComments;
}

function buildOutputGroupKey(comment: ReviewComment): string {
  const lineStart = getLineStart(comment) ?? 0;
  const lineEnd = getLineEnd(comment) ?? 0;
  return [
    comment.path,
    comment.target,
    `${lineStart}`,
    `${lineEnd}`,
    comment.language,
    comment.code,
  ].join("\u0000");
}

function groupCommentsForOutput(comments: readonly ReviewComment[]): OutputCommentGroup[] {
  const groupedComments = new Map<string, OutputCommentGroup>();
  for (const comment of comments) {
    const key = buildOutputGroupKey(comment);
    const group = groupedComments.get(key);
    if (group !== undefined) {
      group.comments.push(comment);
      continue;
    }
    groupedComments.set(key, { comments: [comment] });
  }
  return Array.from(groupedComments.values());
}

function getLineStart(comment: ReviewComment): number | undefined {
  return (
    comment.anchorLineStart ??
    comment.threadRangeStartLine ??
    comment.modifiedLine ??
    comment.originalLine
  );
}

function getLineEnd(comment: ReviewComment): number | undefined {
  return (
    comment.anchorLineEnd ??
    comment.threadRangeEndLine ??
    comment.modifiedLine ??
    comment.originalLine
  );
}

function isFileTarget(comment: ReviewComment): boolean {
  return comment.target === "file";
}

export function sortCommentsForOutput(comments: readonly ReviewComment[]): ReviewComment[] {
  return [...comments].sort((left, right) => {
    const byPath = left.path.localeCompare(right.path);
    if (byPath !== 0) {
      return byPath;
    }

    const leftIsFile = isFileTarget(left);
    const rightIsFile = isFileTarget(right);
    if (leftIsFile !== rightIsFile) {
      return leftIsFile ? -1 : 1;
    }

    const leftLineStart = getLineStart(left);
    const rightLineStart = getLineStart(right);
    if (leftLineStart !== rightLineStart) {
      if (leftLineStart === undefined) {
        return -1;
      }
      if (rightLineStart === undefined) {
        return 1;
      }
      return leftLineStart - rightLineStart;
    }

    const leftLineEnd = getLineEnd(left);
    const rightLineEnd = getLineEnd(right);
    if (leftLineEnd !== rightLineEnd) {
      if (leftLineEnd === undefined) {
        return -1;
      }
      if (rightLineEnd === undefined) {
        return 1;
      }
      return leftLineEnd - rightLineEnd;
    }

    return left.sequence - right.sequence;
  });
}
