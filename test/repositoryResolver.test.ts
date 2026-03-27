import { describe, expect, it } from "vitest";

import { normalizeRelativePath } from "../src/git/repositoryResolver";

describe("normalizeRelativePath", () => {
  it("バックスラッシュをスラッシュに変換すること", () => {
    expect(normalizeRelativePath("src\\a.ts")).toBe("src/a.ts");
  });

  it("先頭の ./ を除去すること", () => {
    expect(normalizeRelativePath("./src/a.ts")).toBe("src/a.ts");
  });

  it("先頭の .// を除去すること", () => {
    expect(normalizeRelativePath(".//src/a.ts")).toBe("src/a.ts");
  });

  it("既に正規化済みのパスはそのまま返すこと", () => {
    expect(normalizeRelativePath("src/a.ts")).toBe("src/a.ts");
  });

  it("空文字列は空文字列を返すこと", () => {
    expect(normalizeRelativePath("")).toBe("");
  });

  it("Windows形式の複合パスを正規化できること", () => {
    expect(normalizeRelativePath(".\\src\\components\\App.tsx")).toBe("src/components/App.tsx");
  });
});
