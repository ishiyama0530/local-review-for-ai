import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    coverage: {
      enabled: true,
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/extension.ts",
        "src/git/gitApi.ts",
        "src/git/gitTypes.ts",
        "src/git/repositoryResolver.ts",
        "src/review/commentThreadRegistry.ts",
        "src/preview/previewPanel.ts",
        "src/ui/contextKeyService.ts",
        "src/ui/statusBarController.ts",
        "src/logger.ts",
        "src/utils.ts",
      ],
      thresholds: {
        lines: 80,
        branches: 80,
      },
    },
  },
});
