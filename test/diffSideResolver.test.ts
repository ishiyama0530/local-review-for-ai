import type * as vscode from "vscode";
import { describe, expect, it } from "vitest";

import { resolveDiffSide, resolveDiffSideFromChangeUri } from "../src/git/diffSideResolver";
import type { GitChange } from "../src/git/gitTypes";

function createUri(
  value: string,
  scheme: string,
  options?: { query?: string; fsPath?: string },
): vscode.Uri {
  return {
    scheme,
    query: options?.query ?? "",
    fsPath: options?.fsPath ?? "/repo/src/a.ts",
    toString: () => value,
  } as unknown as vscode.Uri;
}

function createChange(input: {
  originalUri: vscode.Uri;
  uri: vscode.Uri;
  renameUri?: vscode.Uri;
}): GitChange {
  return {
    originalUri: input.originalUri,
    uri: input.uri,
    renameUri: input.renameUri,
    status: 5 as never,
  };
}

describe("diffSideResolver", () => {
  it("originalUri に一致する URI は original と判定すること", () => {
    const originalUri = createUri("git:/repo/src/a.ts?ref=HEAD~", "git", { query: "ref=HEAD~" });
    const modifiedUri = createUri("git:/repo/src/a.ts?ref=WORKTREE", "git", {
      query: "ref=WORKTREE",
    });
    const change = createChange({
      originalUri,
      uri: modifiedUri,
    });

    expect(resolveDiffSideFromChangeUri(originalUri, change)).toBe("original");
  });

  it("change.uri に一致する git URI は modified と判定すること", () => {
    const originalUri = createUri("git:/repo/src/a.ts?ref=HEAD~", "git", { query: "ref=HEAD~" });
    const modifiedUri = createUri("git:/repo/src/a.ts?ref=WORKTREE", "git", {
      query: "ref=WORKTREE",
    });
    const change = createChange({
      originalUri,
      uri: modifiedUri,
    });

    expect(resolveDiffSideFromChangeUri(modifiedUri, change)).toBe("modified");
    expect(
      resolveDiffSide({
        uri: modifiedUri,
        change,
      }),
    ).toBe("modified");
  });

  it("renameUri に一致する URI は modified と判定すること", () => {
    const originalUri = createUri("git:/repo/src/a.ts?ref=HEAD~", "git", { query: "ref=HEAD~" });
    const modifiedUri = createUri("file:/repo/src/b.ts", "file", { fsPath: "/repo/src/b.ts" });
    const renameUri = createUri("file:/repo/src/a.ts", "file", { fsPath: "/repo/src/a.ts" });
    const change = createChange({
      originalUri,
      uri: modifiedUri,
      renameUri,
    });

    expect(resolveDiffSideFromChangeUri(renameUri, change)).toBe("modified");
  });

  it("変更 URI と一致しない場合は git=file original / file=modified のフォールバックを使うこと", () => {
    const unrelatedGitUri = createUri("git:/repo/src/other.ts?ref=HEAD", "git", {
      query: "ref=HEAD",
      fsPath: "/repo/src/other.ts",
    });
    const unrelatedFileUri = createUri("file:/repo/src/other.ts", "file", {
      fsPath: "/repo/src/other.ts",
    });
    const change = createChange({
      originalUri: createUri("git:/repo/src/a.ts?ref=HEAD~", "git", {
        query: "ref=HEAD~",
        fsPath: "/repo/src/a.ts",
      }),
      uri: createUri("git:/repo/src/a.ts?ref=WORKTREE", "git", {
        query: "ref=WORKTREE",
        fsPath: "/repo/src/a.ts",
      }),
    });

    expect(
      resolveDiffSide({
        uri: unrelatedGitUri,
        change,
      }),
    ).toBe("original");
    expect(
      resolveDiffSide({
        uri: unrelatedFileUri,
        change,
      }),
    ).toBe("modified");
  });

  it("modified 側が file URI の場合でも git URI の ref から modified を判定できること", () => {
    const currentUri = createUri("git:/repo/src/a.ts?ref=WORKTREE", "git", {
      query: "ref=WORKTREE",
      fsPath: "/repo/src/a.ts",
    });
    const change = createChange({
      originalUri: createUri("git:/repo/src/a.ts?ref=HEAD", "git", {
        query: "ref=HEAD",
        fsPath: "/repo/src/a.ts",
      }),
      uri: createUri("file:/repo/src/a.ts", "file", {
        fsPath: "/repo/src/a.ts",
      }),
    });

    expect(resolveDiffSideFromChangeUri(currentUri, change)).toBe("modified");
    expect(
      resolveDiffSide({
        uri: currentUri,
        change,
      }),
    ).toBe("modified");
  });

  it("git query が JSON 形式でも ref を解釈して side を判定できること", () => {
    const currentUri = createUri("git:/repo/src/a.ts?%7B%22ref%22%3A%22%7E%22%7D", "git", {
      query: "%7B%22ref%22%3A%22%7E%22%7D",
      fsPath: "/repo/src/a.ts",
    });

    expect(
      resolveDiffSide({
        uri: currentUri,
      }),
    ).toBe("modified");
  });
});
