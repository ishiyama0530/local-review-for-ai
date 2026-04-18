import { describe, expect, it } from "vitest";

import { formatOnetimeCopyBlock } from "../src/review/onetimeCopyFormatter";

describe("onetimeCopyFormatter", () => {
  it("単一行 Added を指定フォーマットで出力すること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "xxx/hoge.ts",
      target: "added",
      modifiedLine: 5,
      code: "    constructor(name: string) {\n        this.name = name;;;\n    }",
      language: "typescript",
    });

    expect(markdown.startsWith("@xxx/hoge.ts\n")).toBe(true);
    expect(markdown).not.toContain("### AI Guide");
    expect(markdown).toContain("@xxx/hoge.ts");
    expect(markdown).toContain("- Line: 5");
    expect(markdown).toContain("```typescript");
    expect(markdown).toContain("this.name = name;;;");
  });

  it("複数行範囲の Line を x - y で出力すること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/usecase.ts",
      target: "modified-after",
      modifiedLine: 10,
      modifiedLineEnd: 12,
      code: "line10();\nline11();\nline12();",
      language: "ts",
    });

    expect(markdown).toContain("- Line: 10 - 12");
  });

  it("target=file のとき Line 行を出力しないこと", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "README.md",
      target: "file",
      code: "# title",
      language: "md",
    });

    expect(markdown).toContain("@README.md");
    expect(markdown).not.toContain("- Line:");
    expect(markdown).toContain("```md");
  });

  it("target=unchanged のときアンカー行情報を出力すること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/sample.ts",
      target: "unchanged",
      anchorSide: "modified",
      anchorLineStart: 3,
      anchorLineEnd: 5,
      code: "line3();\nline4();\nline5();",
      language: "ts",
    });

    expect(markdown).toContain("- Line: 3 - 5");
  });

  it("target=unchanged で anchorSide=original のとき括弧ラベルを付けないこと", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/sample.ts",
      target: "unchanged",
      anchorSide: "original",
      anchorLineStart: 7,
      anchorLineEnd: 9,
      code: "line7();\nline8();\nline9();",
      language: "ts",
    });

    expect(markdown).toContain("- Line: 7 - 9");
    expect(markdown).not.toContain("- Line: 7 - 9 (Missing/Not Fully in Current Code)");
  });

  it("target=deleted のとき no longer exists ラベルを付けること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/sample.ts",
      target: "deleted",
      originalLine: 11,
      originalLineEnd: 12,
      code: "old1();\nold2();",
      language: "ts",
    });

    expect(markdown).toContain("- Line: 11 - 12 (Missing/Not Fully in Current Code)");
  });

  it("target=unchanged でも noLongerExistsInCurrentCode=true のとき no longer exists ラベルを付けること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/sample.ts",
      target: "unchanged",
      noLongerExistsInCurrentCode: true,
      anchorLineStart: 15,
      anchorLineEnd: 15,
      code: "legacy();",
      language: "ts",
    });

    expect(markdown).toContain("- Line: 15 (Missing/Not Fully in Current Code)");
  });

  it("target=mixed のとき Line を追加ラベルなしで出力すること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/sample.ts",
      target: "mixed",
      anchorLineStart: 10,
      anchorLineEnd: 12,
      code: "line10();\nline11();\nline12();",
      language: "ts",
    });

    expect(markdown).toContain("- Line: 10 - 12");
  });

  it("commentText がある場合はコードブロックの後ろに含めること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/hoge.ts",
      target: "added",
      modifiedLine: 8,
      code: "const value = 1;",
      language: "ts",
      commentText: "ここを確認して",
    });

    expect(markdown).toContain("```ts");
    expect(markdown).toContain("const value = 1;");
    expect(markdown).toContain("ここを確認して");
    expect(markdown).not.toContain("Comment:");
  });
});
