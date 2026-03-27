import * as vscode from "vscode";

import { createPreviewHtml, renderSimpleMarkdown } from "./previewHtml";

export interface PreviewPanelCallbacks {
  readonly onCopyMarkdown: (markdown: string) => Promise<void>;
  readonly onDiscardReview: () => Promise<void>;
  readonly onClosed: () => Promise<void>;
}

export class PreviewPanel implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private messageDisposable?: vscode.Disposable;
  private panelDisposeDisposable?: vscode.Disposable;
  private latestRenderRequestId = 0;
  private latestHtmlSnapshot?: string;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly callbacks: PreviewPanelCallbacks,
  ) {}

  isOpen(): boolean {
    return this.panel !== undefined;
  }

  async show(markdown: string): Promise<void> {
    if (!this.panel) {
      const panel = vscode.window.createWebviewPanel(
        "localReviewForAi.preview",
        "Local Review for AI - Review Preview",
        vscode.ViewColumn.Active,
        {
          enableScripts: true,
          localResourceRoots: [this.extensionUri],
        },
      );
      this.attachPanel(panel);
    }

    const currentPanel = this.panel;
    if (!currentPanel) {
      return;
    }
    const previewHtml = await createPreviewHtml(
      currentPanel.webview,
      markdown,
      this.getGithubMarkdownCssHref(currentPanel.webview),
      this.getCodiconsCssHref(currentPanel.webview),
    );
    this.latestHtmlSnapshot = previewHtml;
    currentPanel.webview.html = previewHtml;
    currentPanel.reveal(vscode.ViewColumn.Active);
  }

  close(): void {
    this.panel?.dispose();
  }

  getLatestHtmlSnapshot(): string | undefined {
    return this.latestHtmlSnapshot;
  }

  dispose(): void {
    this.messageDisposable?.dispose();
    this.panelDisposeDisposable?.dispose();
    this.panel?.dispose();
  }

  private attachPanel(panel: vscode.WebviewPanel): void {
    this.messageDisposable?.dispose();
    this.panelDisposeDisposable?.dispose();
    this.panel = panel;
    this.latestRenderRequestId = 0;
    this.panelDisposeDisposable = panel.onDidDispose(() => {
      this.messageDisposable?.dispose();
      this.messageDisposable = undefined;
      this.panelDisposeDisposable?.dispose();
      this.panelDisposeDisposable = undefined;
      this.panel = undefined;
      this.latestHtmlSnapshot = undefined;
      void this.callbacks.onClosed();
    });
    this.messageDisposable = panel.webview.onDidReceiveMessage(
      async (message: { type?: string; markdown?: unknown; requestId?: unknown }) => {
        switch (message.type) {
          case "copyMarkdown": {
            if (typeof message.markdown !== "string") {
              return;
            }
            await this.callbacks.onCopyMarkdown(message.markdown);
            return;
          }
          case "previewMarkdownChanged": {
            await this.handlePreviewMarkdownChanged(message);
            return;
          }
          case "closePreview": {
            this.close();
            return;
          }
          case "discardReview": {
            await this.callbacks.onDiscardReview();
            return;
          }
          default:
            break;
        }
      },
    );
  }

  private async handlePreviewMarkdownChanged(message: {
    markdown?: unknown;
    requestId?: unknown;
  }): Promise<void> {
    if (typeof message.markdown !== "string" || typeof message.requestId !== "number") {
      return;
    }
    const requestId = message.requestId;
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return;
    }
    this.latestRenderRequestId = Math.max(this.latestRenderRequestId, requestId);
    const renderedHtml = await renderSimpleMarkdown(message.markdown);
    if (!this.panel || requestId !== this.latestRenderRequestId) {
      return;
    }
    await this.panel.webview.postMessage({
      type: "renderedHtmlUpdated",
      renderedHtml,
      requestId,
    });
  }

  private getGithubMarkdownCssHref(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "node_modules",
        "github-markdown-css",
        "github-markdown.css",
      ),
    );
    return cssUri.toString();
  }

  private getCodiconsCssHref(webview: vscode.Webview): string {
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        "node_modules",
        "@vscode",
        "codicons",
        "dist",
        "codicon.css",
      ),
    );
    return cssUri.toString();
  }
}
