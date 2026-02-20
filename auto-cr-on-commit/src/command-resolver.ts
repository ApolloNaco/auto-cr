import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";

const DEFAULT_OUTPUT_DIR = "Ai/review-reports";

export function getReportOutputDir(workspaceRoot: string): string {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const dir = cfg.get<string>("reportOutputDir")?.trim() || DEFAULT_OUTPUT_DIR;
  const absolute = path.isAbsolute(dir)
    ? dir
    : path.join(workspaceRoot, dir);
  if (!fs.existsSync(absolute)) {
    fs.mkdirSync(absolute, { recursive: true });
  }
  return absolute;
}

export function resolveCommitCommand(
  workspaceRoot: string,
  commitHash: string
): string {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const template =
    cfg.get<string>("onCommit.command")?.trim() ||
    "/review [commit-hash] -o --dir [outputDir]";
  const outputDir = getReportOutputDir(workspaceRoot);
  return template
    .replace(/\[commit-hash\]/g, commitHash)
    .replace(/\[outputDir\]/g, outputDir);
}

export function resolveMergeCommand(
  workspaceRoot: string,
  branch: string
): string {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const template =
    cfg.get<string>("onMerge.command")?.trim() ||
    "/review --b [branch] -o --dir [outputDir]";
  const outputDir = getReportOutputDir(workspaceRoot);
  return template
    .replace(/\[branch\]/g, branch)
    .replace(/\[outputDir\]/g, outputDir);
}
