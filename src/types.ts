export type ReviewTarget =
  | "added"
  | "deleted"
  | "modified-before"
  | "modified-after"
  | "unchanged"
  | "file";

export type ReviewSessionState = "idle" | "active-clean" | "preview-open" | "finished";

export interface ReviewComment {
  id: string;
  sequence: number;
  path: string;
  target: ReviewTarget;
  originalLine?: number;
  modifiedLine?: number;
  code: string;
  language: string;
  comment: string;
  createdAt: string;
  updatedAt: string;
  threadUri: string;
  threadRangeStartLine?: number;
  threadRangeEndLine?: number;
  anchorSide?: "original" | "modified";
  anchorLineStart?: number;
  anchorLineEnd?: number;
  isFileLevel: boolean;
  isFallbackThread: boolean;
  isBinarySnippet?: boolean;
}

export interface ReviewSession {
  id: string;
  repoRoot: string;
  repoName: string;
  branchNameAtStart?: string;
  headCommitAtStart?: string;
  startedAt: string;
  state: ReviewSessionState;
  comments: ReviewComment[];
  nextSequence: number;
}

export interface PersistedSessionEnvelope {
  version: number;
  session: ReviewSession;
}
