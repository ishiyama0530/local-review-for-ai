import type { ReviewTarget } from "../types";

export type DiffSide = "original" | "modified";

export interface DiffMap {
  readonly path: string;
  readonly isBinary: boolean;
  readonly addedLines: ReadonlySet<number>;
  readonly deletedLines: ReadonlySet<number>;
  readonly modifiedBeforeLines: ReadonlySet<number>;
  readonly modifiedAfterLines: ReadonlySet<number>;
}

export interface BuildDiffMapInput {
  readonly path: string;
  readonly originalText: string;
  readonly modifiedText: string;
  readonly fileStatus?: "modified" | "deleted" | "untracked" | "renamed" | "binary";
}

type DiffOperation =
  | { readonly type: "equal"; readonly originalLine: number; readonly modifiedLine: number }
  | { readonly type: "delete"; readonly originalLine: number }
  | { readonly type: "add"; readonly modifiedLine: number };

function splitLines(text: string): string[] {
  if (text.length === 0) {
    return [];
  }
  return text.replace(/\r\n/g, "\n").split("\n");
}

function buildChangedLineRange(size: number): Set<number> {
  return new Set<number>(Array.from({ length: size }, (_value, index) => index + 1));
}

function buildOperations(
  originalLines: readonly string[],
  modifiedLines: readonly string[],
): DiffOperation[] {
  const originalLength = originalLines.length;
  const modifiedLength = modifiedLines.length;
  const dp: Int32Array[] = Array.from(
    { length: originalLength + 1 },
    () => new Int32Array(modifiedLength + 1),
  );

  for (let originalIndex = originalLength - 1; originalIndex >= 0; originalIndex -= 1) {
    for (let modifiedIndex = modifiedLength - 1; modifiedIndex >= 0; modifiedIndex -= 1) {
      const currentRow = dp[originalIndex]!;
      const nextRow = dp[originalIndex + 1]!;
      if (originalLines[originalIndex] === modifiedLines[modifiedIndex]) {
        currentRow[modifiedIndex] = nextRow[modifiedIndex + 1]! + 1;
      } else {
        currentRow[modifiedIndex] = Math.max(
          nextRow[modifiedIndex]!,
          currentRow[modifiedIndex + 1]!,
        );
      }
    }
  }

  const operations: DiffOperation[] = [];
  let originalIndex = 0;
  let modifiedIndex = 0;
  let originalLineNumber = 1;
  let modifiedLineNumber = 1;

  while (originalIndex < originalLength || modifiedIndex < modifiedLength) {
    const originalLine = originalLines[originalIndex];
    const modifiedLine = modifiedLines[modifiedIndex];

    if (
      originalIndex < originalLength &&
      modifiedIndex < modifiedLength &&
      originalLine === modifiedLine
    ) {
      operations.push({
        type: "equal",
        originalLine: originalLineNumber,
        modifiedLine: modifiedLineNumber,
      });
      originalIndex += 1;
      modifiedIndex += 1;
      originalLineNumber += 1;
      modifiedLineNumber += 1;
      continue;
    }

    const canAdd =
      modifiedIndex < modifiedLength &&
      (originalIndex >= originalLength ||
        dp[originalIndex]![modifiedIndex + 1]! > dp[originalIndex + 1]![modifiedIndex]!);

    if (canAdd) {
      operations.push({ type: "add", modifiedLine: modifiedLineNumber });
      modifiedIndex += 1;
      modifiedLineNumber += 1;
      continue;
    }

    operations.push({ type: "delete", originalLine: originalLineNumber });
    originalIndex += 1;
    originalLineNumber += 1;
  }

  return operations;
}

const MAX_DIFF_LINE_PRODUCT = 10_000_000;

export function buildDiffMap(input: BuildDiffMapInput): DiffMap {
  const originalLines = splitLines(input.originalText);
  const modifiedLines = splitLines(input.modifiedText);

  if (input.fileStatus === "binary") {
    return {
      path: input.path,
      isBinary: true,
      addedLines: new Set(),
      deletedLines: new Set(),
      modifiedBeforeLines: new Set(),
      modifiedAfterLines: new Set(),
    };
  }

  if (input.fileStatus === "untracked") {
    return {
      path: input.path,
      isBinary: false,
      addedLines: buildChangedLineRange(modifiedLines.length),
      deletedLines: new Set(),
      modifiedBeforeLines: new Set(),
      modifiedAfterLines: new Set(),
    };
  }

  if (input.fileStatus === "deleted") {
    return {
      path: input.path,
      isBinary: false,
      addedLines: new Set(),
      deletedLines: buildChangedLineRange(originalLines.length),
      modifiedBeforeLines: new Set(),
      modifiedAfterLines: new Set(),
    };
  }

  if (originalLines.length * modifiedLines.length > MAX_DIFF_LINE_PRODUCT) {
    return {
      path: input.path,
      isBinary: false,
      addedLines: buildChangedLineRange(modifiedLines.length),
      deletedLines: buildChangedLineRange(originalLines.length),
      modifiedBeforeLines: new Set(),
      modifiedAfterLines: new Set(),
    };
  }

  const addedLines = new Set<number>();
  const deletedLines = new Set<number>();
  const modifiedBeforeLines = new Set<number>();
  const modifiedAfterLines = new Set<number>();
  const operations = buildOperations(originalLines, modifiedLines);
  let cursor = 0;

  while (cursor < operations.length) {
    const currentOperation = operations[cursor];
    if (!currentOperation || currentOperation.type === "equal") {
      cursor += 1;
      continue;
    }

    const deletedInHunk: number[] = [];
    const addedInHunk: number[] = [];

    while (cursor < operations.length && operations[cursor]?.type !== "equal") {
      const operation = operations[cursor];
      if (!operation) {
        break;
      }
      if (operation.type === "delete") {
        deletedInHunk.push(operation.originalLine);
      }
      if (operation.type === "add") {
        addedInHunk.push(operation.modifiedLine);
      }
      cursor += 1;
    }

    if (deletedInHunk.length > 0 && addedInHunk.length > 0) {
      for (const line of deletedInHunk) {
        modifiedBeforeLines.add(line);
      }
      for (const line of addedInHunk) {
        modifiedAfterLines.add(line);
      }
      continue;
    }

    if (addedInHunk.length > 0) {
      for (const line of addedInHunk) {
        addedLines.add(line);
      }
      continue;
    }

    for (const line of deletedInHunk) {
      deletedLines.add(line);
    }
  }

  return {
    path: input.path,
    isBinary: false,
    addedLines,
    deletedLines,
    modifiedBeforeLines,
    modifiedAfterLines,
  };
}

export function getCommentableLines(diffMap: DiffMap, side: DiffSide): ReadonlySet<number> {
  if (side === "original") {
    return new Set([...diffMap.deletedLines, ...diffMap.modifiedBeforeLines]);
  }
  return new Set([...diffMap.addedLines, ...diffMap.modifiedAfterLines]);
}

export function classifyLineTarget(
  diffMap: DiffMap,
  side: DiffSide,
  lineNumber: number,
): ReviewTarget | undefined {
  if (side === "original") {
    if (diffMap.modifiedBeforeLines.has(lineNumber)) {
      return "modified-before";
    }
    if (diffMap.deletedLines.has(lineNumber)) {
      return "deleted";
    }
    return undefined;
  }

  if (diffMap.modifiedAfterLines.has(lineNumber)) {
    return "modified-after";
  }
  if (diffMap.addedLines.has(lineNumber)) {
    return "added";
  }
  return undefined;
}
