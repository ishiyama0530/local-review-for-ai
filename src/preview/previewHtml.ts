import * as crypto from "node:crypto";
import * as vscode from "vscode";

type ShikiHighlighter = Awaited<ReturnType<(typeof import("shiki"))["createHighlighter"]>>;

const SHIKI_LIGHT_THEME = "github-light";
const SHIKI_DARK_THEME = "github-dark";
const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascriptreact",
  shell: "bash",
  sh: "bash",
  ts: "typescript",
  tsx: "typescriptreact",
  yml: "yaml",
};

const loadedShikiLanguages = new Set<string>(["plaintext"]);
let shikiHighlighterPromise: Promise<ShikiHighlighter> | undefined;

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLanguage(language: string): string {
  const normalized = language.trim().toLowerCase();
  if (!normalized) {
    return "plaintext";
  }
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

function parseFenceLanguage(info: string): string {
  const normalizedInfo = info.trim();
  if (normalizedInfo.length === 0) {
    return "plaintext";
  }
  const [rawLanguage] = normalizedInfo.split(/\s+/, 1);
  return normalizeLanguage(rawLanguage ?? "");
}

function parseFenceLine(line: string): { fence: string; info: string } | undefined {
  const match = /^\s*(`{3,})(.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  const [, fence, info] = match;
  if (!fence) {
    return undefined;
  }
  return {
    fence,
    info: info ?? "",
  };
}

function parseClosingFence(line: string): string | undefined {
  const match = /^\s*(`{3,})\s*$/.exec(line);
  if (!match) {
    return undefined;
  }
  return match[1];
}

function isMatchingFence(openFence: string, closeFence: string): boolean {
  return closeFence.length >= openFence.length;
}

function isHtmlLineEffectivelyEmpty(lineBody: string): boolean {
  const textWithoutTags = lineBody.replace(/<[^>]+>/g, "");
  const normalizedWhitespaceEntities = textWithoutTags
    .replace(
      /&nbsp;|&#160;|&#xA0;|&#x0*A0;|&Tab;|&#9;|&#x09;|&NewLine;|&#10;|&#x0*A;|&#13;|&#x0*D;|&#32;|&#x20;/gi,
      " ",
    )
    .replace(/&#8203;|&#x200B;|&#x200C;|&#x200D;|&#xfeff;/gi, "");
  const collapsed = normalizedWhitespaceEntities
    .replace(/[\s\u3000\u200B-\u200D\u2060\uFEFF]+/g, "")
    .trim();
  return collapsed.length === 0;
}

async function getShikiHighlighter(): Promise<ShikiHighlighter> {
  if (!shikiHighlighterPromise) {
    shikiHighlighterPromise = import("shiki").then((shiki) =>
      shiki.createHighlighter({
        themes: [SHIKI_LIGHT_THEME, SHIKI_DARK_THEME],
        langs: ["plaintext"],
      }),
    );
  }
  return shikiHighlighterPromise;
}

async function ensureShikiLanguage(
  highlighter: ShikiHighlighter,
  language: string,
): Promise<string> {
  const normalizedLanguage = normalizeLanguage(language);
  if (loadedShikiLanguages.has(normalizedLanguage)) {
    return normalizedLanguage;
  }
  try {
    const shiki = await import("shiki");
    const bundledLanguage =
      shiki.bundledLanguages[normalizedLanguage as keyof typeof shiki.bundledLanguages];
    if (!bundledLanguage) {
      const languageInput = normalizedLanguage as Parameters<ShikiHighlighter["loadLanguage"]>[0];
      await highlighter.loadLanguage(languageInput);
      loadedShikiLanguages.add(normalizedLanguage);
      return normalizedLanguage;
    }
    await highlighter.loadLanguage(bundledLanguage);
    loadedShikiLanguages.add(normalizedLanguage);
    return normalizedLanguage;
  } catch {
    return "plaintext";
  }
}

async function renderCodeBlockWithShiki(code: string, language: string): Promise<string> {
  try {
    const highlighter = await getShikiHighlighter();
    const safeLanguage = await ensureShikiLanguage(highlighter, language);
    const rendered = highlighter.codeToHtml(code, {
      lang: safeLanguage,
      themes: {
        light: SHIKI_LIGHT_THEME,
        dark: SHIKI_DARK_THEME,
      },
    });
    const withMarkedEmptyLines = rendered.replace(
      /<span class="line">([\s\S]*?)<\/span>/g,
      (lineMatch, lineBody) => {
        if (!isHtmlLineEffectivelyEmpty(String(lineBody))) {
          return lineMatch;
        }
        return `<span class="line line-empty">${lineBody}</span>`;
      },
    );
    return withMarkedEmptyLines.replace(/<\/span>\s*\r?\n\s*(?=<span class="line")/g, "</span>");
  } catch {
    return `<pre><code>${escapeHtml(code)}</code></pre>`;
  }
}

function closeListIfNeeded(htmlLines: string[], state: { inList: boolean }): void {
  if (!state.inList) {
    return;
  }
  htmlLines.push("</ul>");
  state.inList = false;
}

function closeH3BlockIfNeeded(htmlLines: string[], state: { inBlock: boolean }): void {
  if (!state.inBlock) {
    return;
  }
  htmlLines.push("</div>");
  state.inBlock = false;
}

function renderEditableMarkdown(markdown: string): string {
  return escapeHtml(markdown.replace(/\r\n/g, "\n"));
}

export async function renderSimpleMarkdown(markdown: string): Promise<string> {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const htmlLines: string[] = [];
  let inCodeBlock = false;
  let activeFence = "";
  let codeLanguage = "plaintext";
  const codeLines: string[] = [];
  const listState = { inList: false };
  const h3BlockState = { inBlock: false };

  for (const line of lines) {
    const parsedFence = parseFenceLine(line);
    if (!inCodeBlock && parsedFence) {
      closeListIfNeeded(htmlLines, listState);
      inCodeBlock = true;
      activeFence = parsedFence.fence;
      codeLanguage = parseFenceLanguage(parsedFence.info);
      continue;
    }

    if (inCodeBlock) {
      const closingFence = parseClosingFence(line);
      if (closingFence && isMatchingFence(activeFence, closingFence)) {
        const code = codeLines.join("\n");
        htmlLines.push(await renderCodeBlockWithShiki(code, codeLanguage));
        codeLines.length = 0;
        inCodeBlock = false;
        activeFence = "";
        continue;
      }
      codeLines.push(line);
      continue;
    }

    if (line.startsWith("- ")) {
      if (!listState.inList) {
        htmlLines.push("<ul>");
        listState.inList = true;
      }
      htmlLines.push(`<li>${escapeHtml(line.slice(2))}</li>`);
      continue;
    }

    closeListIfNeeded(htmlLines, listState);

    if (line.startsWith("# ")) {
      closeH3BlockIfNeeded(htmlLines, h3BlockState);
      htmlLines.push(`<h1>${escapeHtml(line.slice(2))}</h1>`);
      continue;
    }
    if (line.startsWith("## ")) {
      closeH3BlockIfNeeded(htmlLines, h3BlockState);
      htmlLines.push(`<h2>${escapeHtml(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      closeH3BlockIfNeeded(htmlLines, h3BlockState);
      htmlLines.push('<div class="h3-block">');
      h3BlockState.inBlock = true;
      htmlLines.push(`<h3>${escapeHtml(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("> ")) {
      htmlLines.push(`<blockquote>${escapeHtml(line.slice(2))}</blockquote>`);
      continue;
    }
    if (line.length === 0) {
      htmlLines.push('<div class="md-gap" aria-hidden="true"></div>');
      continue;
    }
    htmlLines.push(`<p>${escapeHtml(line)}</p>`);
  }

  if (inCodeBlock) {
    htmlLines.push(await renderCodeBlockWithShiki(codeLines.join("\n"), codeLanguage));
  }
  closeListIfNeeded(htmlLines, listState);
  closeH3BlockIfNeeded(htmlLines, h3BlockState);
  return htmlLines.join("\n");
}

function createNonce(): string {
  return crypto.randomBytes(16).toString("base64url");
}

export async function createPreviewHtml(
  webview: vscode.Webview,
  markdown: string,
  githubMarkdownCssHref: string,
  codiconsCssHref: string,
): Promise<string> {
  const nonce = createNonce();
  const renderedHtml = await renderSimpleMarkdown(markdown);
  const editableMarkdown = renderEditableMarkdown(markdown);
  const escapedGithubMarkdownCssHref = escapeHtml(githubMarkdownCssHref);
  const escapedCodiconsCssHref = escapeHtml(codiconsCssHref);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta
    http-equiv="Content-Security-Policy"
    content="default-src 'none'; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'nonce-${nonce}' 'unsafe-inline'; style-src-attr 'unsafe-inline'; script-src 'nonce-${nonce}';"
  />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Local Review for AI</title>
  <link rel="stylesheet" href="${escapedGithubMarkdownCssHref}" />
  <link rel="stylesheet" href="${escapedCodiconsCssHref}" />
  <style nonce="${nonce}">
    :root {
      color-scheme: light dark;
      --gap: 14px;
      --radius-panel: 12px;
      --radius-control: 8px;
      --preview-font-size: 1.06em;
      --empty-line-height: 1em;
      --border: color-mix(in srgb, currentColor 20%, transparent);
      --surface-bg: color-mix(
        in srgb,
        var(--vscode-editor-background) 97%,
        var(--vscode-editorWidget-background, var(--vscode-editor-background)) 3%
      );
      --code-bg: color-mix(
        in srgb,
        var(--vscode-editor-background) 90%,
        var(--vscode-editor-foreground) 10%
      );
      --shadow-soft: 0 8px 26px color-mix(in srgb, #000 16%, transparent);
      --topbar-bg: color-mix(
        in srgb,
        var(--vscode-editor-background) 94%,
        var(--vscode-editorWidget-background, var(--vscode-editor-background)) 6%
      );
    }
    body {
      margin: 0;
      padding: 14px 16px 16px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-editor-foreground);
      background:
        radial-gradient(
          900px 360px at 0% -10%,
          color-mix(in srgb, var(--vscode-focusBorder) 10%, transparent),
          transparent 60%
        ),
        color-mix(
          in srgb,
          var(--vscode-editor-background) 99%,
          var(--vscode-editor-foreground) 1%
        );
    }
    .layout {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: var(--gap);
    }
    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 14px;
      padding: 8px 10px;
      border: 1px solid var(--border);
      border-radius: var(--radius-panel);
      background: var(--topbar-bg);
      box-shadow: var(--shadow-soft);
    }
    .panel {
      border: 1px solid var(--border);
      border-radius: var(--radius-panel);
      padding: 14px;
      min-height: 60vh;
      overflow: auto;
      background: var(--surface-bg);
      outline: none;
      box-shadow: var(--shadow-soft);
      transition:
        border-color 140ms ease,
        box-shadow 140ms ease,
        transform 140ms ease;
    }
    .panel.is-focused {
      border-color: var(--vscode-focusBorder);
      box-shadow:
        0 0 0 1px var(--vscode-focusBorder),
        0 12px 30px color-mix(in srgb, #000 22%, transparent);
      transform: translateY(-1px);
    }
    .actions {
      display: flex;
      gap: 10px;
      flex-wrap: wrap;
    }
    .actions-left {
      justify-content: flex-start;
    }
    .actions-right {
      margin-left: auto;
      justify-content: flex-end;
    }
    button {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border: 1px solid var(--border);
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border-radius: var(--radius-control);
      padding: 6px 12px;
      font-weight: 600;
      line-height: 1;
      vertical-align: middle;
      letter-spacing: 0.01em;
      cursor: pointer;
      transition:
        transform 120ms ease,
        filter 120ms ease,
        box-shadow 120ms ease;
    }
    button.secondary {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }
    button.primary {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
    }
    #discardReview {
      background: color-mix(in srgb, #f2c94c 72%, var(--vscode-editor-background) 28%);
      border-color: color-mix(in srgb, #d6a300 56%, var(--border) 44%);
      color: color-mix(in srgb, #121212 88%, var(--vscode-editor-foreground) 12%);
    }
    button:hover {
      filter: brightness(1.06);
      box-shadow: 0 4px 14px color-mix(in srgb, #000 14%, transparent);
    }
    button:active {
      transform: translateY(1px);
    }
    button[data-tooltip]::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 50%;
      top: 100%;
      transform: translate(-50%, 14px);
      padding: 6px 8px;
      border-radius: 6px;
      border: 1px solid
        color-mix(in srgb, var(--vscode-editor-foreground) 28%, transparent);
      background: color-mix(
        in srgb,
        var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 94%,
        #000 6%
      );
      color: var(--vscode-editorHoverWidget-foreground, var(--vscode-editor-foreground));
      font-size: 12px;
      font-weight: 500;
      line-height: 1.2;
      white-space: normal;
      max-width: min(360px, calc(100vw - 32px));
      box-sizing: border-box;
      pointer-events: none;
      opacity: 0;
      z-index: 20;
      box-shadow: 0 6px 18px color-mix(in srgb, #000 24%, transparent);
      transition: opacity 120ms ease;
    }
    button[data-tooltip]::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 100%;
      transform: translate(-50%, 6px);
      width: 8px;
      height: 8px;
      border-right: 1px solid
        color-mix(in srgb, var(--vscode-editor-foreground) 28%, transparent);
      border-bottom: 1px solid
        color-mix(in srgb, var(--vscode-editor-foreground) 28%, transparent);
      background: color-mix(
        in srgb,
        var(--vscode-editorHoverWidget-background, var(--vscode-editor-background)) 94%,
        #000 6%
      );
      pointer-events: none;
      opacity: 0;
      z-index: 19;
      rotate: 45deg;
      transition: opacity 120ms ease;
    }
    button[data-tooltip]:hover::after,
    button[data-tooltip]:hover::before,
    button[data-tooltip]:focus-visible::after,
    button[data-tooltip]:focus-visible::before {
      opacity: 1;
    }
    #discardReview[data-tooltip]::after {
      left: auto;
      right: 0;
      transform: translate(0, 14px);
      text-align: left;
    }
    #discardReview[data-tooltip]::before {
      left: auto;
      right: 14px;
      transform: translate(0, 6px);
    }
    .button-content {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
    }
    .button-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      line-height: 1;
    }
    .button-icon::before {
      line-height: 1;
    }
    #markdownPanel {
      padding: 0;
      display: flex;
      background: color-mix(
        in srgb,
        var(--vscode-editor-background) 95%,
        var(--vscode-editorWidget-background, var(--vscode-editor-background)) 5%
      );
    }
    #markdownEditor {
      width: 100%;
      min-height: 60vh;
      border: none;
      outline: none;
      resize: none;
      margin: 0;
      padding: 14px;
      box-sizing: border-box;
      background: transparent;
      color: var(--vscode-editor-foreground);
      margin: 0;
      white-space: pre;
      tab-size: 2;
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Menlo, monospace);
      font-size: var(--preview-font-size);
      line-height: 1.5;
      letter-spacing: 0.01em;
    }
    .markdown-body {
      color: var(--vscode-editor-foreground);
      background: transparent;
      box-sizing: border-box;
      min-width: 100%;
      max-width: none;
      line-height: 1.5;
      font-size: var(--preview-font-size);
    }
    .markdown-body h1 {
      margin-top: 0;
      margin-bottom: 0.28em;
      padding-bottom: 0.2em;
      letter-spacing: -0.01em;
      border-bottom: 1px solid var(--border);
    }
    .markdown-body h2 {
      margin-top: 0.52em;
      margin-bottom: 0.26em;
      padding-bottom: 0.2em;
      border-bottom: 1px solid color-mix(in srgb, currentColor 20%, transparent);
    }
    .markdown-body h3 {
      margin-top: 0.24em;
      margin-bottom: 0.16em;
      padding-left: 0;
      font-size: 0.95em;
      opacity: 0.95;
    }
    .markdown-body .h3-block {
      padding-left: 1.44em;
      border-left: 2px solid color-mix(in srgb, var(--vscode-focusBorder) 35%, transparent);
      margin: 0.1em 0 0.2em;
    }
    .markdown-body p {
      margin-top: 0.18em;
      margin-bottom: 0.18em;
    }
    .markdown-body ul {
      margin-top: 0.14em;
      margin-bottom: 0.14em;
    }
    .markdown-body .md-gap {
      height: var(--empty-line-height);
    }
    .markdown-body pre {
      background: transparent;
    }
    .markdown-body .shiki {
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 12px;
      margin-top: 0.5em;
      overflow-x: auto;
      background-color: var(--code-bg) !important;
      color: var(--vscode-editor-foreground);
      font-size: 1em;
      box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 14%, transparent);
    }
    .markdown-body .shiki code {
      display: block;
      white-space: normal !important;
    }
    body.vscode-dark .markdown-body .shiki,
    body.vscode-high-contrast .markdown-body .shiki {
      color: var(--shiki-dark) !important;
    }
    body.vscode-dark .markdown-body .shiki span,
    body.vscode-high-contrast .markdown-body .shiki span {
      color: var(--shiki-dark) !important;
    }
    .markdown-body .shiki .line {
      display: block;
      line-height: 1.45;
      white-space: pre;
    }
    .markdown-body .shiki .line.line-empty {
      line-height: 0 !important;
      min-height: 0 !important;
      height: var(--empty-line-height) !important;
      overflow: hidden;
      margin: 0 !important;
      padding: 0 !important;
    }
    .markdown-body .shiki .line.line-empty > span {
      display: none !important;
    }
    @media (max-width: 1100px) {
      .layout {
        grid-template-columns: 1fr;
      }
      .panel {
        min-height: 45vh;
      }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="actions actions-left">
      <button id="copyMarkdown" data-testid="preview-copy" class="primary"><span class="button-content"><span class="button-icon codicon codicon-copy" aria-hidden="true"></span><span>Copy</span></span></button>
      <button id="closePreview" data-testid="preview-cancel" class="secondary"><span class="button-content"><span class="button-icon codicon codicon-close" aria-hidden="true"></span><span>Cancel</span></span></button>
    </div>
    <div class="actions actions-right">
      <button id="discardReview" data-testid="preview-discard" class="secondary" title="Discard all review comments and reset the current session." aria-label="Discard all review comments and reset the current session." data-tooltip="Discard all review comments and reset the current session."><span class="button-content"><span class="button-icon codicon codicon-eraser" aria-hidden="true"></span><span>Discard comments</span></span></button>
    </div>
  </div>
  <div class="layout">
    <section class="panel" id="markdownPanel" data-testid="preview-markdown-panel" tabindex="0">
      <textarea id="markdownEditor" data-testid="preview-markdown-editor" spellcheck="false">${editableMarkdown}</textarea>
    </section>
    <section class="panel markdown-body" id="renderedPanel" data-testid="preview-rendered-panel" tabindex="0">${renderedHtml}</section>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let focusedPanel = null;
    const panels = Array.from(document.querySelectorAll('.panel'));
    const markdownEditor = document.getElementById('markdownEditor');
    const renderedPanel = document.getElementById('renderedPanel');
    let renderRequestId = 0;
    let latestAppliedRenderRequestId = 0;
    let renderDebounceHandle = undefined;
    const RENDER_DEBOUNCE_MS = 150;

    function setFocusedPanel(panel) {
      focusedPanel = panel;
      for (const candidate of panels) {
        candidate.classList.toggle('is-focused', candidate === panel);
      }
    }

    for (const panel of panels) {
      panel.addEventListener('focus', () => {
        setFocusedPanel(panel);
      });
      panel.addEventListener('mousedown', () => {
        panel.focus();
        setFocusedPanel(panel);
      });
    }

    document.addEventListener('focusin', (event) => {
      const target = event.target instanceof HTMLElement ? event.target.closest('.panel') : null;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      setFocusedPanel(target);
    });

    window.addEventListener('keydown', (event) => {
      const isSelectAll = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a';
      if (!isSelectAll) {
        return;
      }
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        (activeElement.tagName === 'TEXTAREA' ||
          activeElement.tagName === 'INPUT' ||
          activeElement.isContentEditable)
      ) {
        return;
      }
      const activePanel = activeElement instanceof HTMLElement
        ? activeElement.closest('.panel')
        : null;
      const targetPanel = activePanel ?? focusedPanel;
      if (!(targetPanel instanceof HTMLElement)) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const selection = window.getSelection();
      if (!selection) {
        return;
      }
      const range = document.createRange();
      range.selectNodeContents(targetPanel);
      selection.removeAllRanges();
      selection.addRange(range);
    }, true);

    function requestRenderedUpdate() {
      if (!(markdownEditor instanceof HTMLTextAreaElement)) {
        return;
      }
      renderRequestId += 1;
      const requestId = renderRequestId;
      vscode.postMessage({
        type: 'previewMarkdownChanged',
        markdown: markdownEditor.value,
        requestId,
      });
    }

    if (markdownEditor instanceof HTMLTextAreaElement) {
      markdownEditor.addEventListener('input', () => {
        if (renderDebounceHandle !== undefined) {
          window.clearTimeout(renderDebounceHandle);
        }
        renderDebounceHandle = window.setTimeout(() => {
          requestRenderedUpdate();
        }, RENDER_DEBOUNCE_MS);
      });
      markdownEditor.addEventListener('focus', () => {
        const parentPanel = markdownEditor.closest('.panel');
        if (parentPanel instanceof HTMLElement) {
          setFocusedPanel(parentPanel);
        }
      });
    }

    window.addEventListener('message', (event) => {
      const message = event.data;
      if (
        !message ||
        message.type !== 'renderedHtmlUpdated' ||
        typeof message.requestId !== 'number' ||
        typeof message.renderedHtml !== 'string'
      ) {
        return;
      }
      if (message.requestId < latestAppliedRenderRequestId) {
        return;
      }
      latestAppliedRenderRequestId = message.requestId;
      if (renderedPanel instanceof HTMLElement) {
        renderedPanel.innerHTML = message.renderedHtml;
      }
    });

    document.getElementById('copyMarkdown').addEventListener('click', () => {
      if (!(markdownEditor instanceof HTMLTextAreaElement)) {
        return;
      }
      vscode.postMessage({ type: 'copyMarkdown', markdown: markdownEditor.value });
    });
    document.getElementById('closePreview').addEventListener('click', () => {
      vscode.postMessage({ type: 'closePreview' });
    });
    document.getElementById('discardReview').addEventListener('click', () => {
      vscode.postMessage({ type: 'discardReview' });
    });
  </script>
</body>
</html>`;
}
