import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  chromium,
  expect,
  type Browser,
  type Frame,
  type Locator,
  type Page,
} from "@playwright/test";
import { downloadAndUnzipVSCode } from "@vscode/test-electron";

export interface E2eLaunchContext {
  readonly browser: Browser;
  readonly vscodeProcess: ChildProcess;
  readonly page: Page;
  readonly userDataDir: string;
}

const COMMAND_MODIFIER = process.platform === "darwin" ? "Meta" : "Control";
const COMMENT_INPUT_DEBUG_PREFIX = "e2e-comment-input-missing";

export type LocalReviewCommentMode = "line" | "file";

export async function waitForCondition(
  callback: () => Promise<boolean> | boolean,
  timeoutMs: number,
  intervalMs = 100,
): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    // eslint-disable-next-line no-await-in-loop
    if (await callback()) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms while waiting for condition.`);
}

export async function launchVsCodeForE2e(options: {
  readonly extensionDevelopmentPath: string;
  readonly workspacePath: string;
}): Promise<E2eLaunchContext> {
  const vscodeExecutablePath = await downloadAndUnzipVSCode("stable");
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "local-review-for-ai-e2e-user-data-"));
  const debugPort = await findAvailablePort();

  const vscodeProcess = spawn(
    vscodeExecutablePath,
    [
      options.workspacePath,
      `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
      "--disable-extensions",
      "--skip-welcome",
      "--skip-release-notes",
      "--disable-workspace-trust",
      "--disable-updates",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${debugPort}`,
    ],
    {
      env: {
        ...process.env,
      },
      stdio: "ignore",
    },
  );

  let browser: Browser | undefined;
  await waitForCondition(
    async () => {
      try {
        browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
        return true;
      } catch {
        return false;
      }
    },
    90_000,
    250,
  );

  if (!browser) {
    throw new Error("Failed to connect to VS Code via CDP.");
  }

  const page = await waitForWorkbenchPage(browser);
  await expect(page.locator(".monaco-workbench")).toBeVisible({ timeout: 90_000 });
  return {
    browser,
    vscodeProcess,
    page,
    userDataDir,
  };
}

export async function closeVsCodeForE2e(context: E2eLaunchContext): Promise<void> {
  await context.browser.close();
  if (!context.vscodeProcess.killed) {
    context.vscodeProcess.kill("SIGTERM");
  }
  await rm(context.userDataDir, { recursive: true, force: true });
}

export async function openFileWithQuickOpen(page: Page, relativePath: string): Promise<void> {
  const baseName = path.basename(relativePath);
  const srcFolder = page
    .locator(".explorer-folders-view .label-name")
    .filter({ hasText: /^src$/i })
    .first();
  if ((await srcFolder.count()) > 0 && (await srcFolder.isVisible())) {
    await srcFolder.click();
  }

  const explorerFile = page
    .locator(".explorer-folders-view .label-name")
    .filter({ hasText: new RegExp(`^${escapeForRegExp(baseName)}$`, "i") })
    .first();
  const openedFromExplorer = await (async () => {
    try {
      await expect(explorerFile).toBeVisible({ timeout: 5_000 });
      await explorerFile.dblclick();
      return await waitForOpenTab(page, baseName, 5_000);
    } catch {
      return false;
    }
  })();
  if (openedFromExplorer) {
    return;
  }

  const candidateQueries = Array.from(
    new Set([relativePath, relativePath.replace(/\\/g, "/"), baseName]),
  );
  for (const query of candidateQueries) {
    await page.keyboard.press(`${COMMAND_MODIFIER}+P`);
    const quickOpenInput = page.locator(".quick-input-widget input.input:visible").last();
    await expect(quickOpenInput).toBeVisible({ timeout: 10_000 });
    await quickOpenInput.fill(query);
    const quickOpenRows = page.locator(".quick-input-widget .quick-input-list .monaco-list-row");
    await waitForCondition(async () => (await quickOpenRows.count()) > 0, 3_000).catch(
      () => undefined,
    );
    await page.keyboard.press("Enter");
    if (await waitForOpenTab(page, baseName, 10_000)) {
      return;
    }
    await page.keyboard.press("Escape").catch(() => undefined);
  }
  throw new Error(`Failed to open target file in editor: ${relativePath}`);
}

export async function executeCommandFromPalette(
  page: Page,
  commandTitle: string | readonly string[],
): Promise<string> {
  const commandCandidates = Array.isArray(commandTitle) ? [...commandTitle] : [commandTitle];

  for (const candidate of commandCandidates) {
    const widget = await openCommandPalette(page);
    await page.keyboard.press(`${COMMAND_MODIFIER}+A`);
    await page.keyboard.type(`>${candidate}`);
    const matchingRow = widget
      .locator(".quick-input-list .monaco-list-row")
      .filter({ hasText: new RegExp(escapeForRegExp(candidate), "i") })
      .first();
    if ((await matchingRow.count()) > 0 && (await matchingRow.isVisible())) {
      await page.keyboard.press("Enter");
      return candidate;
    }
    await page.keyboard.press("Escape");
  }

  const finalWidget = page.locator(".quick-input-widget:visible").last();
  const rowLabels = await finalWidget
    .locator(".quick-input-list .monaco-list-row .label-name")
    .allInnerTexts();
  throw new Error(
    [
      `Unable to resolve command from palette. candidates=${commandCandidates.join(" | ")}`,
      `visibleRows=${
        rowLabels
          .map((label) => label.trim())
          .filter((label) => label.length > 0)
          .join(" | ") || "(none)"
      }`,
    ].join("\n"),
  );
}

export async function createReviewCommentFromCommandPalette(
  page: Page,
  commentText: string,
): Promise<void> {
  await createCommentFromCommandPalette(page, {
    mode: "line",
    commentText,
  });
}

export async function createFileCommentFromCommandPalette(
  page: Page,
  commentText: string,
): Promise<void> {
  await createCommentFromCommandPalette(page, {
    mode: "file",
    commentText,
  });
}

export async function openEmptyCommentThreadAtCurrentLine(page: Page): Promise<void> {
  const lineNumber = page
    .locator(".margin-view-overlays .line-numbers")
    .filter({ hasText: /^2$/ })
    .first();
  if ((await lineNumber.count()) > 0 && (await lineNumber.isVisible().catch(() => false))) {
    await lineNumber.hover();
  }

  const glyphs = page.locator(".cldr.comment-range-glyph.comment-diff-added:visible");
  const hasGlyph = await waitForCondition(async () => (await glyphs.count()) > 0, 10_000)
    .then(() => true)
    .catch(() => false);
  if (!hasGlyph) {
    const visibleGlyphClasses = await page
      .locator(".cldr.comment-range-glyph:visible")
      .evaluateAll((elements) => {
        return elements
          .map((element) => element.className ?? "")
          .map((className) => className.trim())
          .filter((className) => className.length > 0);
      });
    throw new Error(
      [
        "Unable to find a commentable diff glyph for opening an empty thread.",
        `visibleCommentGlyphs=${visibleGlyphClasses.join(" | ") || "(none)"}`,
      ].join(" "),
    );
  }

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const glyphCount = await glyphs.count();
    for (let index = 0; index < glyphCount; index += 1) {
      const glyph = glyphs.nth(index);
      if (!(await glyph.isVisible().catch(() => false))) {
        continue;
      }
      await glyph.click({ force: true });
      const widget = await waitForEmptyCommentThreadWidget(page, 3_000)
        .then((matched) => matched)
        .catch(() => undefined);
      if (widget) {
        return;
      }
    }
    await page.keyboard.press("Escape").catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 200 * attempt));
  }

  const visibleButtons = await page
    .locator(
      ".comment-thread-widget:visible a.monaco-button:visible, .comment-thread-widget:visible button.monaco-button:visible, .comment-thread-widget:visible button:visible",
    )
    .evaluateAll((elements) => {
      return elements
        .map((element) => {
          const ariaLabel = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
          if (ariaLabel.length > 0) {
            return ariaLabel;
          }
          return (element.textContent ?? "").replace(/\s+/g, " ").trim();
        })
        .filter((label) => label.length > 0);
    });
  throw new Error(
    `Failed to open empty comment thread from diff glyph. visibleButtons=${visibleButtons.join(" | ") || "(none)"}`,
  );
}

export async function typeDraftInEmptyCommentThread(
  page: Page,
  commentText: string,
): Promise<void> {
  const widget = await waitForEmptyCommentThreadWidget(page);
  const placeholder = widget
    .locator("div.editorPlaceholder")
    .filter({ hasText: /^Leave a comment$/i })
    .first();
  if ((await placeholder.count()) > 0 && (await placeholder.isVisible().catch(() => false))) {
    await placeholder.click({ force: true });
    await page.keyboard.press(`${COMMAND_MODIFIER}+A`);
    await page.keyboard.press("Backspace");
    await page.keyboard.type(commentText);
    return;
  }

  const textbox = widget
    .locator("[role='textbox']:visible, textarea:visible, input.input:visible")
    .first();
  if ((await textbox.count()) > 0 && (await textbox.isVisible().catch(() => false))) {
    await textbox.click({ force: true });
    await page.keyboard.press(`${COMMAND_MODIFIER}+A`);
    await page.keyboard.press("Backspace");
    await page.keyboard.type(commentText);
    return;
  }

  throw new Error("Unable to focus empty comment thread input.");
}

export async function clickEmptyCommentThreadButton(
  page: Page,
  ariaPrefixes: readonly string[],
): Promise<string> {
  const widget = await waitForEmptyCommentThreadWidget(page);
  const normalizedPrefixes = ariaPrefixes.map((prefix) => prefix.toLowerCase());
  const buttons = widget.locator(
    "a.monaco-button[aria-label], button.monaco-button[aria-label], button[aria-label], a.monaco-button, button.monaco-button, button",
  );
  const buttonCount = await buttons.count();
  for (let index = 0; index < buttonCount; index += 1) {
    const candidate = buttons.nth(index);
    const isVisible = await candidate.isVisible({ timeout: 300 }).catch(() => false);
    if (!isVisible) {
      continue;
    }
    const ariaLabel = normalizeWhitespace(
      (await candidate.getAttribute("aria-label", { timeout: 300 }).catch(() => null)) ?? "",
    );
    const label =
      ariaLabel.length > 0
        ? ariaLabel
        : normalizeWhitespace(
            (await candidate.textContent({ timeout: 300 }).catch(() => null)) ?? "",
          );
    if (label.length === 0) {
      continue;
    }
    const normalizedLabel = label.toLowerCase();
    if (!normalizedPrefixes.some((prefix) => normalizedLabel.startsWith(prefix))) {
      continue;
    }
    await candidate.click({ force: true });
    return label;
  }

  const visibleButtonLabels = await buttons.evaluateAll((elements) => {
    return elements
      .map((element) => {
        const ariaLabel = (element.getAttribute("aria-label") ?? "").replace(/\s+/g, " ").trim();
        if (ariaLabel.length > 0) {
          return ariaLabel;
        }
        return (element.textContent ?? "").replace(/\s+/g, " ").trim();
      })
      .filter((label) => label.length > 0);
  });
  throw new Error(
    [
      `Unable to resolve empty-thread button. prefixes=${ariaPrefixes.join(" | ")}`,
      `visibleButtons=${visibleButtonLabels.join(" | ") || "(none)"}`,
    ].join(" "),
  );
}

export async function clickLocalReviewAction(page: Page): Promise<void> {
  const candidates = [
    ".title-actions .action-label[aria-label*='Local Review']",
    ".title-actions .action-label:has-text('Local Review')",
    ".editor-actions .action-label[aria-label*='Local Review']",
  ];

  let actionLocator: Locator | undefined;
  await waitForCondition(async () => {
    for (const selector of candidates) {
      const candidate = page.locator(selector).first();
      if ((await candidate.count()) === 0) {
        continue;
      }
      if (await candidate.isVisible()) {
        actionLocator = candidate;
        return true;
      }
    }
    return false;
  }, 30_000);

  if (!actionLocator) {
    throw new Error("Local Review action was not found in editor title.");
  }
  await actionLocator.click();
}

export async function waitForPreviewFrame(page: Page): Promise<Frame> {
  let matchedFrame = await findPreviewFrame(page);
  if (!matchedFrame) {
    await waitForCondition(async () => {
      matchedFrame = await findPreviewFrame(page);
      return matchedFrame !== undefined;
    }, 60_000);
  }
  if (!matchedFrame) {
    throw new Error(`Preview webview frame was not found.\n${await formatFrameDiagnostics(page)}`);
  }
  return matchedFrame;
}

export async function waitForPreviewFrameClosed(page: Page): Promise<void> {
  await waitForCondition(async () => {
    const previewFrame = await findPreviewFrame(page);
    return previewFrame === undefined;
  }, 60_000);
}

export async function hasPreviewFrame(page: Page): Promise<boolean> {
  return (await findPreviewFrame(page)) !== undefined;
}

export function readClipboardText(): string {
  return execFileSync("pbpaste", { encoding: "utf8" });
}

export function writeClipboardText(text: string): void {
  execFileSync("pbcopy", { input: text, encoding: "utf8" });
}

export async function waitForReviewReady(page: Page): Promise<void> {
  await waitForStatusBarText(page, ["Submit Review"], 30_000);
}

export async function waitForStatusBarText(
  page: Page,
  textCandidates: readonly string[],
  timeoutMs = 30_000,
): Promise<void> {
  const statusBar = page.locator(".part.statusbar");
  await expect(statusBar).toBeVisible({ timeout: timeoutMs });
  await waitForCondition(async () => {
    const statusText = normalizeWhitespace(await statusBar.innerText());
    return textCandidates.some((candidate) => statusText.includes(candidate));
  }, timeoutMs);
}

export async function clickCommentActionIcon(
  page: Page,
  ariaLabel: "Edit Comment" | "Discard Comment",
): Promise<void> {
  const icon = page
    .locator(`a.action-label[aria-label='${ariaLabel}'], button[aria-label='${ariaLabel}']`)
    .first();
  await expect(icon).toBeVisible({ timeout: 10_000 });
  await icon.click({ force: true });
}

export async function clickCommentActionIconForComment(
  page: Page,
  commentText: string,
  ariaLabel: "Edit Comment" | "Discard Comment",
): Promise<void> {
  const commentItem = page.locator(".review-comment").filter({ hasText: commentText }).first();
  await expect(commentItem).toBeVisible({ timeout: 10_000 });
  await commentItem.hover();
  const icon = commentItem
    .locator(`a.action-label[aria-label='${ariaLabel}'], button[aria-label='${ariaLabel}']`)
    .first();
  await expect(icon).toBeVisible({ timeout: 10_000 });
  await icon.click({ force: true });
}

export async function clickCommentThreadButton(
  page: Page,
  ariaPrefixes: readonly string[],
): Promise<string> {
  let matched: { locator: Locator; ariaLabel: string } | undefined;
  await waitForCondition(async () => {
    matched = await findVisibleElementByAriaPrefix(
      page,
      ".comment-thread-widget a.monaco-button[aria-label], .comment-thread-widget button.monaco-button[aria-label], a.monaco-button[aria-label], button.monaco-button[aria-label], button[aria-label]",
      ariaPrefixes,
    );
    return matched !== undefined;
  }, 10_000).catch(() => undefined);
  if (!matched) {
    const textMatched = await findVisibleElementByTextPrefix(
      page,
      ".comment-thread-widget a.monaco-button:visible, .comment-thread-widget button.monaco-button:visible, .comment-thread-widget button:visible, a.monaco-button:visible, button.monaco-button:visible, button:visible",
      ariaPrefixes,
    );
    if (textMatched) {
      await textMatched.locator.click({ force: true });
      return textMatched.label;
    }
    const visibleAriaLabels = await page
      .locator(
        "a.monaco-button[aria-label]:visible, button.monaco-button[aria-label]:visible, button[aria-label]:visible",
      )
      .evaluateAll((elements) => {
        return elements
          .map((element) => element.getAttribute("aria-label") ?? "")
          .map((ariaLabel) => ariaLabel.trim())
          .filter((ariaLabel) => ariaLabel.length > 0);
      });
    const visibleButtonLabels = await page
      .locator("a.monaco-button:visible, button.monaco-button:visible, button:visible")
      .evaluateAll((elements) => {
        return elements
          .map((element) => element.textContent ?? "")
          .map((text) => text.replace(/\s+/g, " ").trim())
          .filter((text) => text.length > 0);
      });
    throw new Error(
      [
        `Unable to resolve comment-thread button. prefixes=${ariaPrefixes.join(" | ")}`,
        `visibleAria=${visibleAriaLabels.join(" | ") || "(none)"}`,
        `visibleText=${visibleButtonLabels.join(" | ") || "(none)"}`,
      ].join(" "),
    );
  }
  await matched.locator.click({ force: true });
  return matched.ariaLabel;
}

export async function fillEditableCommentInput(page: Page, commentText: string): Promise<void> {
  const directInput = page
    .locator(
      ".review-comment textarea:visible, .review-comment input.input:visible[placeholder*='Example:'], .comment-thread-widget textarea:visible, .comment-thread-widget input.input:visible[placeholder*='Example:']",
    )
    .first();
  if ((await directInput.count()) > 0 && (await directInput.isVisible().catch(() => false))) {
    await directInput.fill(commentText);
    return;
  }

  const editContextTextbox = page
    .locator(
      ".comment-thread-widget .edit-container [role='textbox']:visible, .comment-thread-widget .edit-container .native-edit-context:visible",
    )
    .first();
  const editMonacoEditor = page
    .locator(".comment-thread-widget .edit-container .monaco-editor:visible")
    .first();
  if (
    (await editMonacoEditor.count()) > 0 &&
    (await editMonacoEditor.isVisible().catch(() => false))
  ) {
    await editMonacoEditor.click({ force: true, position: { x: 24, y: 24 } });
    await page.keyboard.press(`${COMMAND_MODIFIER}+A`);
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(commentText);
    return;
  }

  if (
    (await editContextTextbox.count()) > 0 &&
    (await editContextTextbox.isVisible().catch(() => false))
  ) {
    await editContextTextbox.click({ force: true });
    await page.keyboard.press(`${COMMAND_MODIFIER}+A`);
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(commentText);
    return;
  }

  const threadedTextbox = page
    .locator(
      ".comment-thread-widget [role='textbox']:visible, .review-widget [role='textbox']:visible",
    )
    .first();
  if (
    (await threadedTextbox.count()) > 0 &&
    (await threadedTextbox.isVisible().catch(() => false))
  ) {
    await threadedTextbox.click({ force: true });
    await page.keyboard.press(`${COMMAND_MODIFIER}+A`);
    await page.keyboard.insertText(commentText);
    return;
  }

  await page.keyboard.press(`${COMMAND_MODIFIER}+A`);
  await page.keyboard.insertText(commentText);
}

export async function waitForCommentEditMode(page: Page, timeoutMs = 10_000): Promise<void> {
  const updateButton = page
    .locator(
      ".comment-thread-widget button:has-text('Update'), .comment-thread-widget a.monaco-button:has-text('Update'), .review-widget button:has-text('Update')",
    )
    .first();
  await expect(updateButton).toBeVisible({ timeout: timeoutMs });
}

export async function typeReplyDraft(page: Page, commentText: string): Promise<void> {
  const placeholder = page
    .locator("div.editorPlaceholder")
    .filter({ hasText: /^Leave a comment$/i })
    .first();
  const isPlaceholderVisible = await waitForCondition(async () => {
    if (await placeholder.isVisible().catch(() => false)) {
      return true;
    }
    const firstReviewComment = page.locator(".review-comment").first();
    if ((await firstReviewComment.count()) > 0) {
      await firstReviewComment.click({ force: true });
    }
    return await placeholder.isVisible().catch(() => false);
  }, 10_000)
    .then(() => true)
    .catch(() => false);

  if (isPlaceholderVisible) {
    await placeholder.click({ force: true });
    await page.keyboard.type(commentText);
    return;
  }

  const commentForm = page.locator(".comment-form").first();
  if ((await commentForm.count()) > 0) {
    await commentForm.click({ force: true });
    await page.keyboard.type(commentText);
    return;
  }

  throw new Error("Unable to focus reply draft input in comment thread.");
}

export async function restoreSessionFromReloadPrompt(page: Page): Promise<boolean> {
  const hasPrompt = await waitForCondition(async () => {
    const prompt = page.locator(
      "text=/A previous Local Review session was found\\. Do you want to restore it\\?/i",
    );
    return (await prompt.count()) > 0;
  }, 30_000)
    .then(() => true)
    .catch(() => false);

  if (!hasPrompt) {
    return false;
  }

  const restoreButton = page
    .locator(
      "a.action-label:has-text('Restore'), button:has-text('Restore'), .action-label:has-text('Restore')",
    )
    .first();
  const hasRestoreButton = await waitForCondition(
    async () => (await restoreButton.count()) > 0 && (await restoreButton.isVisible()),
    10_000,
  )
    .then(() => true)
    .catch(() => false);
  if (!hasRestoreButton) {
    return false;
  }
  await restoreButton.click({ force: true });
  return true;
}

async function waitForWorkbenchPage(browser: Browser): Promise<Page> {
  let matchedPage: Page | undefined;
  await waitForCondition(
    async () => {
      for (const context of browser.contexts()) {
        for (const page of context.pages()) {
          const workbench = page.locator(".monaco-workbench");
          if ((await workbench.count()) > 0) {
            matchedPage = page;
            return true;
          }
        }
      }
      return false;
    },
    90_000,
    250,
  );
  if (!matchedPage) {
    throw new Error("Timed out while waiting for VS Code workbench page.");
  }
  return matchedPage;
}

async function openCommandPalette(page: Page): Promise<Locator> {
  await page.keyboard.press(`${COMMAND_MODIFIER}+Shift+P`);
  let hasVisibleInput = false;
  try {
    await waitForVisibleInputByPlaceholder(
      page,
      (placeholder) => placeholder.includes("Type the name of a command to run."),
      2_000,
    );
    hasVisibleInput = true;
  } catch {
    hasVisibleInput = false;
  }
  if (!hasVisibleInput) {
    await page.keyboard.press("F1");
    await waitForVisibleInputByPlaceholder(
      page,
      (placeholder) => placeholder.includes("Type the name of a command to run."),
      10_000,
    );
  }
  const widget = page.locator(".quick-input-widget:visible").last();
  await expect(widget).toBeVisible({ timeout: 10_000 });
  return widget;
}

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", (error) => {
      reject(error);
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => {
          reject(new Error("Unable to resolve an available local port."));
        });
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function findPreviewFrame(page: Page): Promise<Frame | undefined> {
  for (const frame of page.frames()) {
    try {
      const markdownEditor = frame.locator("[data-testid='preview-markdown-editor']");
      if ((await markdownEditor.count()) > 0) {
        return frame;
      }
    } catch {
      // Ignore detached frames.
    }
  }

  const iframeHandles = await page.locator("iframe.webview.ready, iframe.webview").elementHandles();
  for (const iframeHandle of iframeHandles) {
    try {
      const frame = await iframeHandle.contentFrame();
      if (!frame) {
        continue;
      }
      const markdownEditor = frame.locator("[data-testid='preview-markdown-editor']");
      if ((await markdownEditor.count()) > 0) {
        return frame;
      }
    } catch {
      // Ignore detached or inaccessible iframes.
    }
  }

  return undefined;
}

async function formatFrameDiagnostics(page: Page): Promise<string> {
  const frameUrls = page
    .frames()
    .map((frame) => frame.url())
    .filter((url) => url.length > 0);
  const tabNames = await page.locator(".tabs-container .tab .label-name").allInnerTexts();
  const visibleTabs = tabNames
    .map((tabName) => tabName.trim())
    .filter((tabName) => tabName.length > 0);

  return [
    `Open tab labels: ${visibleTabs.join(", ") || "(none)"}`,
    `Detected frame URLs: ${frameUrls.join(", ") || "(none)"}`,
  ].join("\n");
}

async function waitForEmptyCommentThreadWidget(page: Page, timeoutMs = 10_000): Promise<Locator> {
  let matchedWidget = await findEmptyCommentThreadWidget(page);
  if (matchedWidget) {
    return matchedWidget;
  }
  await waitForCondition(
    async () => {
      matchedWidget = await findEmptyCommentThreadWidget(page);
      return matchedWidget !== undefined;
    },
    timeoutMs,
    100,
  );
  if (!matchedWidget) {
    throw new Error("Empty comment thread widget was not found.");
  }
  return matchedWidget;
}

async function findEmptyCommentThreadWidget(page: Page): Promise<Locator | undefined> {
  const widgets = page.locator(".comment-thread-widget:visible");
  const widgetCount = await widgets.count();
  for (let index = widgetCount - 1; index >= 0; index -= 1) {
    const candidate = widgets.nth(index);
    const copyBlockButton = candidate
      .locator(
        "a.monaco-button[aria-label^='Copy block'], button.monaco-button[aria-label^='Copy block'], a.monaco-button:has-text('Copy block'), button.monaco-button:has-text('Copy block')",
      )
      .first();
    if ((await copyBlockButton.count()) === 0) {
      continue;
    }
    if (!(await copyBlockButton.isVisible().catch(() => false))) {
      continue;
    }
    return candidate;
  }
  return undefined;
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function acceptIfCommandPaletteInputRemains(page: Page): Promise<void> {
  const visibleInput = await findVisibleInputByPlaceholder(page, (placeholder) =>
    placeholder.includes("Type the name of a command to run."),
  );
  if (!visibleInput || !(await visibleInput.isVisible())) {
    return;
  }
  await page.keyboard.press("Enter");
}

async function waitForOpenTab(page: Page, fileName: string, timeoutMs: number): Promise<boolean> {
  try {
    await waitForCondition(
      async () => {
        const tabLabels = await page.locator(".tabs-container .tab .label-name").allInnerTexts();
        return tabLabels.some((tabLabel) => tabLabel.trim() === fileName);
      },
      timeoutMs,
      100,
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForVisibleInputByPlaceholder(
  page: Page,
  matcher: (placeholder: string) => boolean,
  timeoutMs: number,
): Promise<Locator> {
  let matchedInput: Locator | undefined;
  await waitForCondition(
    async () => {
      const input = await findVisibleInputByPlaceholder(page, matcher);
      if (!input) {
        return false;
      }
      matchedInput = input;
      return true;
    },
    timeoutMs,
    100,
  );
  if (!matchedInput) {
    throw new Error("Expected visible input was not found.");
  }
  return matchedInput;
}

async function findVisibleInputByPlaceholder(
  page: Page,
  matcher: (placeholder: string) => boolean,
): Promise<Locator | undefined> {
  const inputs = page.locator("input.input:visible");
  const inputCount = await inputs.count();
  for (let index = 0; index < inputCount; index += 1) {
    const candidate = inputs.nth(index);
    const placeholder =
      (await candidate.getAttribute("placeholder", { timeout: 300 }).catch(() => null)) ?? "";
    if (matcher(placeholder)) {
      return candidate;
    }
  }
  return undefined;
}

async function findVisibleElementByAriaPrefix(
  page: Page,
  selector: string,
  prefixes: readonly string[],
): Promise<{ locator: Locator; ariaLabel: string } | undefined> {
  const normalizedPrefixes = prefixes.map((prefix) => prefix.toLowerCase());
  const elements = page.locator(selector);
  const elementCount = await elements.count();
  for (let index = 0; index < elementCount; index += 1) {
    const candidate = elements.nth(index);
    const isVisible = await candidate.isVisible({ timeout: 300 }).catch(() => false);
    if (!isVisible) {
      continue;
    }
    const rawAriaLabel =
      (await candidate.getAttribute("aria-label", { timeout: 300 }).catch(() => null)) ?? "";
    const ariaLabel = normalizeWhitespace(rawAriaLabel);
    if (ariaLabel.length === 0) {
      continue;
    }
    const normalizedAriaLabel = ariaLabel.toLowerCase();
    if (normalizedPrefixes.some((prefix) => normalizedAriaLabel.startsWith(prefix))) {
      return {
        locator: candidate,
        ariaLabel,
      };
    }
  }
  return undefined;
}

async function findVisibleElementByTextPrefix(
  page: Page,
  selector: string,
  prefixes: readonly string[],
): Promise<{ locator: Locator; label: string } | undefined> {
  const normalizedPrefixes = prefixes.map((prefix) => prefix.toLowerCase());
  const elements = page.locator(selector);
  const elementCount = await elements.count();
  for (let index = 0; index < elementCount; index += 1) {
    const candidate = elements.nth(index);
    const isVisible = await candidate.isVisible({ timeout: 300 }).catch(() => false);
    if (!isVisible) {
      continue;
    }
    const textContent = normalizeWhitespace(
      (await candidate.textContent({ timeout: 300 }).catch(() => null)) ?? "",
    );
    if (textContent.length === 0) {
      continue;
    }
    const normalized = textContent.toLowerCase();
    if (normalizedPrefixes.some((prefix) => normalized.startsWith(prefix))) {
      return {
        locator: candidate,
        label: textContent,
      };
    }
  }
  return undefined;
}

async function trySubmitCommentInput(page: Page, commentText: string): Promise<boolean> {
  const quickInput = await findVisibleInputByPlaceholder(
    page,
    (placeholder) =>
      placeholder.includes("Example:") || placeholder.includes("Enter review comment"),
  );
  if (quickInput && (await quickInput.isVisible())) {
    await quickInput.fill(commentText);
    await page.keyboard.press("Enter");
    return true;
  }

  const commentTextarea = page
    .locator("textarea[placeholder='Leave a comment'], textarea[aria-label*='comment']")
    .last();
  if ((await commentTextarea.count()) > 0 && (await commentTextarea.isVisible())) {
    await commentTextarea.fill(commentText);
    const submitButton = page
      .locator("button")
      .filter({ hasText: /^(Start a review|Comment)$/ })
      .last();
    await expect(submitButton).toBeVisible({ timeout: 10_000 });
    await submitButton.click();
    return true;
  }
  return false;
}

async function createCommentFromCommandPalette(
  page: Page,
  options: {
    readonly mode: LocalReviewCommentMode;
    readonly commentText: string;
  },
): Promise<void> {
  const commandCandidates =
    options.mode === "line"
      ? (["Local Review for AI: Add Review Comment", "Add Review Comment"] as const)
      : (["Local Review for AI: Add File Comment", "Add File Comment"] as const);
  const modeLabel = options.mode === "line" ? "Add Review Comment" : "Add File Comment";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await executeCommandFromPalette(page, commandCandidates);
    await acceptIfCommandPaletteInputRemains(page);
    if (await trySubmitCommentInput(page, options.commentText)) {
      await waitForReviewReady(page);
      return;
    }
    await page.keyboard.press("Escape");
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }

  const debugScreenshotPath = path.join(
    process.cwd(),
    "test-results",
    `${COMMENT_INPUT_DEBUG_PREFIX}-${options.mode}-${Date.now()}.png`,
  );
  await page.screenshot({ path: debugScreenshotPath, fullPage: true });
  const tabNames = await page.locator(".tabs-container .tab .label-name").allInnerTexts();
  const notificationTexts = await page
    .locator(".notifications-toasts .notification-list-item, .notification-toast")
    .allInnerTexts();
  throw new Error(
    [
      `Comment input UI did not appear after running ${modeLabel}.`,
      `debugScreenshot=${debugScreenshotPath}`,
      `openTabs=${tabNames.map((name) => name.trim()).join(", ") || "(none)"}`,
      `notifications=${notificationTexts.map((text) => normalizeWhitespace(text)).join(" | ") || "(none)"}`,
    ].join("\n"),
  );
}
