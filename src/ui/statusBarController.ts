import * as vscode from "vscode";

import type { ReviewSession } from "../types";

export class StatusBarController implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "localReviewForAi.submitReview";
  }

  update(session?: ReviewSession): void {
    const commentCount = session?.comments.length ?? 0;
    if (!session || commentCount === 0) {
      this.item.hide();
      return;
    }

    if (session.state === "preview-open") {
      this.item.text = "$(eye) Review Preview";
      this.item.tooltip = "Review preview is open.";
      this.item.backgroundColor = undefined;
      this.item.show();
      return;
    }

    this.item.text = `$(comment-discussion) Submit Review (${commentCount})`;
    this.item.tooltip = "Open review preview";
    this.item.backgroundColor = undefined;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
