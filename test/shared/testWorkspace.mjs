import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

function runGit(args, cwd) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
  });
  if (result.status === 0) {
    return;
  }
  const stdout = result.stdout?.trim() ?? "";
  const stderr = result.stderr?.trim() ?? "";
  throw new Error(
    [
      `git ${args.join(" ")} failed.`,
      stdout ? `stdout: ${stdout}` : "",
      stderr ? `stderr: ${stderr}` : "",
    ]
      .filter((line) => line.length > 0)
      .join("\n"),
  );
}

export async function createTempGitWorkspace(prefix = "local-review-for-ai-it-") {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), prefix));
  const targetRelativePath = path.join("src", "sample.ts");
  const targetAbsolutePath = path.join(workspacePath, targetRelativePath);

  await mkdir(path.dirname(targetAbsolutePath), { recursive: true });

  const initialCode = [
    "export function greet(name: string): string {",
    "  return `Hello, ${name}`;",
    "}",
    "",
  ].join("\n");
  await writeFile(targetAbsolutePath, initialCode, "utf8");

  runGit(["init"], workspacePath);
  runGit(["config", "user.name", "Local Review E2E"], workspacePath);
  runGit(["config", "user.email", "local-review-e2e@example.com"], workspacePath);
  runGit(["add", "."], workspacePath);
  runGit(["commit", "-m", "initial commit"], workspacePath);

  const modifiedCode = [
    "export function greet(name: string): string {",
    "  const message = `Hello, ${name}!`;",
    "  return message;",
    "}",
    "",
  ].join("\n");
  await writeFile(targetAbsolutePath, modifiedCode, "utf8");

  return {
    workspacePath,
    targetRelativePath: "src/sample.ts",
    cleanupPath: workspacePath,
  };
}

export async function createTempWorkspaceWithoutGit(prefix = "local-review-for-ai-plain-") {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), prefix));
  const targetRelativePath = path.join("src", "plain.ts");
  const targetAbsolutePath = path.join(workspacePath, targetRelativePath);

  await mkdir(path.dirname(targetAbsolutePath), { recursive: true });
  const code = [
    "export function plain(name: string): string {",
    "  const greeting = `Hello, ${name}`;",
    "  return greeting;",
    "}",
    "",
  ].join("\n");
  await writeFile(targetAbsolutePath, code, "utf8");

  return {
    workspacePath,
    targetRelativePath: "src/plain.ts",
    cleanupPath: workspacePath,
  };
}

export async function createTempMultiRootWorkspace(prefix = "local-review-for-ai-multi-root-") {
  const workspacePath = await mkdtemp(path.join(os.tmpdir(), prefix));
  const firstFolderName = "workspace-a";
  const secondFolderName = "workspace-b";
  const firstFolderPath = path.join(workspacePath, firstFolderName);
  const secondFolderPath = path.join(workspacePath, secondFolderName);

  await mkdir(path.join(firstFolderPath, "src"), { recursive: true });
  await mkdir(path.join(secondFolderPath, "src"), { recursive: true });

  await writeFile(
    path.join(firstFolderPath, "src", "sample-a.ts"),
    ["export const first = () => 1;", ""].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(secondFolderPath, "src", "sample-b.ts"),
    ["export const second = () => 2;", ""].join("\n"),
    "utf8",
  );

  const workspaceFilePath = path.join(workspacePath, "multi-root.code-workspace");
  const workspaceFile = {
    folders: [{ path: firstFolderName }, { path: secondFolderName }],
  };
  await writeFile(workspaceFilePath, JSON.stringify(workspaceFile, null, 2), "utf8");

  return {
    workspacePath: workspaceFilePath,
    targetRelativePath: "src/sample-a.ts",
    firstFileRelativePath: "src/sample-a.ts",
    secondFileRelativePath: "src/sample-b.ts",
    cleanupPath: workspacePath,
  };
}
