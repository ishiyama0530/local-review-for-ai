import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel("Local Review for AI");
  }
  return outputChannel;
}

export function logError(message: string, error?: unknown): void {
  const channel = getOutputChannel();
  const errorDetail = error instanceof Error ? error.message : String(error ?? "");
  channel.appendLine(`[ERROR] ${message}${errorDetail ? `: ${errorDetail}` : ""}`);
}

export function logWarn(message: string): void {
  const channel = getOutputChannel();
  channel.appendLine(`[WARN] ${message}`);
}
