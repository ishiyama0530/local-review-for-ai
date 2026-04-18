import type * as vscode from "vscode";
import { describe, expect, it } from "vitest";

import { findMatchingChangeForPath } from "../src/git/changeMatcher";
import type { GitChange, GitRepository } from "../src/git/gitTypes";

function createUri(input: {
  fsPath: string;
  scheme?: string;
  query?: string;
  text?: string;
}): vscode.Uri {
  const scheme = input.scheme ?? "file";
  const query = input.query ?? "";
  const text = input.text ?? `${scheme}:${input.fsPath}${query ? `?${query}` : ""}`;
  return {
    fsPath: input.fsPath,
    scheme,
    query,
    toString: () => text,
  } as unknown as vscode.Uri;
}

function createChange(input: {
  uri: vscode.Uri;
  originalUri?: vscode.Uri;
  renameUri?: vscode.Uri;
}): GitChange {
  return {
    uri: input.uri,
    originalUri: input.originalUri ?? input.uri,
    renameUri: input.renameUri,
    status: 5 as never,
  };
}

function createRepository(input: {
  indexChanges?: readonly GitChange[];
  workingTreeChanges?: readonly GitChange[];
  untrackedChanges?: readonly GitChange[];
}): GitRepository {
  return {
    rootUri: createUri({ fsPath: "/repo" }),
    state: {
      HEAD: undefined,
      indexChanges: input.indexChanges,
      workingTreeChanges: input.workingTreeChanges ?? [],
      untrackedChanges: input.untrackedChanges ?? [],
      onDidChange: undefined as never,
    },
    show: async () => "",
  };
}

describe("changeMatcher", () => {
  it("workingTreeChanges から一致する change を解決できること", () => {
    const expected = createChange({
      uri: createUri({ fsPath: "/repo/src/a.ts" }),
    });
    const repository = createRepository({
      workingTreeChanges: [expected],
    });

    const resolved = findMatchingChangeForPath(repository, "src/a.ts");
    expect(resolved).toBe(expected);
  });

  it("indexChanges のみ存在する場合でも一致する change を解決できること", () => {
    const expected = createChange({
      uri: createUri({ fsPath: "/repo/src/staged.ts" }),
    });
    const repository = createRepository({
      indexChanges: [expected],
    });

    const resolved = findMatchingChangeForPath(repository, "src/staged.ts");
    expect(resolved).toBe(expected);
  });

  it("同一パスが複数ソースにある場合は indexChanges を優先すること", () => {
    const indexChange = createChange({
      uri: createUri({ fsPath: "/repo/src/priority.ts" }),
    });
    const workingTreeChange = createChange({
      uri: createUri({ fsPath: "/repo/src/priority.ts" }),
    });
    const repository = createRepository({
      indexChanges: [indexChange],
      workingTreeChanges: [workingTreeChange],
    });

    const resolved = findMatchingChangeForPath(repository, "src/priority.ts");
    expect(resolved).toBe(indexChange);
  });

  it("currentUri が workingTree change の originalUri と一致する場合は workingTree change を優先すること", () => {
    const indexChange = createChange({
      originalUri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "git",
        query: "ref=HEAD",
        text: "git:/repo/src/a.ts?ref=HEAD",
      }),
      uri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "git",
        query: "ref=STAGED",
        text: "git:/repo/src/a.ts?ref=STAGED",
      }),
    });
    const workingTreeChange = createChange({
      originalUri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "git",
        query: "ref=INDEX",
        text: "git:/repo/src/a.ts?ref=INDEX",
      }),
      uri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "file",
        text: "file:/repo/src/a.ts",
      }),
    });
    const repository = createRepository({
      indexChanges: [indexChange],
      workingTreeChanges: [workingTreeChange],
    });
    const currentUri = createUri({
      fsPath: "/repo/src/a.ts",
      scheme: "git",
      query: "ref=INDEX",
      text: "git:/repo/src/a.ts?ref=INDEX",
    });

    const resolved = findMatchingChangeForPath(repository, "src/a.ts", currentUri);
    expect(resolved).toBe(workingTreeChange);
  });

  it("currentUri が index change の uri と一致する場合は index change を優先すること", () => {
    const indexChange = createChange({
      originalUri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "git",
        query: "ref=HEAD",
        text: "git:/repo/src/a.ts?ref=HEAD",
      }),
      uri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "git",
        query: "ref=STAGED",
        text: "git:/repo/src/a.ts?ref=STAGED",
      }),
    });
    const workingTreeChange = createChange({
      originalUri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "git",
        query: "ref=INDEX",
        text: "git:/repo/src/a.ts?ref=INDEX",
      }),
      uri: createUri({
        fsPath: "/repo/src/a.ts",
        scheme: "file",
        text: "file:/repo/src/a.ts",
      }),
    });
    const repository = createRepository({
      indexChanges: [indexChange],
      workingTreeChanges: [workingTreeChange],
    });
    const currentUri = createUri({
      fsPath: "/repo/src/a.ts",
      scheme: "git",
      query: "ref=STAGED",
      text: "git:/repo/src/a.ts?ref=STAGED",
    });

    const resolved = findMatchingChangeForPath(repository, "src/a.ts", currentUri);
    expect(resolved).toBe(indexChange);
  });

  it("一致する change がない場合は undefined を返すこと", () => {
    const repository = createRepository({
      workingTreeChanges: [
        createChange({
          uri: createUri({ fsPath: "/repo/src/other.ts" }),
        }),
      ],
    });

    const resolved = findMatchingChangeForPath(repository, "src/missing.ts");
    expect(resolved).toBeUndefined();
  });
});
