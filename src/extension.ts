import * as path from "node:path";
import * as vscode from "vscode";

import { buildDiffMap, type DiffMap, type DiffSide } from "./git/diffMapBuilder";
import { getGitApi } from "./git/gitApi";
import { GitStatus, type GitApi, type GitChange, type GitRepository } from "./git/gitTypes";
import {
  normalizeRelativePath,
  resolveRepositoryFromUri,
  toRelativePathFromRepoRoot,
} from "./git/repositoryResolver";
import { PreviewPanel } from "./preview/previewPanel";
import { classifyCommentTarget } from "./review/commentTargetClassifier";
import { CommentThreadRegistry } from "./review/commentThreadRegistry";
import { formatReviewMarkdown } from "./review/markdownFormatter";
import { formatOnetimeCopyBlock } from "./review/onetimeCopyFormatter";
import {
  discardSessionSnapshot,
  loadSessionSnapshot,
  saveSessionSnapshot,
} from "./review/reviewPersistence";
import { ReviewSessionService } from "./review/reviewSessionService";
import { getOutputChannel, logError } from "./logger";
import { updateContextKeys } from "./ui/contextKeyService";
import { StatusBarController } from "./ui/statusBarController";
import {
  createCommentId,
  buildWorkspaceSessionPath,
  getNowIsoUtc,
  hasNullByte,
  isPathLikelyBinary,
  makePathCacheKey,
  mapChangeStatusToFileStatus,
  expandLineRangeWithContext,
  readFileText,
  toCommandBody,
  toShortHead,
} from "./utils";

interface WorkspaceFileContext {
  readonly fileUri: vscode.Uri;
  readonly workspaceFolder: vscode.WorkspaceFolder;
  readonly relativePath: string;
  readonly sessionPath: string;
  readonly side: DiffSide;
}

interface ReviewTargetContext {
  readonly workspaceFileContext: WorkspaceFileContext;
  readonly side: DiffSide;
  readonly repository?: GitRepository;
  readonly repositoryRelativePath?: string;
  readonly diffMap?: DiffMap;
}

