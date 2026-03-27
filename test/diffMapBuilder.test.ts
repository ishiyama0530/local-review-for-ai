import { describe, expect, it } from "vitest";

import { buildDiffMap, classifyLineTarget, getCommentableLines } from "../src/git/diffMapBuilder";

describe("diffMapBuilder", () => {
  it("追加のみの差分を added として扱えること", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "",
      modifiedText: "line1\nline2",
      fileStatus: "untracked",
    });

    expect(diffMap.addedLines).toEqual(new Set([1, 2]));
    expect(classifyLineTarget(diffMap, "modified", 1)).toBe("added");
    expect(classifyLineTarget(diffMap, "modified", 2)).toBe("added");
  });

  it("削除のみの差分を deleted として扱えること", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "line1\nline2",
      modifiedText: "",
      fileStatus: "deleted",
    });

    expect(diffMap.deletedLines).toEqual(new Set([1, 2]));
    expect(classifyLineTarget(diffMap, "original", 1)).toBe("deleted");
    expect(classifyLineTarget(diffMap, "original", 2)).toBe("deleted");
  });

  it("単一ハンクの変更を before/after に分類できること", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "a\nb\nc",
      modifiedText: "a\nx\nc",
    });

    expect(diffMap.modifiedBeforeLines).toEqual(new Set([2]));
    expect(diffMap.modifiedAfterLines).toEqual(new Set([2]));
    expect(classifyLineTarget(diffMap, "original", 2)).toBe("modified-before");
    expect(classifyLineTarget(diffMap, "modified", 2)).toBe("modified-after");
  });

  it("複数ハンクの変更を同時に分類できること", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "a\nb\nc\nd\ne",
      modifiedText: "a\nx\nc\nd\ny",
    });

    expect(diffMap.modifiedBeforeLines).toEqual(new Set([2, 5]));
    expect(diffMap.modifiedAfterLines).toEqual(new Set([2, 5]));
  });

  it("whole-file delete を削除行として扱えること", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "a\nb\nc",
      modifiedText: "",
      fileStatus: "deleted",
    });

    expect(diffMap.deletedLines).toEqual(new Set([1, 2, 3]));
  });

  it("untracked file の全行を追加行として扱えること", () => {
    const diffMap = buildDiffMap({
      path: "src/new.ts",
      originalText: "",
      modifiedText: "a\nb\nc",
      fileStatus: "untracked",
    });

    expect(diffMap.addedLines).toEqual(new Set([1, 2, 3]));
  });

  it("バイナリファイルは全行セットが空でisBinaryがtrueになること", () => {
    const diffMap = buildDiffMap({
      path: "logo.png",
      originalText: "",
      modifiedText: "",
      fileStatus: "binary",
    });
    expect(diffMap.isBinary).toBe(true);
    expect(diffMap.addedLines.size).toBe(0);
    expect(diffMap.deletedLines.size).toBe(0);
    expect(diffMap.modifiedBeforeLines.size).toBe(0);
    expect(diffMap.modifiedAfterLines.size).toBe(0);
  });

  it("diff対象外の行にはundefinedを返すこと", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "a\nb\nc",
      modifiedText: "a\nx\nc",
    });
    expect(classifyLineTarget(diffMap, "original", 1)).toBeUndefined();
    expect(classifyLineTarget(diffMap, "modified", 1)).toBeUndefined();
  });
});

describe("getCommentableLines", () => {
  it("original側では削除行とmodified-before行を返すこと", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "a\nb\nc\nd",
      modifiedText: "a\nx\nc",
    });
    const lines = getCommentableLines(diffMap, "original");
    expect(lines).toContain(2);
    expect(lines).toContain(4);
    expect(lines).not.toContain(1);
    expect(lines).not.toContain(3);
  });

  it("modified側では追加行とmodified-after行を返すこと", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "a\nb\nc",
      modifiedText: "a\nx\nc\nd",
    });
    const lines = getCommentableLines(diffMap, "modified");
    expect(lines).toContain(2);
    expect(lines).toContain(4);
    expect(lines).not.toContain(1);
    expect(lines).not.toContain(3);
  });

  it("変更のないファイルでは空セットを返すこと", () => {
    const diffMap = buildDiffMap({
      path: "src/a.ts",
      originalText: "a\nb\nc",
      modifiedText: "a\nb\nc",
    });
    expect(getCommentableLines(diffMap, "original").size).toBe(0);
    expect(getCommentableLines(diffMap, "modified").size).toBe(0);
  });

  it("バイナリファイルでは空セットを返すこと", () => {
    const diffMap = buildDiffMap({
      path: "logo.png",
      originalText: "",
      modifiedText: "",
      fileStatus: "binary",
    });
    expect(getCommentableLines(diffMap, "original").size).toBe(0);
    expect(getCommentableLines(diffMap, "modified").size).toBe(0);
  });
});
