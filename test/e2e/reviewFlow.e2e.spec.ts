import { readFile, rm } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

import {
  clickCommentActionIconForComment,
  clickCommentThreadButton,
  clickLocalReviewAction,
  closeVsCodeForE2e,
  createFileCommentFromCommandPalette,
  createReviewCommentFromCommandPalette,
  executeCommandFromPalette,
  hasPreviewFrame,
  launchVsCodeForE2e,
  openFileWithQuickOpen,
  readClipboardText,
  restoreSessionFromReloadPrompt,
  typeReplyDraft,
  waitForCondition,
  waitForPreviewFrame,
  waitForPreviewFrameClosed,
  waitForStatusBarText,
  type E2eLaunchContext,
} from "./e2eHelpers";
// @ts-ignore test workspace helper is intentionally authored as runtime .mjs.
import {
  createTempGitWorkspace,
  createTempMultiRootWorkspace,
  createTempWorkspaceWithoutGit,
} from "../shared/testWorkspace.mjs";

const projectRoot = process.cwd();

interface ScenarioWorkspace {
  readonly workspacePath: string;
  readonly targetRelativePath: string;
  readonly cleanupPath?: string;
}

interface E2eScenarioContext {
  readonly page: Page;
  readonly workspace: ScenarioWorkspace;
}

test.describe.configure({ mode: "serial" });

