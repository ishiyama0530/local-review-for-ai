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

    expect(markdown.startsWith("### AI Guide\n")).toBe(true);
    expect(markdown).toContain("- `Line Status`:");
    expect(markdown).toContain("- `Line`:");
    expect(markdown).toContain("- `Original Line`:");
    expect(markdown).toContain("- `Modified Line`:");
    expect(markdown).toContain("@xxx/hoge.ts");
    expect(markdown).toContain("- Line Status: Added");
    expect(markdown).toContain("- Modified Line: 5");
    expect(markdown).toContain("```typescript");
    expect(markdown).toContain("this.name = name;;;");
  });

  it("複数行範囲の Modified Line を x - y で出力すること", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "src/usecase.ts",
      target: "modified-after",
      modifiedLine: 10,
      modifiedLineEnd: 12,
      code: "line10();\nline11();\nline12();",
      language: "ts",
    });

    expect(markdown).toContain("- Line Status: Modified (Updated)");
    expect(markdown).toContain("- Modified Line: 10 - 12");
  });

  it("target=file のとき Line Status 行を出力しないこと", () => {
    const markdown = formatOnetimeCopyBlock({
      path: "README.md",
      target: "file",
      code: "# title",
      language: "md",
    });

    expect(markdown).toContain("@README.md");
    expect(markdown).not.toContain("- Line Status:");
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

    expect(markdown).toContain("- Line Status: Unchanged");
    expect(markdown).toContain("- Line: 3 - 5 (Updated)");
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
