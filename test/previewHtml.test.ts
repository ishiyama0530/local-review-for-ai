import { describe, expect, it } from "vitest";

import { createPreviewHtml } from "../src/preview/previewHtml";

describe("previewHtml", () => {
  const webview = { cspSource: "vscode-webview://local-review-for-ai" } as never;
  const githubMarkdownCssHref =
    "vscode-webview://local-review-for-ai/node_modules/github-markdown-css/github-markdown.css";
  const codiconsCssHref =
    "vscode-webview://local-review-for-ai/node_modules/@vscode/codicons/dist/codicon.css";

  it("上部アクションが Copy / Cancel / Discard comments の順で表示されること", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    const copyIndex = html.indexOf('id="copyMarkdown"');
    const discardIndex = html.indexOf('id="discardReview"');
    const closeIndex = html.indexOf('id="closePreview"');

    expect(copyIndex).toBeGreaterThanOrEqual(0);
    expect(discardIndex).toBeGreaterThanOrEqual(0);
    expect(closeIndex).toBeGreaterThanOrEqual(0);
    expect(copyIndex).toBeLessThan(closeIndex);
    expect(closeIndex).toBeLessThan(discardIndex);
    expect(html).toContain('id="closePreview"');
    expect(html).toContain('id="discardReview"');
    expect(html).toContain('id="copyMarkdown"');
    expect(html).toContain("codicon-close");
    expect(html).toContain("codicon-eraser");
    expect(html).toContain("codicon-copy");
    expect(html).toContain("<span>Cancel</span>");
    expect(html).toContain("<span>Discard comments</span>");
    expect(html).toContain('title="Discard all review comments and reset the current session."');
    expect(html).toContain(
      'aria-label="Discard all review comments and reset the current session."',
    );
    expect(html).toContain(
      'data-tooltip="Discard all review comments and reset the current session."',
    );
    expect(html).toContain('id="copyMarkdown" data-testid="preview-copy" class="primary"');
    expect(html).toContain('id="discardReview" data-testid="preview-discard" class="secondary"');
    expect(html).toContain('id="closePreview" data-testid="preview-cancel" class="secondary"');
    expect(html).toContain('class="actions actions-left"');
    expect(html).toContain('class="actions actions-right"');
    expect(html).toContain("justify-content: space-between;");
    expect(html).toContain("#discardReview {");
    expect(html).toContain("#f2c94c");
    expect(html).toContain("button[data-tooltip]::after");
    expect(html).toContain("button[data-tooltip]:hover::after");
    expect(html).toContain("max-width: min(360px, calc(100vw - 32px));");
    expect(html).toContain("#discardReview[data-tooltip]::after");
    expect(html).toContain("#discardReview[data-tooltip]::before");
    expect(html).toContain("button.secondary {");
    expect(html).toContain("var(--vscode-button-secondaryBackground)");
    expect(html).toContain("button.primary {");
    expect(html).toContain('data-testid="preview-markdown-panel"');
    expect(html).toContain('data-testid="preview-markdown-editor"');
    expect(html).toContain('data-testid="preview-rendered-panel"');
    expect(html).not.toContain('id="back"');
    expect(html).not.toContain('id="copyAndFinish"');
  });

  it("左パネルが編集可能 textarea であること", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    expect(html).toContain('<textarea id="markdownEditor"');
    expect(html).toContain('spellcheck="false"');
    expect(html).not.toContain('<pre class="raw-markdown">');
  });

  it("入力変更で previewMarkdownChanged を debounce 送信すること", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    expect(html).toContain("const RENDER_DEBOUNCE_MS = 150;");
    expect(html).toContain("window.setTimeout(() => {");
    expect(html).toContain("type: 'previewMarkdownChanged'");
    expect(html).toContain("requestId,");
  });

  it("Copy が現在入力値を payload 付きで送信すること", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    expect(html).toContain(
      "vscode.postMessage({ type: 'copyMarkdown', markdown: markdownEditor.value });",
    );
  });

  it("Cancel が closePreview を送信すること", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    expect(html).toContain("vscode.postMessage({ type: 'closePreview' });");
  });

  it("Discard が discardReview を送信すること", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    expect(html).toContain("vscode.postMessage({ type: 'discardReview' });");
  });

  it("更新メッセージは世代IDで逆転適用を防ぐこと", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    expect(html).toContain("message.type !== 'renderedHtmlUpdated'");
    expect(html).toContain("if (message.requestId < latestAppliedRenderRequestId)");
    expect(html).toContain("renderedPanel.innerHTML = message.renderedHtml;");
  });

  it("github-markdown-css と codicons を読み込むこと", async () => {
    const html = await createPreviewHtml(
      webview,
      "# Test\n\nBody",
      githubMarkdownCssHref,
      codiconsCssHref,
    );
    expect(html).toContain(`<link rel="stylesheet" href="${githubMarkdownCssHref}" />`);
    expect(html).toContain(`<link rel="stylesheet" href="${codiconsCssHref}" />`);
    expect(html).toContain("style-src-attr 'unsafe-inline'");
    expect(html).toContain("--preview-font-size: 1.06em;");
    expect(html).toContain(".markdown-body .shiki");
    expect(html).toContain("background-color: var(--code-bg) !important;");
  });

  it("コードブロックを Shiki でレンダリングすること", async () => {
    const markdown = "```ts\nconst value = 1;\n```";
    const html = await createPreviewHtml(webview, markdown, githubMarkdownCssHref, codiconsCssHref);
    expect(html).toContain('class="shiki');
    expect(html).toContain("<span style=");
  });

  it("可変長コードフェンスでも Shiki レンダリングすること", async () => {
    const markdown = "````typescript\nclass Hoge {\n  private name: string;\n}\n````";
    const html = await createPreviewHtml(webview, markdown, githubMarkdownCssHref, codiconsCssHref);
    expect(html).toContain('class="shiki');
    expect(html).toContain("<span style=");
    expect(html).toContain("private");
  });

  it("コードブロック内の空行は圧縮用クラスで出力されること", async () => {
    const markdown = "```ts\nconst a = 1;\n\nconst b = 2;\n```";
    const html = await createPreviewHtml(webview, markdown, githubMarkdownCssHref, codiconsCssHref);
    expect(html).toContain('class="line line-empty"');
    expect(html).toContain(".markdown-body .shiki .line.line-empty");
    expect(html).not.toContain("font-size: 0 !important;");
  });

  it("### の配下は h3-block でラップされること", async () => {
    const markdown = "## 1. file.ts\n### 1.1.\ncomment A\n### 1.2.\ncomment B";
    const html = await createPreviewHtml(webview, markdown, githubMarkdownCssHref, codiconsCssHref);
    expect(html).toContain('<div class="h3-block">');
    expect(html).toContain(".markdown-body .h3-block");
    expect(html).toContain("<h3>1.1.</h3>");
    expect(html).toContain("<h3>1.2.</h3>");
  });
});
