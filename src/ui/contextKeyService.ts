import * as vscode from "vscode";

import type { ReviewSession } from "../types";

export async function updateContextKeys(session?: ReviewSession): Promise<void> {
  const hasSession = session !== undefined;
  const commentCount = session?.comments.length ?? 0;
  const hasComments = commentCount > 0;
  const previewOpen = session?.state === "preview-open";
  const canSubmit = hasSession && hasComments;
  const sessionRepoRoot = session?.repoRoot ?? "";
  const commentEditable = hasComments;

  await Promise.all([
    vscode.commands.executeCommand("setContext", "localReviewForAi.hasSession", hasSession),
    vscode.commands.executeCommand("setContext", "localReviewForAi.hasComments", hasComments),
    vscode.commands.executeCommand("setContext", "localReviewForAi.previewOpen", previewOpen),
    vscode.commands.executeCommand("setContext", "localReviewForAi.canSubmit", canSubmit),
    vscode.commands.executeCommand(
      "setContext",
      "localReviewForAi.sessionRepoRoot",
      sessionRepoRoot,
    ),
    vscode.commands.executeCommand(
      "setContext",
      "localReviewForAi.commentEditable",
      commentEditable,
    ),
  ]);
}
