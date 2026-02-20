# Auto CR on Commit

在 git commit 或 merge 到 master/main 后，自动在 Cursor 中触发 Agent 代码审查。

## 安装

- **开发调试**：在 Cursor 中打开本目录，按 F5 启动扩展开发主机。
- **VSIX**：在项目目录执行 `npx @vscode/vsce package`，在 Cursor 中通过 "Install from VSIX" 安装生成的 `.vsix`。

## 配置

在设置中搜索 `autoCR` 可配置：

- `autoCR.onCommit.enabled`：是否在 commit 后自动触发审查（默认开）。
- `autoCR.onMerge.enabled`：是否在 merge 到 master/main 时触发审查（默认关）。
- `autoCR.confirmBeforeReview`：触发前是否弹窗确认（默认是）。
- `autoCR.reportOutputDir`：审查报告输出目录（默认 `Ai/review-reports`）。
- `autoCR.minChangedLines`：最少变更行数才触发（默认 20）。
- 以及模板路径、排除后缀/目录、额外上下文等，详见需求文档。

## 命令

- **Auto CR: Toggle Settings Menu**：状态栏点击或命令面板，切换 Commit/Merge 自动审查开关。
- **Auto CR: Trigger Review Now**：手动对当前 HEAD 触发一次审查。
- **Auto CR: Select Review Template**：选择自定义审查模板文件。

## 原理

1. 扩展轮询 `.git/.pending-review`（由 post-commit hook 写入）或通过 `git rev-parse HEAD` 检测新 commit（HEAD fallback）。
2. 通过变更行数与排除规则判断是否跳过；若需审查则弹窗确认（可配置跳过）。
3. 按配置组装审查指令（模板、额外上下文、命令），打开 Agent 对话并粘贴指令、自动提交，焦点回编辑器。
4. 监听报告目录下 `review-*.md` / `prd-review-*.md` 的创建，解析严重问题并按要求弹通知。

首次加载时若未检测到 post-commit hook，会提示是否自动安装；未安装时依赖 HEAD fallback 仍可检测 commit（如 IDEA 使用 JGit 时）。
