# Local Review for AI 🤖

This plugin lets you add review comments to local changes (like GitHub PR reviews) and then batch-convert those comments into AI-friendly Markdown.
It is intended as a tool for reviewing code changes made by AI agents.

## Feature 1： Submit comments ✅

![Feature 1](https://github.com/ishiyama0530/local-review-for-ai/blob/main/assets/feature1.gif?raw=true)

## Feature 2： Copy block ✨

![Feature 2](https://github.com/ishiyama0530/local-review-for-ai/blob/main/assets/feature2.gif?raw=true)

## Command Palette

- Open Quick Open with `Ctrl+P` (`Cmd+P` on macOS), type `>` and run `Local Review for AI: Submit comments`.

## Sample copy content 📋

````markdown
@local-review-for-ai/.oxfmtrc.json
- Line: 4

```json
  "endOfLine": "lf",
  "printWidth": 100,
  "semi": true,
```

change to 120!!

````
