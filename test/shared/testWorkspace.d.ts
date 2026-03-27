declare module "../shared/testWorkspace.mjs" {
  export interface BaseWorkspace {
    readonly workspacePath: string;
    readonly targetRelativePath: string;
    readonly cleanupPath?: string;
  }

  export interface MultiRootWorkspace extends BaseWorkspace {
    readonly firstFileRelativePath: string;
    readonly secondFileRelativePath: string;
  }

  export function createTempGitWorkspace(prefix?: string): Promise<BaseWorkspace>;
  export function createTempWorkspaceWithoutGit(prefix?: string): Promise<BaseWorkspace>;
  export function createTempMultiRootWorkspace(prefix?: string): Promise<MultiRootWorkspace>;
}
