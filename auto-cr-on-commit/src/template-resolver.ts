import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { log } from "./error-notifier";

const DEFAULT_TEMPLATE = ".cursor/commands/review.md";
const FALLBACK_TEMPLATE_CONTENT = `# 默认审查规则
请对提交的代码进行审查，关注：逻辑正确性、潜在 bug、代码风格与可维护性。`;

export function resolveTemplatePath(
  workspaceRoot: string,
  trigger: "commit" | "merge"
): { path: string; isFallback: boolean } {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const key =
    trigger === "commit" ? "onCommit.templatePath" : "onMerge.templatePath";
  const custom = cfg.get<string>(key)?.trim() || "";
  if (custom) {
    const absolute = path.isAbsolute(custom)
      ? custom
      : path.join(workspaceRoot, custom);
    if (fs.existsSync(absolute)) {
      return { path: absolute, isFallback: false };
    }
    log(`自定义模板不存在，回退默认: ${absolute}`);
  }
  const defaultPath = path.join(workspaceRoot, DEFAULT_TEMPLATE);
  if (fs.existsSync(defaultPath)) {
    return { path: defaultPath, isFallback: false };
  }
  log(`默认模板不存在: ${defaultPath}，使用内置兜底`);
  return { path: "", isFallback: true };
}

export function getTemplateContentForInstruction(
  templatePath: string,
  isFallback: boolean
): string {
  if (isFallback || !templatePath) {
    return FALLBACK_TEMPLATE_CONTENT;
  }
  try {
    return fs.readFileSync(templatePath, "utf8");
  } catch {
    return FALLBACK_TEMPLATE_CONTENT;
  }
}