export function activate(context: vscode.ExtensionContext): void {
  const sessionService = new ReviewSessionService();
  const statusBarController = new StatusBarController();
  const commentController = vscode.comments.createCommentController(
    "local-review-for-ai",
    "Local Review for AI",
  );
  commentController.options = {
    prompt: "Leave a comment",
    placeHolder: "Leave a comment",
  };
  const threadRegistry = new CommentThreadRegistry(commentController);
  const diffMapCache = new Map<string, DiffMap>();
  let gitApiCached: GitApi | undefined;
  let gitApiResolved = false;

  const previewPanel = new PreviewPanel(context.extensionUri, {
    onCopyMarkdown: async (markdown: string) => {
      await vscode.commands.executeCommand("localReviewForAi.copyMarkdown", markdown);
    },
    onDiscardReview: async () => {
      await vscode.commands.executeCommand("localReviewForAi.discardReview");
    },
    onClosed: async () => {
      if (sessionService.getState() === "preview-open") {
        sessionService.closePreview();
        await persistAndRefreshUi();
      }
    },
  });

  context.subscriptions.push(
    statusBarController,
    previewPanel,
    commentController,
    threadRegistry,
    getOutputChannel(),
  );

  async function ensureGitApi(): Promise<GitApi | undefined> {
    if (!gitApiResolved) {
      gitApiCached = await getGitApi();
      gitApiResolved = true;
    }
    return gitApiCached;
  }

  async function refreshUi(): Promise<void> {
    const session = sessionService.getSession();
    statusBarController.update(session);
    await updateContextKeys(session);
  }

  async function persistSessionSnapshotIfPresent(): Promise<void> {
    const session = sessionService.getSession();
    if (!session) {
      return;
    }
    await saveSessionSnapshot(context.workspaceState, session);
  }

  async function persistAndRefreshUi(): Promise<void> {
    await Promise.all([persistSessionSnapshotIfPresent(), refreshUi()]);
  }

  function clearDiffMapCache(): void {
    diffMapCache.clear();
  }

  async function clearSessionState(): Promise<void> {
    threadRegistry.disposeAll();
    previewPanel.close();
    sessionService.clear();
    clearDiffMapCache();
    await discardSessionSnapshot(context.workspaceState);
    await refreshUi();
  }

  function resolveWorkspaceFileContext(uri: vscode.Uri): WorkspaceFileContext | undefined {
    const side: DiffSide = uri.scheme === "git" ? "original" : "modified";
    if (uri.scheme !== "git" && uri.scheme !== "file") {
      return undefined;
    }
    const fileUri = uri.scheme === "file" ? uri : vscode.Uri.file(uri.fsPath);
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(fileUri);
    if (!workspaceFolder) {
      return undefined;
    }
    const relativePath = normalizeRelativePath(
      path.relative(workspaceFolder.uri.fsPath, fileUri.fsPath),
    );
    if (relativePath.startsWith("..")) {
      return undefined;
    }
    return {
      fileUri,
      workspaceFolder,
      relativePath,
      sessionPath: buildWorkspaceSessionPath(workspaceFolder.name, relativePath),
      side,
    };
  }

  function findMatchingChange(
    repository: GitRepository,
    relativePath: string,
  ): GitChange | undefined {
    const changeSources = [repository.state.workingTreeChanges, repository.state.untrackedChanges];
    for (const changes of changeSources) {
      for (const change of changes) {
        const candidates: vscode.Uri[] = [change.uri, change.originalUri];
        if (change.renameUri) {
          candidates.push(change.renameUri);
        }
        for (const candidateUri of candidates) {
          const candidateRelativePath = normalizeRelativePath(
            toRelativePathFromRepoRoot(repository.rootUri.fsPath, candidateUri),
          );
          if (candidateRelativePath === relativePath) {
            return change;
          }
        }
      }
    }
    return undefined;
  }

  async function getOrBuildDiffMap(
    repository: GitRepository,
    repositoryRelativePath: string,
  ): Promise<DiffMap> {
    const cacheKey = makePathCacheKey(repository, repositoryRelativePath);
    const cached = diffMapCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const matchingChange = findMatchingChange(repository, repositoryRelativePath);
    const rawStatus = matchingChange?.status ?? GitStatus.MODIFIED;
    const fileStatus = mapChangeStatusToFileStatus(rawStatus);
    const originalRelativePath =
      fileStatus === "renamed" && matchingChange?.originalUri
        ? normalizeRelativePath(
            toRelativePathFromRepoRoot(repository.rootUri.fsPath, matchingChange.originalUri),
          )
        : repositoryRelativePath;
    const originalText =
      fileStatus === "untracked"
        ? ""
        : await repository.show("HEAD", originalRelativePath).catch((error) => {
            logError(`Failed to read HEAD:${originalRelativePath}`, error);
            return "";
          });
    const modifiedText =
      fileStatus === "deleted"
        ? ""
        : await readFileText(
            vscode.Uri.file(path.join(repository.rootUri.fsPath, repositoryRelativePath)),
          );
    const isBinary =
      isPathLikelyBinary(repositoryRelativePath) ||
      hasNullByte(originalText) ||
      hasNullByte(modifiedText);

    const diffMap = buildDiffMap({
      path: repositoryRelativePath,
      originalText,
      modifiedText,
      fileStatus: isBinary ? "binary" : fileStatus,
    });
    diffMapCache.set(cacheKey, diffMap);
    return diffMap;
  }

  async function getReviewTargetContextForUri(
    uri: vscode.Uri,
  ): Promise<ReviewTargetContext | undefined> {
    const workspaceFileContext = resolveWorkspaceFileContext(uri);
    if (!workspaceFileContext) {
      return undefined;
    }

    const gitApi = await ensureGitApi();
    if (!gitApi) {
      return {
        workspaceFileContext,
        side: workspaceFileContext.side,
      };
    }

    const repository =
      resolveRepositoryFromUri(gitApi, uri) ??
      resolveRepositoryFromUri(gitApi, workspaceFileContext.fileUri);
    if (!repository) {
      return {
        workspaceFileContext,
        side: workspaceFileContext.side,
      };
    }

    const repositoryRelativePath = normalizeRelativePath(
      toRelativePathFromRepoRoot(repository.rootUri.fsPath, workspaceFileContext.fileUri),
    );
    if (!repositoryRelativePath || repositoryRelativePath.startsWith("..")) {
      return {
        workspaceFileContext,
        side: workspaceFileContext.side,
      };
    }
    const diffMap = await getOrBuildDiffMap(repository, repositoryRelativePath);
    return {
      workspaceFileContext,
      side: workspaceFileContext.side,
      repository,
      repositoryRelativePath,
      diffMap,
    };
  }

  function getRangeLineSpan(
    range: vscode.Range | undefined,
  ): { startLineOneBased: number; endLineOneBased: number } | undefined {
    if (!range) {
      return undefined;
    }
    const startLineOneBased = range.start.line + 1;
    let endLineOneBased = range.end.line + 1;
    if (range.end.character === 0 && range.end.line > range.start.line) {
      endLineOneBased -= 1;
    }
    return {
      startLineOneBased,
      endLineOneBased: Math.max(startLineOneBased, endLineOneBased),
    };
  }

  async function getRangeSnippetAndLanguage(
    uri: vscode.Uri,
    startLineOneBased: number,
    endLineOneBased: number,
  ): Promise<{ code: string; language: string }> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const { startIndex, endIndex } = expandLineRangeWithContext(
        document.lineCount,
        startLineOneBased,
        endLineOneBased,
      );
      const endCharacter = document.lineAt(endIndex).range.end.character;
      const code = document.getText(new vscode.Range(startIndex, 0, endIndex, endCharacter));
      return {
        code,
        language: document.languageId,
      };
    } catch {
      return {
        code: "",
        language: "",
      };
    }
  }

  async function getDocumentTextAndLanguage(
    uri: vscode.Uri,
  ): Promise<{ code: string; language: string }> {
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      return {
        code: document.getText(),
        language: document.languageId,
      };
    } catch {
      return {
        code: "",
        language: "",
      };
    }
  }

  async function buildOnetimeCopyMarkdown(
    thread: vscode.CommentThread,
    draftComment?: string,
  ): Promise<string | undefined> {
    const targetContext = await getReviewTargetContextForUri(thread.uri);
    if (!targetContext) {
      return undefined;
    }
    const lineSpan = getRangeLineSpan(thread.range);
    const lineNumber = lineSpan?.startLineOneBased;
    const lineEndNumber = lineSpan?.endLineOneBased;
    const isBinary = targetContext.diffMap?.isBinary ?? false;
    const isFileLevel = thread.range === undefined || isBinary;
    const target = classifyCommentTarget({
      diffMap: targetContext.diffMap,
      side: targetContext.side,
      lineNumber,
      lineEndNumber,
      isFileLevel,
    });
    let code = "";
    let language = "";
    if (isBinary) {
      // Binary payload is represented by a fixed text block in formatter.
    } else if (lineNumber !== undefined && lineEndNumber !== undefined) {
      const snippet = await getRangeSnippetAndLanguage(thread.uri, lineNumber, lineEndNumber);
      code = snippet.code;
      language = snippet.language;
    } else {
      const fullDocument = await getDocumentTextAndLanguage(thread.uri);
      code = fullDocument.code;
      language = fullDocument.language;
    }

    let originalLine: number | undefined;
    let originalLineEnd: number | undefined;
    let modifiedLine: number | undefined;
    let modifiedLineEnd: number | undefined;
    let anchorSide: "original" | "modified" | undefined;
    let anchorLineStart: number | undefined;
    let anchorLineEnd: number | undefined;
    if (target !== "file" && lineNumber !== undefined) {
      if (target === "deleted" || target === "modified-before") {
        originalLine = lineNumber;
        originalLineEnd = lineEndNumber;
      }
      if (target === "added" || target === "modified-after") {
        modifiedLine = lineNumber;
        modifiedLineEnd = lineEndNumber;
      }
      if (target === "unchanged") {
        anchorSide = targetContext.side;
        anchorLineStart = lineNumber;
        anchorLineEnd = lineEndNumber;
      }
    }

    return formatOnetimeCopyBlock({
      path: targetContext.workspaceFileContext.sessionPath,
      target,
      originalLine,
      originalLineEnd,
      modifiedLine,
      modifiedLineEnd,
      anchorSide,
      anchorLineStart,
      anchorLineEnd,
      code,
      language,
      isBinarySnippet: isBinary,
      commentText: draftComment,
    });
  }

  async function ensureSessionForTargetContext(
    targetContext: ReviewTargetContext,
  ): Promise<boolean> {
    const existingSession = sessionService.getSession();
    if (!existingSession) {
      const branchName = targetContext.repository?.state.HEAD?.name;
      const headCommit = toShortHead(targetContext.repository?.state.HEAD?.commit);
      sessionService.createSessionIfNeeded({
        repoRoot: targetContext.workspaceFileContext.workspaceFolder.uri.fsPath,
        repoName: targetContext.workspaceFileContext.workspaceFolder.name,
        branchNameAtStart: branchName,
        headCommitAtStart: headCommit,
        startedAt: getNowIsoUtc(),
      });
      await refreshUi();
    }

    return true;
  }

  async function createReviewCommentFromThread(
    thread: vscode.CommentThread,
    commentText: string,
    existingThread?: vscode.CommentThread,
  ): Promise<boolean> {
    const targetContext = await getReviewTargetContextForUri(thread.uri);
    if (!targetContext) {
      await vscode.window.showWarningMessage(
        "Review comments can only be added to workspace files.",
      );
      thread.dispose();
      return false;
    }

    const ready = await ensureSessionForTargetContext(targetContext);
    if (!ready) {
      return false;
    }

    const lineSpan = getRangeLineSpan(thread.range);
    const lineNumber = lineSpan?.startLineOneBased;
    const lineEndNumber = lineSpan?.endLineOneBased;
    const isBinary = targetContext.diffMap?.isBinary ?? false;
    const isFileLevel = thread.range === undefined || isBinary;
    const target = classifyCommentTarget({
      diffMap: targetContext.diffMap,
      side: targetContext.side,
      lineNumber,
      lineEndNumber,
      isFileLevel,
    });

    let code = "";
    let language = "";
    if (!isBinary && lineNumber !== undefined && lineEndNumber !== undefined && target !== "file") {
      const snippet = await getRangeSnippetAndLanguage(thread.uri, lineNumber, lineEndNumber);
      code = snippet.code;
      language = snippet.language;
    }

    let originalLine: number | undefined;
    let modifiedLine: number | undefined;
    let anchorSide: "original" | "modified" | undefined;
    let anchorLineStart: number | undefined;
    let anchorLineEnd: number | undefined;
    if (lineNumber !== undefined) {
      if (target === "deleted" || target === "modified-before") {
        originalLine = lineNumber;
      }
      if (target === "added" || target === "modified-after") {
        modifiedLine = lineNumber;
      }
      if (target === "unchanged") {
        anchorSide = targetContext.side;
        anchorLineStart = lineNumber;
        anchorLineEnd = lineEndNumber;
      }
    }

    const createdAt = getNowIsoUtc();
    const reviewComment = sessionService.addComment({
      id: createCommentId(),
      path: targetContext.workspaceFileContext.sessionPath,
      target,
      originalLine,
      modifiedLine,
      code,
      language,
      comment: commentText,
      threadUri: thread.uri.toString(),
      threadRangeStartLine: target === "file" ? undefined : lineNumber,
      threadRangeEndLine: target === "file" ? undefined : lineEndNumber,
      anchorSide,
      anchorLineStart,
      anchorLineEnd,
      isFileLevel: target === "file",
      isFallbackThread: target === "file" && lineNumber !== undefined,
      isBinarySnippet: isBinary,
      createdAt,
    });

    threadRegistry.createOrAppendComment({
      reviewCommentId: reviewComment.id,
      threadUri: thread.uri,
      threadRange: target === "file" ? undefined : thread.range,
      commentBody: commentText,
      authorName: "Reviewer",
      existingThread,
    });

    await persistAndRefreshUi();
    return true;
  }

  async function restoreSessionFromSnapshot(): Promise<void> {
    const persisted = loadSessionSnapshot(context.workspaceState);
    if (!persisted) {
      return;
    }

    sessionService.restoreSession(persisted.session);
    if (sessionService.getState() === "preview-open") {
      sessionService.closePreview();
    }
    threadRegistry.disposeAll();

    const workspaceFolders = vscode.workspace.workspaceFolders ?? [];
    const workspaceFolderByName = new Map(
      workspaceFolders.map((workspaceFolder) => [workspaceFolder.name, workspaceFolder] as const),
    );

    function resolveFallbackUriForCommentPath(commentPath: string): vscode.Uri | undefined {
      const normalizedPath = normalizeRelativePath(commentPath);
      const [workspaceFolderName, ...relativeSegments] = normalizedPath.split("/");
      if (!workspaceFolderName) {
        return undefined;
      }
      const workspaceFolder = workspaceFolderByName.get(workspaceFolderName);
      if (!workspaceFolder) {
        return undefined;
      }
      const relativePath = relativeSegments.join("/");
      if (relativePath.length === 0) {
        return workspaceFolder.uri;
      }
      return vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, relativePath));
    }

    for (const reviewComment of persisted.session.comments) {
      const fallbackUri =
        resolveFallbackUriForCommentPath(reviewComment.path) ??
        vscode.Uri.file(path.join(persisted.session.repoRoot, reviewComment.path));
      let preferredUri: vscode.Uri | undefined;
      try {
        const parsedUri = vscode.Uri.parse(reviewComment.threadUri);
        if (parsedUri.scheme === "file") {
          try {
            await vscode.workspace.fs.stat(parsedUri);
            preferredUri = parsedUri;
          } catch {
            preferredUri = fallbackUri;
          }
        } else {
          preferredUri = parsedUri;
        }
      } catch {
        preferredUri = fallbackUri;
      }

      threadRegistry.restoreComment(reviewComment, fallbackUri, preferredUri);
    }
    await persistAndRefreshUi();
  }

  async function handleReplyCommand(reply: vscode.CommentReply): Promise<void> {
    const commentText = reply.text.trim();
    if (commentText.length === 0) {
      return;
    }
    await createReviewCommentFromThread(reply.thread, commentText, reply.thread);
  }

  function isCommentThread(value: unknown): value is vscode.CommentThread {
    if (!value || typeof value !== "object") {
      return false;
    }
    const candidate = value as { dispose?: unknown; comments?: unknown };
    return typeof candidate.dispose === "function" && Array.isArray(candidate.comments);
  }

  function resolveCommentThreadFromTarget(target: unknown): vscode.CommentThread | undefined {
    if (isCommentThread(target)) {
      return target;
    }
    if (!target || typeof target !== "object" || !("thread" in target)) {
      return undefined;
    }
    const threadValue = (target as { thread?: unknown }).thread;
    if (!isCommentThread(threadValue)) {
      return undefined;
    }
    return threadValue;
  }

  function isCommentReply(value: unknown): value is vscode.CommentReply {
    if (!value || typeof value !== "object" || !("thread" in value) || !("text" in value)) {
      return false;
    }
    const candidate = value as { thread?: unknown; text?: unknown };
    return isCommentThread(candidate.thread) && typeof candidate.text === "string";
  }

  function getDraftCommentTextFromCommandTarget(target: unknown): string | undefined {
    if (!target || typeof target !== "object" || !("text" in target)) {
      return undefined;
    }
    const textValue = (target as { text?: unknown }).text;
    if (typeof textValue !== "string") {
      return undefined;
    }
    const trimmed = textValue.trim();
    if (trimmed.length === 0) {
      return undefined;
    }
    return trimmed;
  }

  function resolveUriFromCommandTarget(commandTarget: unknown): vscode.Uri | undefined {
    if (commandTarget instanceof vscode.Uri) {
      return commandTarget;
    }
    if (commandTarget && typeof commandTarget === "object" && "uri" in commandTarget) {
      const uriValue = (commandTarget as { uri?: unknown }).uri;
      if (uriValue instanceof vscode.Uri) {
        return uriValue;
      }
    }
    return undefined;
  }

  async function addReviewCommentAtLine(lineNumber?: number): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      await vscode.window.showWarningMessage("Open a file to add a review comment.");
      return;
    }
    const commentText = await vscode.window.showInputBox({
      prompt: "Enter review comment",
      placeHolder: "Example: Consider extracting this branch into a helper function.",
    });
    if (!commentText || commentText.trim().length === 0) {
      return;
    }
    let range: vscode.Range;
    if (lineNumber !== undefined) {
      const lineIndex = Math.max(0, Math.min(editor.document.lineCount - 1, lineNumber - 1));
      range = new vscode.Range(lineIndex, 0, lineIndex, 0);
    } else if (!editor.selection.isEmpty) {
      const start = editor.selection.start.line;
      let end = editor.selection.end.line;
      if (editor.selection.end.character === 0 && end > start) {
        end -= 1;
      }
      range = new vscode.Range(start, 0, Math.max(start, end), 0);
    } else {
      const activeLine = editor.selection.active.line;
      range = new vscode.Range(activeLine, 0, activeLine, 0);
    }
    const thread = commentController.createCommentThread(editor.document.uri, range, []);
    thread.range = range;
    await createReviewCommentFromThread(thread, commentText.trim(), thread);
  }

  async function addFileComment(commandTarget?: unknown): Promise<void> {
    const targetUri =
      resolveUriFromCommandTarget(commandTarget) ?? vscode.window.activeTextEditor?.document.uri;
    if (!targetUri) {
      await vscode.window.showWarningMessage("Open a workspace file to add a file comment.");
      return;
    }
    if (!(await getReviewTargetContextForUri(targetUri))) {
      await vscode.window.showWarningMessage("Open a workspace file to add a file comment.");
      return;
    }
    const commentText = await vscode.window.showInputBox({
      prompt: "Enter file comment",
      placeHolder: "Example: Please review this file holistically.",
    });
    if (!commentText || commentText.trim().length === 0) {
      return;
    }
    const thread = commentController.createCommentThread(
      targetUri,
      new vscode.Range(0, 0, 0, 0),
      [],
    );
    thread.range = undefined;
    await createReviewCommentFromThread(thread, commentText.trim(), thread);
  }

  commentController.commentingRangeProvider = {
    provideCommentingRanges: async (
      document: vscode.TextDocument,
    ): Promise<vscode.CommentingRanges> => {
      const targetContext = await getReviewTargetContextForUri(document.uri);
      if (!targetContext) {
        return {
          enableFileComments: false,
          ranges: [],
        };
      }
      if (targetContext.diffMap?.isBinary) {
        return {
          enableFileComments: true,
          ranges: [],
        };
      }
      if (document.lineCount <= 0) {
        return {
          enableFileComments: true,
          ranges: [],
        };
      }
      return {
        enableFileComments: true,
        ranges: [new vscode.Range(0, 0, document.lineCount - 1, 0)],
      };
    },
  };

  context.subscriptions.push(
    vscode.commands.registerCommand(
      "localReviewForAi.addReviewCommentAtLine",
      async (line?: number) => {
        await addReviewCommentAtLine(typeof line === "number" ? line : undefined);
      },
    ),
    vscode.commands.registerCommand("localReviewForAi.addFileComment", async (target: unknown) => {
      await addFileComment(target);
    }),
    vscode.commands.registerCommand(
      "localReviewForAi.createComment",
      async (reply: vscode.CommentReply) => {
        await handleReplyCommand(reply);
      },
    ),
    vscode.commands.registerCommand(
      "localReviewForAi.startReviewComment",
      async (reply: vscode.CommentReply) => {
        await handleReplyCommand(reply);
      },
    ),
    vscode.commands.registerCommand(
      "localReviewForAi.replyComment",
      async (reply: vscode.CommentReply) => {
        await handleReplyCommand(reply);
      },
    ),
    vscode.commands.registerCommand(
      "localReviewForAi.cancelNewCommentThread",
      async (target: unknown) => {
        const thread = resolveCommentThreadFromTarget(target);
        if (!thread) {
          return;
        }
        thread.dispose();
      },
    ),
    vscode.commands.registerCommand("localReviewForAi.onetimeCopy", async (target: unknown) => {
      const thread = resolveCommentThreadFromTarget(target);
      if (!thread) {
        return;
      }
      const draftComment = getDraftCommentTextFromCommandTarget(target);
      const formattedBlock = await buildOnetimeCopyMarkdown(thread, draftComment);
      if (formattedBlock === undefined) {
        await vscode.window.showWarningMessage(
          "Review comments can only be added to workspace files.",
        );
        return;
      }
      try {
        await vscode.env.clipboard.writeText(formattedBlock);
      } catch {
        await vscode.window.showErrorMessage("Failed to write formatted block to clipboard.");
        return;
      }
      thread.dispose();
      await vscode.window.showInformationMessage("Formatted block copied to clipboard.");
    }),
    vscode.commands.registerCommand(
      "localReviewForAi.cancelReplyComment",
      async (target: unknown) => {
        if (!isCommentReply(target)) {
          return;
        }
        target.text = "";
        target.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
        target.thread.comments = [...target.thread.comments];
      },
    ),
    vscode.commands.registerCommand("localReviewForAi.editComment", async (target: unknown) => {
      const reviewCommentId = threadRegistry.getReviewCommentIdFromCommandTarget(target);
      if (!reviewCommentId) {
        return;
      }
      threadRegistry.markEditing(reviewCommentId);
    }),
    vscode.commands.registerCommand("localReviewForAi.saveComment", async (target: unknown) => {
      const reviewCommentId = threadRegistry.getReviewCommentIdFromCommandTarget(target);
      if (!reviewCommentId) {
        return;
      }
      const commentBody = toCommandBody(target);
      if (commentBody === undefined) {
        return;
      }
      threadRegistry.saveCommentBody(reviewCommentId, commentBody);
      sessionService.updateCommentText(reviewCommentId, commentBody, getNowIsoUtc());
      await persistAndRefreshUi();
    }),
    vscode.commands.registerCommand("localReviewForAi.cancelComment", async (target: unknown) => {
      const reviewCommentId = threadRegistry.getReviewCommentIdFromCommandTarget(target);
      if (!reviewCommentId) {
        return;
      }
      threadRegistry.cancelCommentEdit(reviewCommentId);
    }),
    vscode.commands.registerCommand("localReviewForAi.deleteComment", async (target: unknown) => {
      const reviewCommentId = threadRegistry.getReviewCommentIdFromCommandTarget(target);
      if (!reviewCommentId) {
        return;
      }
      const deletedFromThreads = threadRegistry.deleteComment(reviewCommentId);
      const deletedFromSession = sessionService.deleteComment(reviewCommentId);
      if (!deletedFromThreads && !deletedFromSession) {
        return;
      }
      await persistAndRefreshUi();
    }),
    vscode.commands.registerCommand("localReviewForAi.submitReview", async () => {
      const session = sessionService.getSession();
      if (!session || session.comments.length === 0) {
        await vscode.window.showInformationMessage("There are no review comments to submit.");
        return;
      }
      sessionService.openPreview();
      await persistAndRefreshUi();
      await previewPanel.show(formatReviewMarkdown(session, getNowIsoUtc()));
    }),
    vscode.commands.registerCommand(
      "localReviewForAi.copyMarkdown",
      async (rawMarkdown: unknown) => {
        const session = sessionService.getSession();
        if (!session || session.comments.length === 0) {
          await vscode.window.showInformationMessage("There are no review comments to submit.");
          return;
        }
        const markdown =
          typeof rawMarkdown === "string"
            ? rawMarkdown
            : formatReviewMarkdown(session, getNowIsoUtc());
        try {
          await vscode.env.clipboard.writeText(markdown);
        } catch {
          await vscode.window.showErrorMessage("Failed to write review markdown to clipboard.");
          return;
        }
        await vscode.window.showInformationMessage("Markdown copied to clipboard.");
      },
    ),
    vscode.commands.registerCommand("localReviewForAi.discardReview", async () => {
      await clearSessionState();
      await vscode.window.showInformationMessage("Review session discarded.");
    }),
    vscode.commands.registerCommand("localReviewForAi.restoreReview", async () => {
      const persisted = loadSessionSnapshot(context.workspaceState);
      if (!persisted) {
        await vscode.window.showInformationMessage("No review session to restore.");
        return;
      }
      await restoreSessionFromSnapshot();
      await vscode.window.showInformationMessage("Review session restored.");
    }),
  );

  void (async () => {
    await refreshUi();
    const persisted = loadSessionSnapshot(context.workspaceState);
    if (!persisted) {
      return;
    }
    const selection = await vscode.window.showInformationMessage(
      "A previous Local Review session was found. Do you want to restore it?",
      "Restore",
      "Discard",
    );
    if (selection === "Restore") {
      await restoreSessionFromSnapshot();
      return;
    }
    if (selection === "Discard") {
      await discardSessionSnapshot(context.workspaceState);
      await refreshUi();
    }
  })().catch((error) => {
    logError("Failed to restore session on startup", error);
  });
}

export function deactivate(): void {}
