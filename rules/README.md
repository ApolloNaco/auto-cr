# AutoCR Rules（可执行规则）说明

本目录用于存放 AutoCR 的**可执行规则配置**。规则用于在触发 LLM 审查前，先从本次变更中提取**可复现**的 Findings（证据/位置/snippet），并注入到 Agent instruction 中，约束 LLM 输出更稳定、更可回归。

## 文件一览
- `critical.rules.json`: 默认 Critical 规则集（JSON 数组）

## 动态加载规则（上线后推荐）
AutoCR 支持通过设置项 **`autoCR.ruleSources`** 动态指定规则来源，不需要改代码或重新发布插件。

- **留空（默认行为）**：使用工作区 `rules/critical.rules.json`
- **指定规则文件**：填入一个 `.json` 文件路径（绝对路径或相对工作区路径）
- **指定规则目录**：填入一个目录路径；引擎会加载该目录下所有 `*.rules.json` 并合并

合并规则时以 `rule_id` 去重：**后面的来源会覆盖前面的同名 `rule_id`**（便于“基础规则 + 项目私有覆盖”）。

示例（settings.json）：

```json
{
  "autoCR.ruleSources": [
    "rules/critical.rules.json",
    "rules/project-overrides.rules.json",
    "/Users/you/company-rules/"
  ]
}
```

## 规则生命周期（它为什么能生效）
1. `src/rules/engine.ts` 在 commit/merge 触发时获取 patch（`git show --patch` / `git diff --patch`）
2. 从 patch 解析出本次变更涉及的文件列表（changed files）
3. 加载规则来源（默认 `rules/critical.rules.json`，也可由 `autoCR.ruleSources` 指定），按 `trigger.type` 分发给对应 matcher 执行
4. matcher 产出 `Finding`（包含 `rule_id`、文件、行号、snippet、reason）
5. Findings 被格式化并注入 instruction（见 `src/review-trigger.ts`），最终由 LLM 在报告中回填/对齐

> 结论：**JSON 只是规则声明**；真正的执行逻辑在 `src/rules/*` 的引擎与 matcher 中。

## RuleDefinition（规则定义）字段说明
每条规则是一个 JSON object，建议至少包含：
- **`rule_id`**: string  
  规则唯一 ID，用于报告对齐与回归。
- **`title`**: string  
  人类可读标题。
- **`severity`**: `"critical" | "major" | "minor"`  
  当前引擎 v1 会优先跑 `critical`（见 `src/rules/engine.ts`）。
- **`category`**（推荐）: `"security" | "performance" | "logic"`  
  用于将 Findings 按“安全/性能/代码逻辑”三条主线分组展示与回填。
- **`scope`**: `"java" | "xml" | "properties" | "any"`  
  限制规则作用文件类型。
- **`trigger`**: object  
  触发器定义（核心，见下节）。
- **`evidence`**（可选）: object  
  - `requireSnippet?: boolean` 是否输出 snippet
  - `maxSnippetLines?: number` snippet 最大行数
- **`suggestion`**（可选）: string  
  给 LLM 的修复方向提示（当前主要用于 instruction 侧的上下文，不直接影响引擎命中）。

## Finding（命中结果）输出含义
引擎输出的 Finding 结构（概念）：
- `rule_id/title/severity`
- `file`: 相对路径
- `line_start/line_end`: 1-based 行号范围（diff 场景多为近似，AST 场景更精确）
- `snippet`: 命中片段（若 `requireSnippet`）
- `reason`: 命中原因（会写明用了哪个 matcher/正则/检查）

## Trigger 类型与能力边界

### 1) `diffRegex`
**输入来源**：git patch（只看本次变更的 diff 行）  
**实现**：`src/rules/matchers/regex.ts::matchDiffRegex`  

字段：
- `pattern`: JS 正则字符串（注意 JSON 转义）
- `flags`: 如 `"i"`, `"m"`
- `addedLinesOnly`: true 时只匹配 `+` 行

