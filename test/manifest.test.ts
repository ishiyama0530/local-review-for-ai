import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

type PackageJson = {
  activationEvents?: string[];
  contributes?: {
    commands?: Array<{
      command?: string;
      title?: string;
      icon?: string;
      shortTitle?: string;
    }>;
    menus?: {
      [menuId: string]: Array<{
        command?: string;
        when?: string;
        group?: string;
      }>;
    };
  };
};

function loadPackageJson(): PackageJson {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");
  const content = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(content) as PackageJson;
}

describe("package.json manifest", () => {
  it("copyAndFinish コマンドが存在しないこと", () => {
    const packageJson = loadPackageJson();
    const commands = packageJson.contributes?.commands ?? [];
    const commandIds = commands.map((command) => command.command);
    expect(commandIds).not.toContain("localReviewForAi.copyAndFinish");
  });

  it("Copy コマンドタイトルが Copy であること", () => {
    const packageJson = loadPackageJson();
    const commands = packageJson.contributes?.commands ?? [];
    const copyCommand = commands.find(
      (command) => command.command === "localReviewForAi.copyMarkdown",
    );
    expect(copyCommand?.title).toBe("Copy");
  });

  it("Submit コマンドが shortTitle を持ち、stale専用コマンドを持たないこと", () => {
    const packageJson = loadPackageJson();
    const commands = packageJson.contributes?.commands ?? [];
    const submitCommand = commands.find(
      (command) => command.command === "localReviewForAi.submitReview",
    );
    expect(submitCommand?.shortTitle).toBe("✅ Submit comments");
    expect(
      commands.some((command) => command.command === "localReviewForAi.submitReviewStale"),
    ).toBe(false);
    expect(submitCommand?.icon).toBeUndefined();
    expect(submitCommand?.shortTitle?.includes("$(")).toBe(false);
  });

  it("Submit メニューが stale 条件なしで canSubmit のみで表示されること", () => {
    const packageJson = loadPackageJson();
    const editorTitleMenus = packageJson.contributes?.menus?.["editor/title"] ?? [];
    const scmTitleMenus = packageJson.contributes?.menus?.["scm/change/title"] ?? [];
    const editorSubmit = editorTitleMenus.find(
      (menu) => menu.command === "localReviewForAi.submitReview",
    );
    const scmSubmit = scmTitleMenus.find(
      (menu) => menu.command === "localReviewForAi.submitReview",
    );
    expect(editorSubmit?.when).toBe("localReviewForAi.canSubmit");
    expect(scmSubmit?.when).toBe("localReviewForAi.canSubmit");
    expect(
      editorTitleMenus.some((menu) => menu.command === "localReviewForAi.submitReviewStale"),
    ).toBe(false);
    expect(
      scmTitleMenus.some((menu) => menu.command === "localReviewForAi.submitReviewStale"),
    ).toBe(false);
  });

  it("Edit/Discard Comment コマンドがアイコン付きで定義されること", () => {
    const packageJson = loadPackageJson();
    const commands = packageJson.contributes?.commands ?? [];
    const editCommand = commands.find(
      (command) => command.command === "localReviewForAi.editComment",
    );
    const discardCommand = commands.find(
      (command) => command.command === "localReviewForAi.deleteComment",
    );
    expect(editCommand?.icon).toBe("$(edit)");
    expect(discardCommand?.icon).toBe("$(trash)");
    expect(discardCommand?.title).toBe("Discard Comment");

    const cancelNewThreadCommand = commands.find(
      (command) => command.command === "localReviewForAi.cancelNewCommentThread",
    );
    const cancelReplyCommand = commands.find(
      (command) => command.command === "localReviewForAi.cancelReplyComment",
    );
    expect(cancelNewThreadCommand?.icon).toBe("$(close)");
    expect(cancelReplyCommand?.icon).toBe("$(close)");
  });

  it("Edit/Discard はコメント行側のみに表示し、スレッドタイトル側には表示しないこと", () => {
    const packageJson = loadPackageJson();
    const commentTitleMenus = packageJson.contributes?.menus?.["comments/comment/title"] ?? [];
    const threadTitleMenus = packageJson.contributes?.menus?.["comments/commentThread/title"] ?? [];

    const commentTargetMenus = commentTitleMenus.filter(
      (menu) =>
        menu.command === "localReviewForAi.editComment" ||
        menu.command === "localReviewForAi.deleteComment",
    );
    const threadTargetMenus = threadTitleMenus.filter(
      (menu) =>
        menu.command === "localReviewForAi.editComment" ||
        menu.command === "localReviewForAi.deleteComment",
    );
    expect(commentTargetMenus.length).toBe(2);
    expect(threadTargetMenus.length).toBe(0);
    for (const menu of commentTargetMenus) {
      expect(menu.when).toContain("commentController == local-review-for-ai");
      expect(menu.when).not.toContain("commentThreadIsEmpty");
    }
  });

  it("編集時ボタンが Update(右/プライマリー)・Cancel(左/セカンダリー) の順序定義であること", () => {
    const packageJson = loadPackageJson();
    const commands = packageJson.contributes?.commands ?? [];
    const saveCommand = commands.find(
      (command) => command.command === "localReviewForAi.saveComment",
    );
    const cancelCommand = commands.find(
      (command) => command.command === "localReviewForAi.cancelComment",
    );
    expect(saveCommand?.title).toBe("Update");
    expect(cancelCommand?.title).toBe("Cancel");

    const commentContextMenus = packageJson.contributes?.menus?.["comments/comment/context"] ?? [];
    const saveMenu = commentContextMenus.find(
      (menu) => menu.command === "localReviewForAi.saveComment",
    );
    const cancelMenu = commentContextMenus.find(
      (menu) => menu.command === "localReviewForAi.cancelComment",
    );
    expect(saveMenu?.group).toBe("inline@1");
    expect(cancelMenu?.group).toBe("inline@2");
  });

  it("空スレッド入力時にコメント件数で Cancel と Comment/Start a review を出し分けること", () => {
    const packageJson = loadPackageJson();
    const commands = packageJson.contributes?.commands ?? [];
    const onetimeCopyCommand = commands.find(
      (command) => command.command === "localReviewForAi.onetimeCopy",
    );
    const startReviewCommand = commands.find(
      (command) => command.command === "localReviewForAi.startReviewComment",
    );
    const createCommentCommand = commands.find(
      (command) => command.command === "localReviewForAi.createComment",
    );
    const cancelNewThreadCommand = commands.find(
      (command) => command.command === "localReviewForAi.cancelNewCommentThread",
    );
    expect(onetimeCopyCommand?.title).toBe("Copy block");
    expect(onetimeCopyCommand?.icon).toBe("$(copy)");
    expect(startReviewCommand?.title).toBe("Start a review");
    expect(createCommentCommand?.title).toBe("Comment");
    expect(cancelNewThreadCommand?.title).toBe("Cancel");

    const threadContextMenus =
      packageJson.contributes?.menus?.["comments/commentThread/context"] ?? [];
    const onetimeCopyMenu = threadContextMenus.find(
      (menu) => menu.command === "localReviewForAi.onetimeCopy",
    );
    const cancelMenu = threadContextMenus.find(
      (menu) => menu.command === "localReviewForAi.cancelNewCommentThread",
    );
    const startMenu = threadContextMenus.find(
      (menu) => menu.command === "localReviewForAi.startReviewComment",
    );
    const createMenu = threadContextMenus.find(
      (menu) => menu.command === "localReviewForAi.createComment",
    );
    expect(onetimeCopyMenu?.when).toContain("commentThreadIsEmpty");
    expect(onetimeCopyMenu?.when).toContain("commentController == local-review-for-ai");
    expect(onetimeCopyMenu?.group).toBe("inline@2");
    expect(cancelMenu?.when).toContain("commentThreadIsEmpty");
    expect(cancelMenu?.group).toBe("inline@3");
    expect(startMenu?.when).toContain("commentThreadIsEmpty");
    expect(startMenu?.when).toContain("!localReviewForAi.hasComments");
    expect(startMenu?.group).toBe("inline@1");
    expect(createMenu?.when).toContain("commentThreadIsEmpty");
    expect(createMenu?.when).toContain("localReviewForAi.hasComments");
    expect(createMenu?.group).toBe("inline@1");
  });

  it("返信入力時に Reply(右) と Cancel(左) を表示すること", () => {
    const packageJson = loadPackageJson();
    const commands = packageJson.contributes?.commands ?? [];
    const replyCommand = commands.find(
      (command) => command.command === "localReviewForAi.replyComment",
    );
    const cancelReplyCommand = commands.find(
      (command) => command.command === "localReviewForAi.cancelReplyComment",
    );
    expect(replyCommand?.title).toBe("Reply");
    expect(cancelReplyCommand?.title).toBe("Cancel");

    const threadContextMenus =
      packageJson.contributes?.menus?.["comments/commentThread/context"] ?? [];
    const replyMenu = threadContextMenus.find(
      (menu) => menu.command === "localReviewForAi.replyComment",
    );
    const cancelReplyMenu = threadContextMenus.find(
      (menu) => menu.command === "localReviewForAi.cancelReplyComment",
    );
    expect(replyMenu?.when).toContain("!commentThreadIsEmpty");
    expect(replyMenu?.group).toBe("inline@1");
    expect(cancelReplyMenu?.when).toContain("!commentThreadIsEmpty");
    expect(cancelReplyMenu?.group).toBe("inline@2");
  });

  it("行番号メニューの Add Review Comment はセッション有無に依存しないこと", () => {
    const packageJson = loadPackageJson();
    const lineNumberMenus = packageJson.contributes?.menus?.["editor/lineNumber/context"] ?? [];
    const addReviewCommentMenu = lineNumberMenus.find(
      (menu) => menu.command === "localReviewForAi.addReviewCommentAtLine",
    );
    expect(addReviewCommentMenu?.group).toBe("navigation@9");
    expect(addReviewCommentMenu?.when).toBeUndefined();
  });

  it("onWebviewPanel の activation event を持たないこと", () => {
    const packageJson = loadPackageJson();
    const activationEvents = packageJson.activationEvents ?? [];
    expect(activationEvents).not.toContain("onWebviewPanel:localReviewForAi.preview");
  });
});
