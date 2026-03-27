import { describe, expect, it } from "vitest";

import type { DiffMap } from "../src/git/diffMapBuilder";
import { classifyCommentTarget } from "../src/review/commentTargetClassifier";

const diffMap: DiffMap = {
  path: "src/a.ts",
  isBinary: false,
  addedLines: new Set([5, 6]),
  deletedLines: new Set([2]),
  modifiedBeforeLines: new Set([8]),
  modifiedAfterLines: new Set([9, 10]),
};

describe("commentTargetClassifier", () => {
  it("追加行は added と判定できること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "modified",
      lineNumber: 5,
      isFileLevel: false,
    });
    expect(result).toBe("added");
  });

  it("削除行は deleted と判定できること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "original",
      lineNumber: 2,
      isFileLevel: false,
    });
    expect(result).toBe("deleted");
  });

  it("変更前行は modified-before と判定できること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "original",
      lineNumber: 8,
      isFileLevel: false,
    });
    expect(result).toBe("modified-before");
  });

  it("変更後行は modified-after と判定できること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "modified",
      lineNumber: 9,
      isFileLevel: false,
    });
    expect(result).toBe("modified-after");
  });

  it("file-level comment は file と判定できること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "modified",
      lineNumber: undefined,
      isFileLevel: true,
    });
    expect(result).toBe("file");
  });

  it("diff対象外の行番号は unchanged と判定すること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "modified",
      lineNumber: 999,
      isFileLevel: false,
    });
    expect(result).toBe("unchanged");
  });

  it("同一種別の複数行範囲はその種別で判定できること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "modified",
      lineNumber: 5,
      lineEndNumber: 6,
      isFileLevel: false,
    });
    expect(result).toBe("added");
  });

  it("複数行範囲に異なる種別が混在する場合は file にフォールバックすること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "modified",
      lineNumber: 6,
      lineEndNumber: 9,
      isFileLevel: false,
    });
    expect(result).toBe("file");
  });

  it("複数行範囲に差分対象外の行を含み、種別が混在する場合は file にフォールバックすること", () => {
    const result = classifyCommentTarget({
      diffMap,
      side: "modified",
      lineNumber: 5,
      lineEndNumber: 7,
      isFileLevel: false,
    });
    expect(result).toBe("file");
  });

  it("diffMap が未解決でも行コメントは unchanged と判定すること", () => {
    const result = classifyCommentTarget({
      diffMap: undefined,
      side: "modified",
      lineNumber: 12,
      isFileLevel: false,
    });
    expect(result).toBe("unchanged");
  });
});