function createMarker(prefix: string): string {
  return `E2E_${prefix}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

async function runE2eScenario(
  scenario: (context: E2eScenarioContext) => Promise<void>,
): Promise<void> {
  const workspace = await createTempGitWorkspace("local-review-for-ai-e2e-");
  let launchContext: E2eLaunchContext | undefined;
  try {
    launchContext = await launchVsCodeForE2e({
      extensionDevelopmentPath: projectRoot,
      workspacePath: workspace.workspacePath,
    });
    await scenario({
      page: launchContext.page,
      workspace,
    });
  } finally {
    if (launchContext) {
      await closeVsCodeForE2e(launchContext);
    }
    await rm(workspace.cleanupPath ?? workspace.workspacePath, { recursive: true, force: true });
  }
}

async function runE2eScenarioWithWorkspace<TWorkspace extends ScenarioWorkspace>(
  workspaceFactory: () => Promise<TWorkspace>,
  scenario: (context: { readonly page: Page; readonly workspace: TWorkspace }) => Promise<void>,
): Promise<void> {
  const workspace = await workspaceFactory();
  let launchContext: E2eLaunchContext | undefined;
  try {
    launchContext = await launchVsCodeForE2e({
      extensionDevelopmentPath: projectRoot,
      workspacePath: workspace.workspacePath,
    });
    await scenario({
      page: launchContext.page,
      workspace,
    });
  } finally {
    if (launchContext) {
      await closeVsCodeForE2e(launchContext);
    }
    await rm(workspace.cleanupPath ?? workspace.workspacePath, { recursive: true, force: true });
  }
}

async function copyMarkdownFromCommand(
  page: Page,
  expectedMarker: string,
  timeoutMs = 30_000,
): Promise<string> {
  await executeCommandFromPalette(page, "Local Review for AI: Copy");
  await waitForCondition(() => readClipboardText().includes(expectedMarker), timeoutMs);
  return readClipboardText();
}

async function readPreviewMarkdown(page: Page): Promise<string> {
  await clickLocalReviewAction(page);
  const previewFrame = await waitForPreviewFrame(page);
  const markdownEditor = previewFrame.locator("[data-testid='preview-markdown-editor']");
  await expect(markdownEditor).toBeVisible({ timeout: 30_000 });
  const markdown = await markdownEditor.inputValue();
  await previewFrame.locator("[data-testid='preview-cancel']").click();
  await waitForPreviewFrameClosed(page);
  return markdown;
}

test("行コメント追加からプレビュー編集/Copy/Cancel/Discardまで正常動作すること", async () => {
  const commentMarker = createMarker("line");
  const previewMarker = createMarker("preview");

  await runE2eScenario(async ({ page, workspace }) => {
    await openFileWithQuickOpen(page, workspace.targetRelativePath);
    await createReviewCommentFromCommandPalette(page, commentMarker);

    await clickLocalReviewAction(page);
    let previewFrame = await waitForPreviewFrame(page);

    const markdownEditor = previewFrame.locator("[data-testid='preview-markdown-editor']");
    const renderedPanel = previewFrame.locator("[data-testid='preview-rendered-panel']");
    await expect(markdownEditor).toBeVisible({ timeout: 30_000 });
    await expect(renderedPanel).toBeVisible({ timeout: 30_000 });

    const originalMarkdown = await markdownEditor.inputValue();
    await markdownEditor.fill(`${originalMarkdown}\n${previewMarker}`);
    await expect(renderedPanel).toContainText(previewMarker, { timeout: 30_000 });

    await previewFrame.locator("[data-testid='preview-copy']").click();
    await waitForCondition(() => readClipboardText().includes(previewMarker), 30_000);
    expect(readClipboardText()).toContain(previewMarker);

    await previewFrame.locator("[data-testid='preview-cancel']").click();
    await waitForPreviewFrameClosed(page);

    await clickLocalReviewAction(page);
    previewFrame = await waitForPreviewFrame(page);
    const reopenedEditor = previewFrame.locator("[data-testid='preview-markdown-editor']");
    await expect(reopenedEditor).toBeVisible({ timeout: 30_000 });
    const reopenedMarkdown = await reopenedEditor.inputValue();
    expect(reopenedMarkdown).not.toContain(previewMarker);

    await previewFrame.locator("[data-testid='preview-discard']").click();
    await waitForPreviewFrameClosed(page);

    await executeCommandFromPalette(page, [
      "Local Review for AI: preview and copy",
      "preview and copy",
    ]);
    await waitForCondition(async () => !(await hasPreviewFrame(page)), 5_000);
  });
});

test("ファイルコメント追加後にCopyコマンドでMarkdownをクリップボードへ出力できること", async () => {
  const warmupMarker = createMarker("file-warmup");
  const fileCommentMarker = createMarker("file");

  await runE2eScenario(async ({ page, workspace }) => {
    await openFileWithQuickOpen(page, workspace.targetRelativePath);
    await createReviewCommentFromCommandPalette(page, warmupMarker);
    await createFileCommentFromCommandPalette(page, fileCommentMarker);

    await executeCommandFromPalette(page, "Local Review for AI: Copy");
    await waitForCondition(() => readClipboardText().includes(fileCommentMarker), 30_000);

    const copiedMarkdown = readClipboardText();
    expect(copiedMarkdown).toContain(fileCommentMarker);
    expect(copiedMarkdown).toMatch(/@[^ \n]+\/src\/sample\.ts/);
  });
});

test("差分内の未変更行にコメントすると Unchanged として出力されること", async () => {
  const unchangedMarker = createMarker("unchanged");

  await runE2eScenario(async ({ page, workspace }) => {
    await openFileWithQuickOpen(page, workspace.targetRelativePath);
    const lineOne = page
      .locator(".margin-view-overlays .line-numbers")
      .filter({ hasText: /^1$/ })
      .first();
    if ((await lineOne.count()) > 0 && (await lineOne.isVisible().catch(() => false))) {
      await lineOne.click({ force: true });
    }
    await createReviewCommentFromCommandPalette(page, unchangedMarker);

    const copiedMarkdown = await copyMarkdownFromCommand(page, unchangedMarker);
    expect(copiedMarkdown).toContain(unchangedMarker);
    expect(copiedMarkdown).toContain("- Line Status: Unchanged");
    expect(copiedMarkdown).toMatch(/- Line: \d+( - \d+)? \(Updated\)/);
  });
});

test("Git未初期化ワークスペースでもコメント作成とCopyができること", async () => {
  const marker = createMarker("plain-workspace");

  await runE2eScenarioWithWorkspace(
    () => createTempWorkspaceWithoutGit("local-review-for-ai-e2e-plain-"),
    async ({ page, workspace }) => {
      await openFileWithQuickOpen(page, workspace.targetRelativePath);
      await createReviewCommentFromCommandPalette(page, marker);

      const copiedMarkdown = await copyMarkdownFromCommand(page, marker);
      expect(copiedMarkdown).toContain(marker);
      expect(copiedMarkdown).toContain("- Line Status: Unchanged");
      expect(copiedMarkdown).toMatch(/@[^ \n]+\/src\/plain\.ts/);
    },
  );
});

test("multi-root で2ファイルにコメントして1つのMarkdownへ集約できること", async () => {
  const firstMarker = createMarker("multi-a");
  const secondMarker = createMarker("multi-b");

  await runE2eScenarioWithWorkspace(
    () => createTempMultiRootWorkspace("local-review-for-ai-e2e-multi-"),
    async ({ page, workspace }) => {
      const multiWorkspace = workspace as ScenarioWorkspace & {
        readonly firstFileRelativePath: string;
        readonly secondFileRelativePath: string;
      };

      await openFileWithQuickOpen(page, multiWorkspace.firstFileRelativePath);
      await createReviewCommentFromCommandPalette(page, firstMarker);

      await openFileWithQuickOpen(page, multiWorkspace.secondFileRelativePath);
      await createReviewCommentFromCommandPalette(page, secondMarker);

      const copiedMarkdown = await copyMarkdownFromCommand(page, secondMarker);
      expect(copiedMarkdown).toContain(firstMarker);
      expect(copiedMarkdown).toContain(secondMarker);
      expect(copiedMarkdown).toContain("@workspace-a/src/sample-a.ts");
      expect(copiedMarkdown).toContain("@workspace-b/src/sample-b.ts");
    },
  );
});

test("Comment/Reply・Cancelのスレッド操作が正常動作すること", async () => {
  const baseMarker = createMarker("thread-base");
  const replyMarker = createMarker("thread-reply");
  const cancelDraftMarker = createMarker("thread-cancel-draft");

  await runE2eScenario(async ({ page, workspace }) => {
    await openFileWithQuickOpen(page, workspace.targetRelativePath);
    await createReviewCommentFromCommandPalette(page, baseMarker);
    await typeReplyDraft(page, replyMarker);
    await clickCommentThreadButton(page, ["Comment", "Reply"]);
    const previewWithReply = await readPreviewMarkdown(page);
    expect(previewWithReply).toContain(baseMarker);
    expect(previewWithReply).toContain(replyMarker);

    await typeReplyDraft(page, cancelDraftMarker);
    await clickCommentThreadButton(page, ["Cancel"]);

    const previewAfterCancel = await readPreviewMarkdown(page);
    expect(previewAfterCancel).toContain(baseMarker);
    expect(previewAfterCancel).toContain(replyMarker);
    expect(previewAfterCancel).not.toContain(cancelDraftMarker);
  });
});

test("Edit/Update/Cancel/Discard Comment の公開定義とDiscard導線が正常動作すること", async () => {
  const originalMarker = createMarker("edit-original");

  await runE2eScenario(async ({ page, workspace }) => {
    await openFileWithQuickOpen(page, workspace.targetRelativePath);
    await createReviewCommentFromCommandPalette(page, originalMarker);

    await clickCommentActionIconForComment(page, originalMarker, "Discard Comment");
    await executeCommandFromPalette(page, [
      "Local Review for AI: preview and copy",
      "preview and copy",
    ]);
    await waitForCondition(async () => !(await hasPreviewFrame(page)), 5_000);
  });

  const packageJsonRaw = await readFile(`${projectRoot}/package.json`, "utf8");
  const packageJson = JSON.parse(packageJsonRaw) as {
    contributes?: {
      commands?: Array<{ command?: string }>;
      menus?: {
        "comments/comment/context"?: Array<{ command?: string; when?: string }>;
      };
    };
  };
  const commands = packageJson.contributes?.commands ?? [];
  expect(commands.some((command) => command.command === "localReviewForAi.editComment")).toBe(true);
  expect(commands.some((command) => command.command === "localReviewForAi.saveComment")).toBe(true);
  expect(commands.some((command) => command.command === "localReviewForAi.cancelComment")).toBe(
    true,
  );
  expect(commands.some((command) => command.command === "localReviewForAi.deleteComment")).toBe(
    true,
  );

  const commentContextMenus = packageJson.contributes?.menus?.["comments/comment/context"] ?? [];
  const saveEntry = commentContextMenus.find(
    (entry) => entry.command === "localReviewForAi.saveComment",
  );
  expect(saveEntry?.when?.includes("localReviewForAi.commentEditable")).toBe(true);
  const cancelEntry = commentContextMenus.find(
    (entry) => entry.command === "localReviewForAi.cancelComment",
  );
  expect(cancelEntry?.when?.includes("localReviewForAi.commentEditable")).toBe(true);
});

test("Reload後のRestore導線でセッション復元できること", async () => {
  const restoreMarker = createMarker("restore");

  await runE2eScenario(async ({ page, workspace }) => {
    await openFileWithQuickOpen(page, workspace.targetRelativePath);
    await createReviewCommentFromCommandPalette(page, restoreMarker);
    await executeCommandFromPalette(page, ["Developer: Reload Window"]);

    const restoredByPrompt = await restoreSessionFromReloadPrompt(page);
    if (!restoredByPrompt) {
      await executeCommandFromPalette(page, [
        "Local Review for AI: Restore Review",
        "Restore Review",
      ]);
    }

    await waitForStatusBarText(page, ["Submit Review"], 30_000);
    const restoredMarkdown = await copyMarkdownFromCommand(page, restoreMarker);
    expect(restoredMarkdown).toContain(restoreMarker);
  });
});

test("startReviewComment/createComment/cancelNewCommentThread の公開定義が維持されていること", async () => {
  const packageJsonRaw = await readFile(`${projectRoot}/package.json`, "utf8");
  const packageJson = JSON.parse(packageJsonRaw) as {
    contributes?: {
      commands?: Array<{ command?: string; title?: string }>;
      menus?: {
        "comments/commentThread/context"?: Array<{ command?: string; when?: string }>;
      };
    };
  };

  const commands = packageJson.contributes?.commands ?? [];
  expect(
    commands.some((command) => command.command === "localReviewForAi.startReviewComment"),
  ).toBe(true);
  expect(commands.some((command) => command.command === "localReviewForAi.createComment")).toBe(
    true,
  );
  expect(
    commands.some((command) => command.command === "localReviewForAi.cancelNewCommentThread"),
  ).toBe(true);

  const threadContextMenus =
    packageJson.contributes?.menus?.["comments/commentThread/context"] ?? [];
  const startReviewEntry = threadContextMenus.find(
    (entry) => entry.command === "localReviewForAi.startReviewComment",
  );
  expect(startReviewEntry?.when?.includes("commentThreadIsEmpty")).toBe(true);
  expect(startReviewEntry?.when?.includes("!localReviewForAi.hasComments")).toBe(true);

  const createCommentEntry = threadContextMenus.find(
    (entry) => entry.command === "localReviewForAi.createComment",
  );
  expect(createCommentEntry?.when?.includes("commentThreadIsEmpty")).toBe(true);
  expect(createCommentEntry?.when?.includes("localReviewForAi.hasComments")).toBe(true);

  const cancelNewThreadEntry = threadContextMenus.find(
    (entry) => entry.command === "localReviewForAi.cancelNewCommentThread",
  );
  expect(cancelNewThreadEntry?.when?.includes("commentThreadIsEmpty")).toBe(true);
});
