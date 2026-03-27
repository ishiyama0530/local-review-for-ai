import * as vscode from "vscode";

import type { ReviewComment } from "../types";

function buildThreadKey(uri: vscode.Uri, range: vscode.Range | undefined): string {
  if (!range) {
    return `${uri.toString()}#file`;
  }
  return `${uri.toString()}#${range.start.line}:${range.end.line}`;
}

function buildRangeFromReviewComment(reviewComment: ReviewComment): vscode.Range | undefined {
  if (reviewComment.isFileLevel) {
    return undefined;
  }
  if (reviewComment.threadRangeStartLine === undefined) {
    return undefined;
  }
  const start = Math.max(0, reviewComment.threadRangeStartLine - 1);
  const end = Math.max(
    start,
    (reviewComment.threadRangeEndLine ?? reviewComment.threadRangeStartLine) - 1,
  );
  return new vscode.Range(start, 0, end, 0);
}

export class LocalReviewComment implements vscode.Comment {
  readonly reviewCommentId: string;
  body: string | vscode.MarkdownString;
  mode: vscode.CommentMode;
  author: vscode.CommentAuthorInformation;
  contextValue?: string;
  savedBody: string | vscode.MarkdownString;
  parent?: vscode.CommentThread;
  label?: string;
  timestamp?: Date;

  constructor(
    reviewCommentId: string,
    body: string,
    mode: vscode.CommentMode,
    authorName: string,
    parent?: vscode.CommentThread,
  ) {
    this.reviewCommentId = reviewCommentId;
    this.body = body;
    this.mode = mode;
    this.author = { name: authorName };
    this.contextValue = "localReviewForAi.comment";
    this.savedBody = body;
    this.parent = parent;
  }
}

export interface CreateThreadCommentInput {
  readonly reviewCommentId: string;
  readonly threadUri: vscode.Uri;
  readonly threadRange: vscode.Range | undefined;
  readonly commentBody: string;
  readonly authorName: string;
  readonly existingThread?: vscode.CommentThread;
}

export interface RestoreThreadCommentResult {
  readonly localComment: LocalReviewComment;
  readonly usedFallback: boolean;
}

function isLocalReviewComment(value: unknown): value is LocalReviewComment {
  return (
    typeof value === "object" &&
    value !== null &&
    "reviewCommentId" in value &&
    typeof (value as LocalReviewComment).reviewCommentId === "string"
  );
}

export class CommentThreadRegistry implements vscode.Disposable {
  private readonly threadByKey = new Map<string, vscode.CommentThread>();
  private readonly threadByCommentId = new Map<string, vscode.CommentThread>();
  private readonly commentByCommentId = new Map<string, LocalReviewComment>();

  constructor(private readonly commentController: vscode.CommentController) {}

  createOrAppendComment(input: CreateThreadCommentInput): LocalReviewComment {
    const key = buildThreadKey(input.threadUri, input.threadRange);
    const thread = this.getOrCreateThread(
      input.threadUri,
      input.threadRange,
      key,
      input.existingThread,
    );
    const localComment = new LocalReviewComment(
      input.reviewCommentId,
      input.commentBody,
      vscode.CommentMode.Preview,
      input.authorName,
      thread,
    );
    thread.comments = [...thread.comments, localComment];
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.threadByCommentId.set(input.reviewCommentId, thread);
    this.commentByCommentId.set(input.reviewCommentId, localComment);
    return localComment;
  }

  restoreComment(
    reviewComment: ReviewComment,
    fallbackUri: vscode.Uri,
    preferredUri?: vscode.Uri,
  ): RestoreThreadCommentResult {
    let threadUri = fallbackUri;
    let usedFallback = false;
    if (preferredUri) {
      threadUri = preferredUri;
    } else {
      try {
        threadUri = vscode.Uri.parse(reviewComment.threadUri);
      } catch {
        usedFallback = true;
      }
    }
    const threadRange = buildRangeFromReviewComment(reviewComment);
    const localComment = this.createOrAppendComment({
      reviewCommentId: reviewComment.id,
      threadUri,
      threadRange,
      commentBody: reviewComment.comment,
      authorName: "Reviewer",
    });
    return { localComment, usedFallback };
  }

