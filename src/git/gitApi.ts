import * as vscode from "vscode";

import type { GitApi, GitExtension } from "./gitTypes";

export async function getGitApi(): Promise<GitApi | undefined> {
  const extension = vscode.extensions.getExtension<GitExtension>("vscode.git");
  if (!extension) {
    return undefined;
  }
  const extensionExports = extension.isActive ? extension.exports : await extension.activate();
  if (!extensionExports) {
    return undefined;
  }
  return extensionExports.getAPI(1);
}
