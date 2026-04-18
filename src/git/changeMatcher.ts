import type * as vscode from "vscode";

import type { GitChange, GitRepository } from "./gitTypes";
import { normalizeRelativePath, toRelativePathFromRepoRoot } from "./repositoryResolver";

function collectCandidateUris(change: GitChange): vscode.Uri[] {
  const candidates: vscode.Uri[] = [change.uri, change.originalUri];
  if (change.renameUri) {
    candidates.push(change.renameUri);
  }
  return candidates;
}

function isSameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString();
}

function collectMatchingChangesForPath(
  repository: GitRepository,
  relativePath: string,
): GitChange[] {
  const matched: GitChange[] = [];
  const changeSources = [
    repository.state.indexChanges ?? [],
    repository.state.workingTreeChanges,
    repository.state.untrackedChanges,
  ];

  for (const changes of changeSources) {
    for (const change of changes) {
      const candidates = collectCandidateUris(change);
      for (const candidateUri of candidates) {
        const candidateRelativePath = normalizeRelativePath(
          toRelativePathFromRepoRoot(repository.rootUri.fsPath, candidateUri),
        );
        if (candidateRelativePath === relativePath) {
          matched.push(change);
          break;
        }
      }
    }
  }
  return matched;
}

export function findMatchingChangeForPath(
  repository: GitRepository,
  relativePath: string,
  currentUri?: vscode.Uri,
): GitChange | undefined {
  const matched = collectMatchingChangesForPath(repository, relativePath);
  if (matched.length === 0) {
    return undefined;
  }

  if (currentUri) {
    for (const change of matched) {
      if (isSameUri(change.originalUri, currentUri)) {
        return change;
      }
    }
    for (const change of matched) {
      if (isSameUri(change.uri, currentUri)) {
        return change;
      }
      if (change.renameUri && isSameUri(change.renameUri, currentUri)) {
        return change;
      }
    }
    for (const change of matched) {
      const candidates = collectCandidateUris(change);
      for (const candidateUri of candidates) {
        if (isSameUri(candidateUri, currentUri)) {
          return change;
        }
      }
    }
  }

  return matched[0];
}
