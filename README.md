# Local Review for AI 🤖

This plugin lets you add review comments to local changes (like GitHub PR reviews) and then batch-convert those comments into AI-friendly Markdown.
It is intended as a tool for reviewing code changes made by AI agents.

## Feature 1： Submit comments ✅

![Feature 1](https://github.com/ishiyama0530/local-review-for-ai/blob/main/assets/feature1.gif?raw=true)

## Feature 2： Copy block ✨

![Feature 2](https://github.com/ishiyama0530/local-review-for-ai/blob/main/assets/feature2.gif?raw=true)

## Sample copy content 📋

````markdown
### AI Guide
- `Line Status`: diff role. `Added`(+), `Deleted`(-), `Modified (Original)`(old), `Modified (Updated)`(new), `Unchanged`(context). Omitted for `file`.
- `Line`: anchor for `Unchanged`; label is `Original` on old side, otherwise `Updated`.
- `Original Line`: old-side line number (if present).
- `Modified Line`: new-side line number/range `<n>` or `<start> - <end>` (if present).

@local-review-for-ai/.oxfmtrc.json
- Line Status: Added
- Modified Line: 4

```json
  "endOfLine": "lf",
  "printWidth": 100,
  "semi": true,
```

change to 120!!

````