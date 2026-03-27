import { describe, expect, it } from "vitest";

import { formatReviewMarkdown } from "../src/review/markdownFormatter";
import { buildReviewComment, buildReviewSession } from "./fixtures/sessionFactory";

describe("markdownFormatter", () => {
  it("AI向けフィールド説明を先頭に出し、メタ情報ヘッダとタイトル行を出力しないこと", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "src/a.ts",
        target: "added",
        modifiedLine: 10,
        code: "const value = 1;",
        language: "ts",
        comment: "Looks good.",
      }),
    ]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    expect(markdown).not.toContain("# Code Review Comments");
    expect(markdown.startsWith("### AI Guide\n")).toBe(true);
    expect(markdown).toContain("- `Line Status`:");
    expect(markdown).toContain("- `Line`:");
    expect(markdown).toContain("- `Original Line`:");
    expect(markdown).toContain("- `Modified Line`:");
    expect(markdown).toContain("## 1. @src/a.ts");
    expect(markdown).not.toContain("> Review Target:");
    expect(markdown).not.toContain("> Repository:");
    expect(markdown).not.toContain("> Branch at Start:");
    expect(markdown).not.toContain("> HEAD at Start:");
    expect(markdown).not.toContain("> Status:");
    expect(markdown).not.toContain("> Stale Reasons:");
    expect(markdown).not.toContain("> Generated At:");
  });

  it("プレビュー状態でもメタ情報ヘッダを出力しないこと", () => {
    const session = buildReviewSession([]);
    session.state = "preview-open";
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    expect(markdown).not.toContain("> Status:");
  });

  it("ターゲット種別ごとにラベルと行番号を正しく出力できること", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "src/a.ts",
        target: "added",
        modifiedLine: 10,
        code: "const value = 1;",
        language: "ts",
        comment: "Added line comment.",
      }),
      buildReviewComment({
        id: "c2",
        sequence: 2,
        path: "src/a.ts",
        target: "deleted",
        originalLine: 11,
        code: "const legacy = 0;",
        language: "ts",
        comment: "Deleted line comment.",
      }),
      buildReviewComment({
        id: "c3",
        sequence: 3,
        path: "src/a.ts",
        target: "modified-before",
        originalLine: 12,
        code: "beforeValue();",
        language: "ts",
        comment: "Before comment.",
      }),
      buildReviewComment({
        id: "c4",
        sequence: 4,
        path: "src/a.ts",
        target: "modified-after",
        modifiedLine: 13,
        code: "afterValue();",
        language: "ts",
        comment: "After comment.",
      }),
      buildReviewComment({
        id: "c5",
        sequence: 5,
        path: "src/a.ts",
        target: "file",
        code: "",
        language: "",
        comment: "File comment.",
      }),
      buildReviewComment({
        id: "c6",
        sequence: 6,
        path: "src/a.ts",
        target: "unchanged",
        code: "const stable = 1;",
        language: "ts",
        comment: "Unchanged line comment.",
        anchorSide: "modified",
        anchorLineStart: 21,
        anchorLineEnd: 22,
      }),
    ]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    expect(markdown).toContain("- Line Status: Added");
    expect(markdown).toContain("- Line Status: Deleted");
    expect(markdown).toContain("- Line Status: Modified (Original)");
    expect(markdown).toContain("- Line Status: Modified (Updated)");
    expect(markdown).toContain("- Line Status: Unchanged");
    expect(markdown).toContain("- Line: 21 - 22 (Updated)");
    expect(markdown).not.toContain("- Line Status: File");
    expect(markdown).toContain("- Original Line: 11");
    expect(markdown).toContain("- Modified Line: 10");
    expect(markdown).toContain("```ts");
  });

  it("バイナリコメントはコードブロックではなく固定文言を出すこと", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "assets/logo.png",
        target: "file",
        code: "",
        language: "",
        comment: "Binary file review.",
        isBinarySnippet: true,
      }),
    ]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    expect(markdown).toContain("Code Snippet: Not Available (Binary File)");
    expect(markdown).not.toContain("```");
  });

  it("コードスニペットが空のコメントでは空のコードフェンスを出力しないこと", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "src/a.ts",
        target: "file",
        code: "",
        language: "",
        comment: "test",
      }),
    ]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    expect(markdown).not.toContain("- Line Status:");
    expect(markdown).toContain("\ntest\n");
    expect(markdown).not.toContain("Comment:");
    expect(markdown).not.toContain("```");
  });

  it("branch/HEAD が不明でもメタ情報ヘッダを表示しないこと", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "src/a.ts",
        target: "added",
        modifiedLine: 1,
        code: "a();",
        language: "ts",
        comment: "test",
      }),
    ]);
    session.branchNameAtStart = undefined;
    session.headCommitAtStart = undefined;
    const md = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");
    expect(md).not.toContain("> Branch at Start:");
    expect(md).not.toContain("> HEAD at Start:");
  });

  it("コードにバッククォート3つが含まれるときフェンスを動的に調整すること", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "src/a.ts",
        target: "added",
        modifiedLine: 1,
        code: "```example```",
        language: "ts",
        comment: "backtick test",
      }),
    ]);
    const md = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");
    expect(md).toContain("````ts");
    expect(md).toContain("````");
  });

  it("コメントはファイル順で並び、見出し番号は再採番されること", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c10",
        sequence: 10,
        path: "src/b.ts",
        target: "added",
        modifiedLine: 20,
        code: "ten();",
        language: "ts",
        comment: "10",
      }),
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "src/a.ts",
        target: "added",
        modifiedLine: 1,
        code: "one();",
        language: "ts",
        comment: "1",
      }),
    ]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    const firstIndex = markdown.indexOf("## 1. @src/a.ts");
    const secondIndex = markdown.indexOf("## 2. @src/b.ts");
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(secondIndex).toBeGreaterThan(firstIndex);
  });

  it("同一キーのコメントは1ブロックに集約し小見出しで列挙すること", () => {
    const first = buildReviewComment({
      id: "c1",
      sequence: 1,
      path: "skills/agent-team-workflow/SKILL.md",
      target: "modified-after",
      modifiedLine: 11,
      code: "aaaaaaa",
      language: "skill",
      comment: "1",
    });
    first.threadRangeStartLine = 11;
    first.threadRangeEndLine = 11;

    const second = buildReviewComment({
      id: "c2",
      sequence: 2,
      path: "skills/agent-team-workflow/SKILL.md",
      target: "modified-after",
      modifiedLine: 11,
      code: "aaaaaaa",
      language: "skill",
      comment: "2",
    });
    second.threadRangeStartLine = 11;
    second.threadRangeEndLine = 11;

    const third = buildReviewComment({
      id: "c3",
      sequence: 3,
      path: "skills/agent-team-workflow/SKILL.md",
      target: "modified-after",
      modifiedLine: 11,
      code: "aaaaaaa",
      language: "skill",
      comment: "3",
    });
    third.threadRangeStartLine = 11;
    third.threadRangeEndLine = 11;

    const session = buildReviewSession([third, first, second]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");
    const headingCount = markdown.match(/^## /gm)?.length ?? 0;

    expect(headingCount).toBe(1);
    expect(markdown).toContain("## 1. @skills/agent-team-workflow/SKILL.md");
    expect(markdown).toContain("### 1.1.\n1");
    expect(markdown).toContain("### 1.2.\n2");
    expect(markdown).toContain("### 1.3.\n3");
    expect(markdown).not.toContain("Comment:");
  });

  it("コードまたは行範囲が異なる場合は別ブロックとして出力すること", () => {
    const base = buildReviewComment({
      id: "c1",
      sequence: 1,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 11,
      code: "same();",
      language: "ts",
      comment: "same code",
    });
    base.threadRangeStartLine = 11;
    base.threadRangeEndLine = 11;

    const differentCode = buildReviewComment({
      id: "c2",
      sequence: 2,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 11,
      code: "different();",
      language: "ts",
      comment: "different code",
    });
    differentCode.threadRangeStartLine = 11;
    differentCode.threadRangeEndLine = 11;

    const differentRange = buildReviewComment({
      id: "c3",
      sequence: 3,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 11,
      code: "same();",
      language: "ts",
      comment: "different range",
    });
    differentRange.threadRangeStartLine = 11;
    differentRange.threadRangeEndLine = 12;

    const session = buildReviewSession([base, differentCode, differentRange]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");
    const headingCount = markdown.match(/^## /gm)?.length ?? 0;

    expect(headingCount).toBe(3);
    expect(markdown).not.toContain("### 1.1.");
  });

  it("1件だけのグループは小見出しを出さないこと", () => {
    const session = buildReviewSession([
      buildReviewComment({
        id: "c1",
        sequence: 1,
        path: "src/a.ts",
        target: "added",
        modifiedLine: 1,
        code: "single();",
        language: "ts",
        comment: "single comment",
      }),
    ]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    expect(markdown).toContain("single comment");
    expect(markdown).not.toContain("### 1.1.");
  });

  it("見出し番号はコメント件数ではなくグループ件数で再採番されること", () => {
    const first = buildReviewComment({
      id: "c1",
      sequence: 1,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 10,
      code: "grouped();",
      language: "ts",
      comment: "g1",
    });
    first.threadRangeStartLine = 10;
    first.threadRangeEndLine = 10;

    const second = buildReviewComment({
      id: "c2",
      sequence: 2,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 10,
      code: "grouped();",
      language: "ts",
      comment: "g2",
    });
    second.threadRangeStartLine = 10;
    second.threadRangeEndLine = 10;

    const third = buildReviewComment({
      id: "c3",
      sequence: 3,
      path: "src/b.ts",
      target: "modified-after",
      modifiedLine: 20,
      code: "alone();",
      language: "ts",
      comment: "alone",
    });
    third.threadRangeStartLine = 20;
    third.threadRangeEndLine = 20;

    const session = buildReviewSession([third, second, first]);
    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");
    const headingCount = markdown.match(/^## /gm)?.length ?? 0;

    expect(headingCount).toBe(2);
    expect(markdown).toContain("## 1. @src/a.ts");
    expect(markdown).toContain("## 2. @src/b.ts");
    expect(markdown).not.toContain("## 3.");
    expect(markdown).toContain("### 1.1.\ng1");
    expect(markdown).toContain("### 1.2.\ng2");
  });

  it("複数行コメントでは Modified Line を範囲表記で出力すること", () => {
    const comment = buildReviewComment({
      id: "c1",
      sequence: 1,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 20,
      code: "line20();\nline21();",
      language: "ts",
      comment: "range comment",
    });
    comment.threadRangeStartLine = 20;
    comment.threadRangeEndLine = 24;
    const session = buildReviewSession([comment]);

    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");
    expect(markdown).toContain("- Modified Line: 20 - 24");
  });

  it("同一ファイル内では File コメントを先頭にし、次に選択行順で並ぶこと", () => {
    const fileComment = buildReviewComment({
      id: "c3",
      sequence: 3,
      path: "src/a.ts",
      target: "file",
      code: "",
      language: "",
      comment: "file first",
    });

    const laterLineComment = buildReviewComment({
      id: "c2",
      sequence: 2,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 20,
      code: "line20();",
      language: "ts",
      comment: "line 20",
    });
    laterLineComment.threadRangeStartLine = 20;
    laterLineComment.threadRangeEndLine = 20;

    const earlyLineComment = buildReviewComment({
      id: "c1",
      sequence: 1,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 10,
      code: "line10();",
      language: "ts",
      comment: "line 10",
    });
    earlyLineComment.threadRangeStartLine = 10;
    earlyLineComment.threadRangeEndLine = 10;

    const sameLineLaterSequence = buildReviewComment({
      id: "c4",
      sequence: 4,
      path: "src/a.ts",
      target: "modified-after",
      modifiedLine: 10,
      code: "line10-b();",
      language: "ts",
      comment: "line 10 later",
    });
    sameLineLaterSequence.threadRangeStartLine = 10;
    sameLineLaterSequence.threadRangeEndLine = 10;

    const session = buildReviewSession([
      laterLineComment,
      fileComment,
      sameLineLaterSequence,
      earlyLineComment,
    ]);

    const markdown = formatReviewMarkdown(session, "2026-03-26T12:34:56.000Z");

    const fileIndex = markdown.indexOf("\nfile first\n");
    const line10Index = markdown.indexOf("\nline 10\n");
    const line10LaterIndex = markdown.indexOf("\nline 10 later\n");
    const line20Index = markdown.indexOf("\nline 20\n");

    expect(fileIndex).toBeGreaterThanOrEqual(0);
    expect(line10Index).toBeGreaterThan(fileIndex);
    expect(line10LaterIndex).toBeGreaterThan(line10Index);
    expect(line20Index).toBeGreaterThan(line10LaterIndex);
  });
});
