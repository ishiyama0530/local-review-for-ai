import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Range {
    readonly start: { line: number; character: number };
    readonly end: { line: number; character: number };

    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }

  return {
    CommentMode: {
      Preview: 0,
      Editing: 1,
    },
    CommentThreadCollapsibleState: {
      Collapsed: 0,
      Expanded: 1,
    },
    Range,
    Uri: {
      parse: (value: string) => ({ toString: () => value }),
    },
  };
});

import * as vscode from "vscode";

import { CommentThreadRegistry } from "../src/review/commentThreadRegistry";

type FakeThread = {
  comments: unknown[];
  range: unknown;
  collapsibleState: number;
  contextValue?: string;
  dispose: () => void;
};

function createFakeCommentController(createdThreads: FakeThread[]) {
  return {
    createCommentThread: () => {
      const thread: FakeThread = {
        comments: [],
        range: undefined,
        collapsibleState: vscode.CommentThreadCollapsibleState.Collapsed,
        contextValue: undefined,
        dispose: () => undefined,
      };
      createdThreads.push(thread);
      return thread;
    },
  } as unknown as vscode.CommentController;
}

describe("commentThreadRegistry", () => {
  let createdThreads: FakeThread[];
  let registry: CommentThreadRegistry;

  beforeEach(() => {
    createdThreads = [];
    registry = new CommentThreadRegistry(createFakeCommentController(createdThreads));
  });

  it("コメント追加後のスレッドは展開状態を維持すること", () => {
    const threadUri = {
      toString: () => "file:///tmp/sample.ts",
    } as unknown as vscode.Uri;
    const threadRange = new vscode.Range(10, 0, 10, 0);

    registry.createOrAppendComment({
      reviewCommentId: "comment-1",
      threadUri,
      threadRange,
      commentBody: "first",
      authorName: "Reviewer",
    });

    expect(createdThreads).toHaveLength(1);
    expect(createdThreads[0]?.collapsibleState).toBe(vscode.CommentThreadCollapsibleState.Expanded);
  });
});