适合：
- 检测新增的高危调用（`Runtime.exec`、明显 SQL 拼接形态、危险开关等）

局限：
- 只能看到 diff 片段，不知道完整上下文
- 行号来自 diff hunk 的 newLine（近似但可定位）

示例（来自 `critical.rules.json`）：

```json
{
  "rule_id": "java_runtime_exec",
  "severity": "critical",
  "scope": "java",
  "trigger": { "type": "diffRegex", "pattern": "\\\\bRuntime\\\\.getRuntime\\\\(\\\\)\\\\.exec\\\\s*\\\\(", "flags": "i", "addedLinesOnly": true }
}
```

### 2) `fileRegex`
**输入来源**：读取“变更文件”的完整内容（文件大小受限，当前约 512KB）  
**实现**：`src/rules/matchers/regex.ts::matchFileRegex`

适合：
- XML/配置等文件里的硬编码（例如 `http://`）

局限：
- 需要读全文件；大文件会被跳过（除非后续加“降级 diffRegex”策略）

### 3) `propertiesKeyRegex`
**输入来源**：读取“变更 .properties 文件”的完整内容，然后解析 `key=value`  
**实现**：`src/rules/matchers/properties.ts::matchPropertiesKeyRegex`

适合：
- 检测敏感 key（password/secret/token 等）

局限：
- 只检查 key（当前实现不做 value 的敏感值扫描/熵检测）

### 4) `xmlAttributeRegex`
**输入来源**：读取“变更 .xml 文件”的内容，轻量扫描含 `<` 与 `=` 的行  
**实现**：`src/rules/matchers/xml.ts::matchXmlAttributeRegex`

适合：
- 属性级规则（如 `android:javaScriptEnabled="true"`）

局限：
- 不是严格 XML 解析（不处理跨行属性/复杂格式），偏保守

### 5) `javaAstQuery`（AST）
**输入来源**：读取“变更 .java 文件”的完整内容 → 解析为 AST → 执行 Query  
**实现**：`src/rules/matchers/java-ast.ts::matchJavaAstQuery`

关键点：
- 使用 `tree-sitter` 解析 Java（语言定义来自 `tree-sitter-java`）
- 规则中 `query` 必须捕获一个名为 **`@hit`** 的节点，作为 Finding 的定位点

适合：
- 结构化匹配（try/catch、调用点、同步块等），比正则更稳、更少误报

局限：
- 仍是单文件分析，不含类型解析/跨文件符号解析

示例：匹配 `catch(Exception|Throwable)` 并把 catch block 作为命中点：

```json
{
  "rule_id": "java_empty_catch_all",
  "severity": "critical",
  "scope": "java",
  "trigger": {
    "type": "javaAstQuery",
    "query": "((catch_clause (catch_formal_parameter (type_identifier) @t) (block) @hit) (#match? @t \"^(Exception|Throwable)$\"))"
  }
}
```

### 6) `javaCfgCheck`（CFG/数据流：当前为“最小启发式版”）
**输入来源**：读取“变更 .java 文件”→ AST 遍历 → 做函数内按需检查  
**实现**：`src/rules/matchers/java-cfg.ts::matchJavaCfgCheck`

当前支持的 `checkId`：
- `resource_not_try_with_resources`：方法内疑似资源创建，但未发现 try-with-resources（启发式）
- `catch_without_rethrow`：catch 中未发现 throw/return，疑似吞异常（启发式）

为什么叫 CFG：
- 这层的目标是覆盖“需要路径/处置策略”类规则；当前实现为了成本与性能，先用 AST+启发式做 0→1，并未构建完整控制流图。

## 常见写规则注意事项
- **JSON 转义**：正则里的 `\` 在 JSON 中要写成 `\\`。
- **尽量收敛误报**：优先用 `javaAstQuery` 做结构化定位；`diffRegex` 用于“变更片段的高危信号”。
- **保持可回归**：规则输出应尽量稳定（`rule_id` 不要随意改名）。
