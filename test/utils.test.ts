import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", () => {
  class Range {
    start: { line: number; character: number };
    end: { line: number; character: number };

    constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number) {
      this.start = { line: startLine, character: startCharacter };
      this.end = { line: endLine, character: endCharacter };
    }
  }

  return {
    Range,
  };
});

import {
  buildWorkspaceSessionPath,
  expandLineRangeWithContext,
  lineSetToRanges,
} from "../src/utils";

describe("lineSetToRanges", () => {
  it("連続行を1つの範囲にまとめること", () => {
    const ranges = lineSetToRanges(new Set([2, 3, 4]));
    expect(ranges).toHaveLength(1);
    expect(ranges[0]?.start.line).toBe(1);
    expect(ranges[0]?.end.line).toBe(3);
  });

  it("非連続行は分割された範囲として返すこと", () => {
    const ranges = lineSetToRanges(new Set([1, 3, 4, 7]));
    expect(ranges).toHaveLength(3);
    expect(ranges[0]?.start.line).toBe(0);
    expect(ranges[0]?.end.line).toBe(0);
    expect(ranges[1]?.start.line).toBe(2);
    expect(ranges[1]?.end.line).toBe(3);
    expect(ranges[2]?.start.line).toBe(6);
    expect(ranges[2]?.end.line).toBe(6);
  });
});

describe("expandLineRangeWithContext", () => {
  it("1行選択時は前後1行を含む3行範囲を返すこと", () => {
    const result = expandLineRangeWithContext(100, 11, 11);

    expect(result.startIndex).toBe(9);
    expect(result.endIndex).toBe(11);
  });

  it("先頭行選択時は下方向のみ拡張して範囲を返すこと", () => {
    const result = expandLineRangeWithContext(10, 1, 1);

    expect(result.startIndex).toBe(0);
    expect(result.endIndex).toBe(1);
  });

  it("末尾行選択時は上方向のみ拡張して範囲を返すこと", () => {
    const result = expandLineRangeWithContext(10, 10, 10);

    expect(result.startIndex).toBe(8);
    expect(result.endIndex).toBe(9);
  });
});

describe("buildWorkspaceSessionPath", () => {
  it("workspace名と相対パスから表示用パスを組み立てること", () => {
    expect(buildWorkspaceSessionPath("workspace-a", "src/app.ts")).toBe("workspace-a/src/app.ts");
  });

  it("バックスラッシュと ./ を正規化すること", () => {
    expect(buildWorkspaceSessionPath(".\\workspace", ".\\src\\app.ts")).toBe(
      "workspace/src/app.ts",
    );
  });
});
