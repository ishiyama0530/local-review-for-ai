import * as crypto from "node:crypto";
import * as path from "node:path";
import * as vscode from "vscode";

import { GitStatus } from "./git/gitTypes";
import { logError } from "./logger";

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".bmp",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".jar",
  ".mp4",
  ".mov",
  ".avi",
  ".mp3",
  ".wav",
  ".woff",
  ".woff2",
]);

export function getNowIsoUtc(): string {
  return new Date().toISOString();
}

export function createCommentId(): string {
  return `comment-${Date.now()}-${crypto.randomBytes(8).toString("hex")}`;
}

export function getRepositoryName(repository: { rootUri: vscode.Uri }): string {
  return path.basename(repository.rootUri.fsPath);
}

export function hasNullByte(value: string): boolean {
  return value.includes("\u0000");
}

export function isPathLikelyBinary(relativePath: string): boolean {
  return BINARY_EXTENSIONS.has(path.extname(relativePath).toLowerCase());
}

export async function readFileText(fileUri: vscode.Uri): Promise<string> {
  try {
    const bytes = await vscode.workspace.fs.readFile(fileUri);
    return new TextDecoder("utf-8").decode(bytes);
  } catch (error) {
    logError(`Failed to read file: ${fileUri.fsPath}`, error);
    return "";
  }
}

export function toShortHead(commit?: string): string | undefined {
  if (!commit) {
    return undefined;
  }
  return commit.slice(0, 7);
}

export function toCommandBody(target: unknown): string | undefined {
  if (!target || typeof target !== "object") {
    return undefined;
  }
  if (!("body" in target)) {
    return undefined;
  }
  const { body } = target as { body: unknown };
  if (typeof body === "string") {
    return body;
  }
  if (body && typeof body === "object" && "value" in body) {
    const { value } = body as { value: unknown };
    if (typeof value === "string") {
      return value;
    }
  }
  return undefined;
}

export function makePathCacheKey(
  repository: { rootUri: vscode.Uri },
  relativePath: string,
): string {
  return `${repository.rootUri.fsPath}::${relativePath}`;
}

function normalizePathForOutput(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/+/, "");
}

export function buildWorkspaceSessionPath(
  workspaceFolderName: string,
  relativePath: string,
): string {
  const normalizedFolderName = normalizePathForOutput(workspaceFolderName);
  const normalizedRelativePath = normalizePathForOutput(relativePath);
  if (normalizedRelativePath.length === 0) {
    return normalizedFolderName;
  }
  return `${normalizedFolderName}/${normalizedRelativePath}`;
}

export function mapChangeStatusToFileStatus(
  status: GitStatus,
): "untracked" | "deleted" | "renamed" | "modified" {
  if (status === GitStatus.UNTRACKED) {
    return "untracked";
  }
  if (status === GitStatus.DELETED || status === GitStatus.INDEX_DELETED) {
    return "deleted";
  }
  if (status === GitStatus.INDEX_RENAMED) {
    return "renamed";
  }
  return "modified";
}

export function lineSetToRanges(lineSet: ReadonlySet<number>): vscode.Range[] {
  const sortedLines = Array.from(lineSet)
    .filter((line) => line > 0)
    .sort((left, right) => left - right);
  if (sortedLines.length === 0) {
    return [];
  }
  const ranges: vscode.Range[] = [];
  let rangeStart = sortedLines[0]!;
  let rangeEnd = sortedLines[0]!;
  for (let index = 1; index < sortedLines.length; index += 1) {
    const currentLine = sortedLines[index]!;
    if (currentLine === rangeEnd + 1) {
      rangeEnd = currentLine;
      continue;
    }
    ranges.push(new vscode.Range(rangeStart - 1, 0, rangeEnd - 1, 0));
    rangeStart = currentLine;
    rangeEnd = currentLine;
  }
  ranges.push(new vscode.Range(rangeStart - 1, 0, rangeEnd - 1, 0));
  return ranges;
}

export function expandLineRangeWithContext(
  lineCount: number,
  startLineOneBased: number,
  endLineOneBased: number,
  contextLineCount = 1,
): { startIndex: number; endIndex: number } {
  const maxLineIndex = Math.max(0, lineCount - 1);
  const safeStart = Math.max(1, startLineOneBased);
  const safeEnd = Math.max(safeStart, endLineOneBased);
  const boundedStart = Math.min(maxLineIndex, safeStart - 1);
  const boundedEnd = Math.min(maxLineIndex, safeEnd - 1);
  const startIndex = Math.max(0, boundedStart - contextLineCount);
  const endIndex = Math.min(maxLineIndex, boundedEnd + contextLineCount);
  return {
    startIndex,
    endIndex: Math.max(startIndex, endIndex),
  };
}