  markEditing(reviewCommentId: string): void {
    this.withComment(reviewCommentId, (comment) => {
      comment.mode = vscode.CommentMode.Editing;
    });
  }

  saveCommentBody(reviewCommentId: string, commentBody: string): void {
    this.withComment(reviewCommentId, (comment) => {
      comment.body = commentBody;
      comment.savedBody = commentBody;
      comment.mode = vscode.CommentMode.Preview;
    });
  }

  cancelCommentEdit(reviewCommentId: string): void {
    this.withComment(reviewCommentId, (comment) => {
      comment.body = comment.savedBody;
      comment.mode = vscode.CommentMode.Preview;
    });
  }

  deleteComment(reviewCommentId: string): boolean {
    const thread = this.threadByCommentId.get(reviewCommentId);
    if (!thread) {
      return false;
    }
    const remainingComments = thread.comments.filter((comment) => {
      if (!isLocalReviewComment(comment)) {
        return true;
      }
      return comment.reviewCommentId !== reviewCommentId;
    });
    thread.comments = remainingComments;
    this.threadByCommentId.delete(reviewCommentId);
    this.commentByCommentId.delete(reviewCommentId);
    if (remainingComments.length === 0) {
      this.deleteThread(thread);
    }
    return true;
  }

  getReviewCommentIdFromCommandTarget(target: unknown): string | undefined {
    if (!target || typeof target !== "object") {
      return undefined;
    }
    if (isLocalReviewComment(target)) {
      return target.reviewCommentId;
    }
    if ("comments" in target && Array.isArray((target as { comments?: unknown }).comments)) {
      const comments = (target as { comments: unknown[] }).comments;
      for (const comment of comments) {
        if (isLocalReviewComment(comment)) {
          return comment.reviewCommentId;
        }
      }
    }
    return undefined;
  }

  getCommentBody(reviewCommentId: string): string | undefined {
    const localComment = this.commentByCommentId.get(reviewCommentId);
    if (!localComment) {
      return undefined;
    }
    return typeof localComment.body === "string" ? localComment.body : localComment.body.value;
  }

  disposeAll(): void {
    const uniqueThreads = new Set(this.threadByKey.values());
    for (const thread of uniqueThreads) {
      thread.dispose();
    }
    this.threadByKey.clear();
    this.threadByCommentId.clear();
    this.commentByCommentId.clear();
  }

  dispose(): void {
    this.disposeAll();
  }

  private withComment(
    reviewCommentId: string,
    mutate: (comment: LocalReviewComment) => void,
  ): void {
    const localComment = this.commentByCommentId.get(reviewCommentId);
    if (!localComment) {
      return;
    }
    mutate(localComment);
    const parentThread = this.threadByCommentId.get(reviewCommentId);
    if (parentThread) {
      parentThread.comments = [...parentThread.comments];
    }
  }

  private getOrCreateThread(
    uri: vscode.Uri,
    range: vscode.Range | undefined,
    key: string,
    existingThread?: vscode.CommentThread,
  ): vscode.CommentThread {
    const existing = this.threadByKey.get(key);
    if (existing) {
      return existing;
    }
    const thread =
      existingThread ??
      this.commentController.createCommentThread(uri, range ?? new vscode.Range(0, 0, 0, 0), []);
    thread.range = range;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    thread.contextValue = "localReviewForAi.thread";
    this.threadByKey.set(key, thread);
    return thread;
  }

  private deleteThread(thread: vscode.CommentThread): void {
    const keyToDelete = Array.from(this.threadByKey.entries()).find(
      ([, value]) => value === thread,
    )?.[0];
    if (keyToDelete) {
      this.threadByKey.delete(keyToDelete);
    }
    for (const [commentId, candidateThread] of this.threadByCommentId.entries()) {
      if (candidateThread === thread) {
        this.threadByCommentId.delete(commentId);
        this.commentByCommentId.delete(commentId);
      }
    }
    thread.dispose();
  }
}
