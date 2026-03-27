export function formatOutputPath(path: string): string {
  if (path.startsWith("@")) {
    return path;
  }
  return `@${path}`;
}

const AI_FIELD_GUIDE_LINES: readonly string[] = [
  "### AI Guide",
  "- `Line Status`: diff role. `Added`(+), `Deleted`(-), `Modified (Original)`(old), `Modified (Updated)`(new), `Unchanged`(context). Omitted for `file`.",
  "- `Line`: anchor for `Unchanged`; label is `Original` on old side, otherwise `Updated`.",
  "- `Original Line`: old-side line number (if present).",
  "- `Modified Line`: new-side line number/range `<n>` or `<start> - <end>` (if present).",
];

export function buildAiFieldGuideLines(): string[] {
  return [...AI_FIELD_GUIDE_LINES];
}

export function formatLineRange(startLine: number, endLine?: number): string {
  if (endLine === undefined || endLine <= startLine) {
    return `${startLine}`;
  }
  return `${startLine} - ${endLine}`;
}

export function longestBacktickRun(text: string): number {
  let max = 0;
  let current = 0;
  for (const ch of text) {
    if (ch === "`") {
      current += 1;
      if (current > max) {
        max = current;
      }
    } else {
      current = 0;
    }
  }
  return max;
}

export function buildCodeFenceLines(code: string, language: string, isBinary?: boolean): string[] {
  if (isBinary) {
    return ["Code Snippet: Not Available (Binary File)"];
  }
  if (code.trim().length === 0) {
    return [];
  }
  const backtickRun = longestBacktickRun(code);
  const fence = "`".repeat(Math.max(3, backtickRun + 1));
  return [`${fence}${language}`, code, fence];
}

export function finalizeFormatterOutput(lines: string[]): string {
  return `${lines.join("\n").trimEnd()}\n`;
}
