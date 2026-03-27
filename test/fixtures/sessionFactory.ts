import type { ReviewComment, ReviewSession } from "../../src/types";

interface BuildCommentInput {
  readonly id: string;
  readonly sequence: number;
  readonly path: string;
  readonly target: ReviewComment["target"];
  readonly originalLine?: number;
  readonly modifiedLine?: number;
  readonly code: string;
  readonly language: string;
  readonly comment: string;
  readonly anchorSide?: "original" | "modified";
  readonly anchorLineStart?: number;
  readonly anchorLineEnd?: number;
  readonly isBinarySnippet?: boolean;
}

export function buildReviewComment(input: BuildCommentInput): ReviewComment {
  return {
    id: input.id,
    sequence: input.sequence,
    path: input.path,
    target: input.target,
    originalLine: input.originalLine,
    modifiedLine: input.modifiedLine,
    code: input.code,
    language: input.language,
    comment: input.comment,
    createdAt: "2026-03-26T00:00:00.000Z",
    updatedAt: "2026-03-26T00:00:00.000Z",
    threadUri: "file:///workspace/example.ts",
    threadRangeStartLine: input.modifiedLine ?? input.originalLine ?? 1,
    threadRangeEndLine: input.modifiedLine ?? input.originalLine ?? 1,
    anchorSide: input.anchorSide,
    anchorLineStart: input.anchorLineStart,
    anchorLineEnd: input.anchorLineEnd,
    isFileLevel: input.target === "file",
    isFallbackThread: false,
    isBinarySnippet: input.isBinarySnippet,
  };
}

export function buildReviewSession(comments: readonly ReviewComment[]): ReviewSession {
  return {
    id: "session-1",
    repoRoot: "/repo",
    repoName: "sample-repo",
    branchNameAtStart: "feature/auth-refactor",
    headCommitAtStart: "a1b2c3d4",
    startedAt: "2026-03-26T00:00:00.000Z",
    state: "active-clean",
    comments: [...comments],
    nextSequence: comments.length + 1,
  };
}
