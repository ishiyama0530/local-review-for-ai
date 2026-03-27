import { describe, expect, it } from "vitest";

import { ReviewSessionService } from "../src/review/reviewSessionService";

function createService(): ReviewSessionService {
  return new ReviewSessionService();
}

describe("reviewSessionService", () => {
  it("最初のコメント前にセッションを開始できること", () => {
    const service = createService();
    const session = service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    expect(session.state).toBe("active-clean");
    expect(service.getState()).toBe("active-clean");
  });

  it("コメント追加時に sequence が単調増加すること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });

    const first = service.addComment({
      id: "c1",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 1,
      code: "a();",
      language: "ts",
      comment: "first",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 1,
      threadRangeEndLine: 1,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });
    const second = service.addComment({
      id: "c2",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 2,
      code: "b();",
      language: "ts",
      comment: "second",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 2,
      threadRangeEndLine: 2,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:01.000Z",
    });

    expect(first.sequence).toBe(1);
    expect(second.sequence).toBe(2);
  });

  it("unchanged コメントのアンカー情報を保持できること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });

    const comment = service.addComment({
      id: "c-unchanged",
      path: "workspace/src/a.ts",
      target: "unchanged",
      code: "stable();",
      language: "ts",
      comment: "unchanged",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 3,
      threadRangeEndLine: 4,
      anchorSide: "modified",
      anchorLineStart: 3,
      anchorLineEnd: 4,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });

    expect(comment.target).toBe("unchanged");
    expect(comment.anchorSide).toBe("modified");
    expect(comment.anchorLineStart).toBe(3);
    expect(comment.anchorLineEnd).toBe(4);
  });

  it("preview open/close で state が戻ること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    service.openPreview();
    expect(service.getState()).toBe("preview-open");
    service.closePreview();
    expect(service.getState()).toBe("active-clean");
  });

  it("finish 後に clear すると idle に戻ること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    service.finish();
    expect(service.getState()).toBe("finished");
    service.clear();
    expect(service.getState()).toBe("idle");
  });

  it("コメント本文を編集すると updatedAt が更新されること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    const created = service.addComment({
      id: "c1",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 1,
      code: "a();",
      language: "ts",
      comment: "before",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 1,
      threadRangeEndLine: 1,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });

    const updated = service.updateCommentText("c1", "after", "2026-03-26T00:00:10.000Z");
    expect(updated?.comment).toBe("after");
    expect(updated?.updatedAt).toBe("2026-03-26T00:00:10.000Z");
    expect(created.updatedAt).toBe("2026-03-26T00:00:10.000Z");
  });

  it("コメントを削除すると件数が減ること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    service.addComment({
      id: "c1",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 1,
      code: "a();",
      language: "ts",
      comment: "first",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 1,
      threadRangeEndLine: 1,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });
    service.addComment({
      id: "c2",
      path: "src/b.ts",
      target: "added",
      modifiedLine: 2,
      code: "b();",
      language: "ts",
      comment: "second",
      threadUri: "file:///repo/src/b.ts",
      threadRangeStartLine: 2,
      threadRangeEndLine: 2,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });

    const deleted = service.deleteComment("c1");
    expect(deleted).toBe(true);
    expect(service.getSession()?.comments.length).toBe(1);
    expect(service.getSession()?.comments[0]?.id).toBe("c2");
  });

  it("セッション未開始でコメント追加すると例外が発生すること", () => {
    const service = createService();
    expect(() =>
      service.addComment({
        id: "c1",
        path: "src/a.ts",
        target: "added",
        modifiedLine: 1,
        code: "a();",
        language: "ts",
        comment: "first",
        threadUri: "file:///repo/src/a.ts",
        threadRangeStartLine: 1,
        threadRangeEndLine: 1,
        isFileLevel: false,
        isFallbackThread: false,
        createdAt: "2026-03-26T00:00:00.000Z",
      }),
    ).toThrow("Review session has not started");
  });

  it("セッション未開始での updateCommentText は undefined を返すこと", () => {
    const service = createService();
    expect(service.updateCommentText("c1", "text", "2026-03-26T00:00:00.000Z")).toBeUndefined();
  });

  it("存在しない commentId での updateCommentText は undefined を返すこと", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    expect(
      service.updateCommentText("nonexistent", "text", "2026-03-26T00:00:00.000Z"),
    ).toBeUndefined();
  });

  it("セッション未開始での deleteComment は false を返すこと", () => {
    const service = createService();
    expect(service.deleteComment("c1")).toBe(false);
  });

  it("createSessionIfNeeded の二重呼び出しで既存セッションが返ること", () => {
    const service = createService();
    const input = {
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    };
    const first = service.createSessionIfNeeded(input);
    const second = service.createSessionIfNeeded(input);
    expect(first).toBe(second);
  });

  it("isTrackedPath がコメントのあるパスに対して true を返すこと", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    service.addComment({
      id: "c1",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 1,
      code: "a();",
      language: "ts",
      comment: "first",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 1,
      threadRangeEndLine: 1,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });
    expect(service.isTrackedPath("src/a.ts")).toBe(true);
    expect(service.isTrackedPath("src/b.ts")).toBe(false);
  });

  it("セッション未開始で isTrackedPath は false を返すこと", () => {
    const service = createService();
    expect(service.isTrackedPath("src/a.ts")).toBe(false);
  });

  it("コメント削除後に isTrackedPath が false になること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    service.addComment({
      id: "c1",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 1,
      code: "a();",
      language: "ts",
      comment: "first",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 1,
      threadRangeEndLine: 1,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });
    expect(service.isTrackedPath("src/a.ts")).toBe(true);
    service.deleteComment("c1");
    expect(service.isTrackedPath("src/a.ts")).toBe(false);
  });

  it("restoreSession でセッション状態を復元できること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    const snapshot = service.getSession()!;

    const service2 = createService();
    service2.restoreSession(snapshot);
    expect(service2.getState()).toBe("active-clean");
    expect(service2.getSession()?.repoRoot).toBe("/repo");
  });

  it("コメント対象の相対パス一覧を取得できること", () => {
    const service = createService();
    service.createSessionIfNeeded({
      repoRoot: "/repo",
      repoName: "sample-repo",
      branchNameAtStart: "feature/a",
      headCommitAtStart: "abc1234",
      startedAt: "2026-03-26T00:00:00.000Z",
    });
    service.addComment({
      id: "c1",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 1,
      code: "a();",
      language: "ts",
      comment: "first",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 1,
      threadRangeEndLine: 1,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });
    service.addComment({
      id: "c2",
      path: "src/a.ts",
      target: "added",
      modifiedLine: 2,
      code: "b();",
      language: "ts",
      comment: "second",
      threadUri: "file:///repo/src/a.ts",
      threadRangeStartLine: 2,
      threadRangeEndLine: 2,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });
    service.addComment({
      id: "c3",
      path: "src/b.ts",
      target: "added",
      modifiedLine: 3,
      code: "c();",
      language: "ts",
      comment: "third",
      threadUri: "file:///repo/src/b.ts",
      threadRangeStartLine: 3,
      threadRangeEndLine: 3,
      isFileLevel: false,
      isFallbackThread: false,
      createdAt: "2026-03-26T00:00:00.000Z",
    });

    expect(service.getTrackedPaths()).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
