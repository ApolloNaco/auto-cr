# AutoCR

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/ApolloNaco/auto-cr/blob/master/package.json)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/ApolloNaco/auto-cr/blob/master/LICENSE)

一个面向 Cursor 的 VSCode 扩展，在 Git **commit** 或 **merge** 到 master/main 后自动触发 Cursor Agent 代码审查。支持自定义审查模板、排除规则与报告目录，让每次提交都可选地经过 AI 审查并生成报告。

## ✨ 功能特性

- 🔄 **Commit 触发**: 每次 commit 后可选自动触发 Cursor Agent 代码审查
- 🌿 **Merge 触发**: 可选在 merge 到 master/main 时触发审查
- 📝 **自定义模板**: 支持指定审查模板路径，默认使用 `.cursor/commands/review.md`
- 📊 **变更阈值**: 可配置最小变更行数，低于阈值不触发审查
- 🚫 **排除规则**: 支持按文件后缀、目录前缀排除，并可自动排除测试文件
- 📁 **报告输出**: 审查报告输出到可配置目录（默认 `Ai/review-reports`）
- 🔔 **完成通知**: 可配置审查完成后的通知模式（始终 / 仅严重问题）
- 🎛️ **状态栏**: 状态栏快捷切换 Commit/Merge 自动审查开关
- 🚀 **手动触发**: 支持「立即审查」与「选择审查模板」命令

## 📋 系统要求

在安装和使用本扩展之前，请确保满足以下要求：

### 必需条件

- **Cursor** 或 **VSCode**: 1.85.0 或更高（扩展依赖 Cursor Agent 能力，建议在 Cursor 中使用）
- **Git**: 工作区为 Git 仓库（包含 `.git` 目录）
- **Git 命令行**: 用于解析 commit、变更行数等（部分场景依赖 post-commit hook，可选安装）

### 推荐环境

- 使用 Cursor 以获得完整 Agent 审查体验
- 需要审查时：在 Cursor 中已配置好 `/review` 等自定义命令或对应审查流程

## 📦 安装

### 方式一：从 VSCode Marketplace 安装（推荐）

