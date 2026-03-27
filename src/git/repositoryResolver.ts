import * as path from "node:path";
import * as vscode from "vscode";

import type { GitApi, GitRepository } from "./gitTypes";

export function resolveRepositoryFromUri(
  gitApi: GitApi,
  uri: vscode.Uri,
): GitRepository | undefined {
  return gitApi.getRepository(uri) ?? undefined;
}

export function resolveRepositoryFromRepoRoot(
  gitApi: GitApi,
  repoRoot: string,
): GitRepository | undefined {
  return gitApi.repositories.find(
    (repository) => normalizeFsPath(repository.rootUri.fsPath) === normalizeFsPath(repoRoot),
  );
}

export function toRelativePathFromRepoRoot(repoRoot: string, uri: vscode.Uri): string {
  return normalizeRelativePath(path.relative(repoRoot, uri.fsPath));
}

export function normalizeRelativePath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

function normalizeFsPath(value: string): string {
  return path.normalize(value);
}
