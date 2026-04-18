import type * as vscode from "vscode";

import type { DiffSide } from "./diffMapBuilder";
import type { GitChange } from "./gitTypes";

function isSameUri(left: vscode.Uri, right: vscode.Uri): boolean {
  return left.toString() === right.toString();
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function extractRefFromQuery(query: string): string | undefined {
  if (!query) {
    return undefined;
  }
  const queryParams = new URLSearchParams(query);
  const refFromParams = queryParams.get("ref");
  if (refFromParams !== null) {
    return refFromParams;
  }

  const decodedQuery = safeDecode(query);
  const candidates = decodedQuery === query ? [query] : [query, decodedQuery];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
      continue;
    }
    try {
      const parsed = JSON.parse(trimmed) as { ref?: unknown };
      if (typeof parsed.ref === "string") {
        return parsed.ref;
      }
      if (parsed.ref === null) {
        return "";
      }
    } catch {
      // ignore non-json query
    }
  }
  return undefined;
}

function extractRefFromUri(uri: vscode.Uri): string | undefined {
  if (uri.scheme !== "git") {
    return undefined;
  }
  return extractRefFromQuery(uri.query);
}

function isLikelyModifiedRef(ref: string): boolean {
  const normalized = ref.trim().toLowerCase();
  return (
    normalized.length === 0 ||
    normalized === "~" ||
    normalized === "wt" ||
    normalized === "worktree" ||
    normalized === "workingtree" ||
    normalized === "index" ||
    normalized === "staged"
  );
}

function resolveDiffSideFromGitRef(ref: string | undefined): DiffSide | undefined {
  if (ref === undefined) {
    return undefined;
  }
  return isLikelyModifiedRef(ref) ? "modified" : "original";
}

export function resolveDiffSideFromChangeUri(
  uri: vscode.Uri,
  change: GitChange,
): DiffSide | undefined {
  if (isSameUri(uri, change.originalUri)) {
    return "original";
  }
  if (isSameUri(uri, change.uri)) {
    return "modified";
  }
  if (change.renameUri && isSameUri(uri, change.renameUri)) {
    return "modified";
  }

  const currentRef = extractRefFromUri(uri);
  if (currentRef !== undefined) {
    const modifiedRef = extractRefFromUri(change.uri);
    if (modifiedRef !== undefined && currentRef === modifiedRef) {
      return "modified";
    }

    const originalRef = extractRefFromUri(change.originalUri);
    if (originalRef !== undefined && currentRef === originalRef) {
      return "original";
    }

    if (originalRef !== undefined && change.uri.scheme !== "git" && currentRef !== originalRef) {
      return "modified";
    }
  }
  return undefined;
}

export function resolveDiffSide(input: {
  readonly uri: vscode.Uri;
  readonly change?: GitChange;
}): DiffSide {
  if (input.change) {
    const sideFromChange = resolveDiffSideFromChangeUri(input.uri, input.change);
    if (sideFromChange) {
      return sideFromChange;
    }
  }
  const sideFromRef = resolveDiffSideFromGitRef(extractRefFromUri(input.uri));
  if (sideFromRef) {
    return sideFromRef;
  }
  return input.uri.scheme === "git" ? "original" : "modified";
}