本扩展已上架 [VSCode Marketplace](https://marketplace.visualstudio.com/items?itemName=ApolloNaco.auto-cr)，可直接安装：

1. 打开 VSCode / Cursor，按 `Ctrl+Shift+X`（Mac: `Cmd+Shift+X`）打开扩展视图
2. 搜索 **AutoCR**
3. 点击 **安装** 即可

或通过命令行安装：
```bash
code --install-extension ApolloNaco.auto-cr
```

### 方式二：从 VSIX 文件安装

1. 在项目根目录执行打包：
   ```bash
   npm run compile
   npx @vscode/vsce package
   ```
2. 在 Cursor 中：`Cmd+Shift+P`（Windows: `Ctrl+Shift+P`）→ 输入 **Install from VSIX**
3. 选择生成的 `auto-cr-1.0.0.vsix` 完成安装
4. 按提示重新加载窗口（若需要）

### 开发调试

在 Cursor 中打开本扩展目录，按 **F5** 启动扩展开发主机，在开发主机中打开目标 Git 仓库即可调试。

## 🚀 快速开始

1. **安装扩展**：从 Marketplace 或 VSIX 安装后，按提示重载窗口。
2. **确认 Git 仓库**：在 Cursor 中打开一个包含 `.git` 的工程。
3. **状态栏**：右下角会出现 AutoCR 状态，点击可打开快捷菜单。
4. **首次 Commit**：若启用「Commit 后自动审查」，在 commit 后按提示确认是否触发审查；审查命令会在 Agent 中执行，报告写入配置的输出目录。
5. **手动审查**：命令面板中运行 **AutoCR: Trigger Review Now** 可对当前 HEAD 立即触发一次审查。

## 📚 使用指南

### 状态栏

扩展在 Cursor 右下角状态栏提供入口：

- 点击状态栏项可打开 **快捷菜单**，切换 Commit/Merge 自动审查开关等。
- 通过 **AutoCR: Toggle Settings Menu** 也可打开同一菜单。

### 命令面板

按 `Ctrl+Shift+P`（Mac: `Cmd+Shift+P`），输入 **AutoCR** 可看到：

| 命令 | 说明 |
|------|------|
| **AutoCR: Toggle Settings Menu** | 打开状态栏快捷菜单（切换 Commit/Merge 开关等） |
| **AutoCR: Toggle Commit Auto Mode** | 切换「Commit 后自动审查」开关 |
| **AutoCR: Toggle Merge Auto Mode** | 切换「Merge 到 master/main 时审查」开关 |
| **AutoCR: Trigger Review Now** | 对当前 HEAD 立即触发一次审查 |
| **AutoCR: Select Review Template** | 选择自定义审查模板文件 |

## ⚙️ 配置选项

在设置中搜索 **AutoCR** 可配置以下项：

### Commit 触发

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `autoCR.onCommit.enabled` | boolean | `true` | 是否在每次 commit 后自动触发审查 |
| `autoCR.onCommit.command` | string | `/review [commit-hash] -o --dir [outputDir]` | 审查命令模板，占位符：`[commit-hash]`、`[outputDir]` |
| `autoCR.onCommit.templatePath` | string | `""` | 审查模板路径，空则使用 `.cursor/commands/review.md` |

### Merge 触发

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `autoCR.onMerge.enabled` | boolean | `false` | 是否在 merge 到 master/main 时触发审查 |
| `autoCR.onMerge.command` | string | `/review --b [branch] -o --dir [outputDir]` | 审查命令模板，占位符：`[branch]`、`[outputDir]` |
| `autoCR.onMerge.templatePath` | string | `""` | merge 触发时使用的 CR 模板路径 |

### 行为与输出

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `autoCR.autoSubmit` | boolean | `true` | 是否自动发送审查命令（`false` 时仅粘贴到输入框） |
| `autoCR.pollIntervalMs` | number | `2000` | 标记文件轮询间隔（毫秒） |
| `autoCR.minChangedLines` | number | `20` | 触发审查的最小变更行数（仅 commit 触发） |
| `autoCR.confirmBeforeReview` | boolean | `true` | 触发审查前是否弹窗确认 |
| `autoCR.reportOutputDir` | string | `Ai/review-reports` | 审查报告输出目录 |
| `autoCR.notifyOnComplete` | `"always"` \| `"criticalOnly"` | `always` | 审查完成后通知模式；执行错误始终会弹通知 |

### 排除规则

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `autoCR.excludeExtensions` | string[] | 不参与 CR 的文件后缀（如 `.md`, `.json`） |
| `autoCR.excludePaths` | string[] | 不参与 CR 的目录路径前缀（如 `test/`, `node_modules/`） |
| `autoCR.excludeTestFiles` | boolean | 是否自动排除单元测试文件（默认 `true`） |

### 高级

| 配置项 | 类型 | 说明 |
|--------|------|------|
| `autoCR.extraContext` | array | 自定义 CR 上下文，每项为 `{ "type": "text"|"directory"|"url", "value": "..." }` |

## 🔍 工作原理

1. **触发检测**：通过轮询 `.git/.pending-review`（由 post-commit hook 写入）或 `git rev-parse HEAD` 等方式检测新 commit；merge 时在 merge 到 master/main 分支时触发。
2. **是否审查**：根据变更行数与排除规则（文件类型、路径、测试文件）判断是否跳过；若不跳过且开启了确认，则弹窗让用户确认是否执行审查。
3. **执行审查**：按配置组装审查命令（含模板路径、占位符替换、额外上下文），打开 Cursor Agent 对话，粘贴命令并自动提交（可配置为仅粘贴）。
4. **报告与通知**：监听报告输出目录下 `review-*.md` / `prd-review-*.md` 等文件的生成，解析严重问题并按 `notifyOnComplete` 决定是否弹通知。

首次加载时若未检测到 post-commit hook，会提示是否自动安装；未安装时仍可通过 HEAD 等方式检测 commit（例如在 IDEA 使用 JGit 的场景）。

## 🛠️ 开发指南

- 克隆本仓库，在扩展目录执行 `npm install` 与 `npm run compile`。
- 用 Cursor 打开扩展目录，按 **F5** 启动扩展开发主机，在开发主机中打开目标 Git 仓库即可调试。
- 修改代码后重新编译或使用 `npm run watch`，在开发主机中重载窗口以加载新逻辑。

## 📝 更新日志

版本历史见仓库 Release 或后续维护的 CHANGELOG。

## ❓ 常见问题

### Q: 审查没有自动触发？

A: 请检查：① `autoCR.onCommit.enabled` / `autoCR.onMerge.enabled` 是否打开；② 变更行数是否达到 `autoCR.minChangedLines`；③ 若开启了 `autoCR.confirmBeforeReview`，是否在弹窗中确认了执行；④ 工作区是否为 Git 仓库且 Cursor 能正常调用 Agent。

### Q: 如何更换审查模板？

A: 设置 `autoCR.onCommit.templatePath`（或 merge 的 `templatePath`）为你的模板文件路径；或使用命令 **AutoCR: Select Review Template** 选择文件。留空则使用 `.cursor/commands/review.md`。

### Q: 报告写到哪里？

A: 默认是工作区下的 `Ai/review-reports`，可通过 `autoCR.reportOutputDir` 修改。扩展会监听该目录下 `review-*.md` 等文件的生成并据此做完成通知。

### Q: 不想审查测试/文档类文件怎么办？

A: 使用 `autoCR.excludeExtensions`、`autoCR.excludePaths` 和 `autoCR.excludeTestFiles` 排除相应后缀、目录或测试文件。

### Q: 在 IDEA 里 commit，Cursor 里能触发吗？

A: 可以。若未安装 post-commit hook，扩展会通过轮询 HEAD 等方式检测新 commit，在 Cursor 中打开同一仓库即可在 commit 后触发（可能略有延迟，取决于轮询间隔）。

## 📄 许可证

[MIT License](https://github.com/ApolloNaco/auto-cr/blob/master/LICENSE)

## 👨‍💻 作者

**ApolloNaco**
- 掘金：[NacoStack](https://juejin.cn/user/143390347639064)
- GitHub: [ApolloNaco](https://github.com/ApolloNaco)

## 🙏 致谢

感谢所有使用和反馈 AutoCR 的开发者。

## 📧 反馈与支持

如有问题或建议，欢迎在仓库中提交 [Issue](https://github.com/ApolloNaco/auto-cr/issues) 或 [Pull Request](https://github.com/ApolloNaco/auto-cr/pulls)，或在掘金留言交流。

---

**让每次提交都可选地经过 AI 审查。** 🎉
