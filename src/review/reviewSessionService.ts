import type { ReviewComment, ReviewSession, ReviewSessionState } from "../types";

const VALID_TRANSITIONS: Record<ReviewSessionState, readonly ReviewSessionState[]> = {
  idle: ["active-clean"],
  "active-clean": ["preview-open", "finished"],
  "preview-open": ["active-clean", "finished"],
  finished: ["idle"],
};

function canTransition(from: ReviewSessionState, to: ReviewSessionState): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export interface CreateSessionInput {
  readonly repoRoot: string;
  readonly repoName: string;
  readonly branchNameAtStart?: string;
  readonly headCommitAtStart?: string;
  readonly startedAt: string;
}

export interface CreateCommentInput {
  readonly id: string;
  readonly path: string;
  readonly target: ReviewComment["target"];
  readonly originalLine?: number;
  readonly modifiedLine?: number;
  readonly code: string;
  readonly language: string;
  readonly comment: string;
  readonly threadUri: string;
  readonly threadRangeStartLine?: number;
  readonly threadRangeEndLine?: number;
  readonly anchorSide?: "original" | "modified";
  readonly anchorLineStart?: number;
  readonly anchorLineEnd?: number;
  readonly isFileLevel: boolean;
  readonly isFallbackThread: boolean;
  readonly isBinarySnippet?: boolean;
  readonly createdAt: string;
}

export class ReviewSessionService {
  private session?: ReviewSession;

  createSessionIfNeeded(input: CreateSessionInput): ReviewSession {
    if (this.session) {
      return this.session;
    }
    this.session = {
      id: `session-${input.startedAt}`,
      repoRoot: input.repoRoot,
      repoName: input.repoName,
      branchNameAtStart: input.branchNameAtStart,
      headCommitAtStart: input.headCommitAtStart,
      startedAt: input.startedAt,
      state: "active-clean",
      comments: [],
      nextSequence: 1,
    };
    return this.session;
  }

  getSession(): ReviewSession | undefined {
    return this.session;
  }

  restoreSession(session: ReviewSession): void {
    this.session = {
      ...session,
      comments: [...session.comments],
    };
  }

  getState(): ReviewSessionState {
    return this.session?.state ?? "idle";
  }

  addComment(input: CreateCommentInput): ReviewComment {
    if (!this.session) {
      throw new Error("Review session has not started");
    }
    const comment: ReviewComment = {
      id: input.id,
      sequence: this.session.nextSequence,
      path: input.path,
      target: input.target,
      originalLine: input.originalLine,
      modifiedLine: input.modifiedLine,
      code: input.code,
      language: input.language,
      comment: input.comment,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      threadUri: input.threadUri,
      threadRangeStartLine: input.threadRangeStartLine,
      threadRangeEndLine: input.threadRangeEndLine,
      anchorSide: input.anchorSide,
      anchorLineStart: input.anchorLineStart,
      anchorLineEnd: input.anchorLineEnd,
      isFileLevel: input.isFileLevel,
      isFallbackThread: input.isFallbackThread,
      isBinarySnippet: input.isBinarySnippet,
    };
    this.session.comments.push(comment);
    this.session.nextSequence += 1;
    return comment;
  }

  updateCommentText(
    commentId: string,
    commentBody: string,
    updatedAt: string,
  ): ReviewComment | undefined {
    if (!this.session) {
      return undefined;
    }
    const comment = this.session.comments.find((reviewComment) => reviewComment.id === commentId);
    if (!comment) {
      return undefined;
    }
    comment.comment = commentBody;
    comment.updatedAt = updatedAt;
    return comment;
  }

  deleteComment(commentId: string): boolean {
    if (!this.session) {
      return false;
    }
    const beforeLength = this.session.comments.length;
    this.session.comments = this.session.comments.filter(
      (reviewComment) => reviewComment.id !== commentId,
    );
    return this.session.comments.length !== beforeLength;
  }

  getTrackedPaths(): string[] {
    if (!this.session) {
      return [];
    }
    const trackedPaths = new Set<string>();
    for (const comment of this.session.comments) {
      trackedPaths.add(comment.path);
    }
    return Array.from(trackedPaths).sort();
  }

  openPreview(): void {
    if (!this.session) {
      return;
    }
    if (!canTransition(this.session.state, "preview-open")) {
      return;
    }
    this.session.state = "preview-open";
  }

  closePreview(): void {
    if (!this.session) {
      return;
    }
    const target = "active-clean";
    if (!canTransition(this.session.state, target)) {
      return;
    }
    this.session.state = target;
  }

  finish(): void {
    if (!this.session) {
      return;
    }
    if (!canTransition(this.session.state, "finished")) {
      return;
    }
    this.session.state = "finished";
  }

  clear(): void {
    this.session = undefined;
  }

  isTrackedPath(relativePath: string): boolean {
    if (!this.session) {
      return false;
    }
    return this.session.comments.some((comment) => comment.path === relativePath);
  }
}
