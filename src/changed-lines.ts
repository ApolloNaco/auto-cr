import * as path from "path";
import * as vscode from "vscode";
import { execSync } from "child_process";
import { log } from "./error-notifier";

const TEST_PATTERNS = [
  /Test\.(java|kt|kts|ts|js|tsx|jsx)$/i,
  /Tests\.(java|kt|kts)$/i,
  /Spec\.(java|kt|kts|ts|js)$/i,
  /^test_.*\.py$/i,
  /\.(test|spec)\.(ts|js|tsx|jsx)$/i,
];

function isTestFile(filePath: string): boolean {
  const name = path.basename(filePath);
  return TEST_PATTERNS.some((p) => p.test(name));
}

function isExcludedByExtension(
  filePath: string,
  excludeExtensions: string[]
): boolean {
  const ext = path.extname(filePath);
  return excludeExtensions.some(
    (e) => e.toLowerCase() === ext.toLowerCase() || e === ext
  );
}

function isExcludedByPath(
  filePath: string,
  excludePaths: string[]
): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return excludePaths.some((p) => normalized.startsWith(p.replace(/\\/g, "/")));
}

export function isFileExcluded(
  filePath: string,
  opts: {
    excludeExtensions: string[];
    excludePaths: string[];
    excludeTestFiles: boolean;
  }
): boolean {
  if (isExcludedByExtension(filePath, opts.excludeExtensions)) return true;
  if (isExcludedByPath(filePath, opts.excludePaths)) return true;
  if (opts.excludeTestFiles && isTestFile(filePath)) return true;
  return false;
}

export interface ChangedFileInfo {
  path: string;
  added: number;
  deleted: number;
}

export function getChangedFilesAndLines(
  workspaceRoot: string,
  commitHash: string
): ChangedFileInfo[] {
  try {
    const out = execSync(
      `git show --numstat --format= ${commitHash}`,
      { cwd: workspaceRoot, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 }
    );
    const lines = out.trim().split(/\r?\n/).filter(Boolean);
    const result: ChangedFileInfo[] = [];
    for (const line of lines) {
      const [addStr, delStr, ...pathParts] = line.split(/\t/);
      const filePath = pathParts.join("\t").trim();
      if (!filePath) continue;
      const added = parseInt(addStr, 10) || 0;
      const deleted = parseInt(delStr, 10) || 0;
      result.push({ path: filePath, added, deleted });
    }
    return result;
  } catch {
    return [];
  }
}

export function getIncludedChangedLines(
  workspaceRoot: string,
  commitHash: string
): {
  totalLines: number;
  allExcluded: boolean;
  fileCount: number;
} {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const excludeExtensions = cfg.get<string[]>("excludeExtensions") || [];
  const excludePaths = cfg.get<string[]>("excludePaths") || [];
  const excludeTestFiles = cfg.get<boolean>("excludeTestFiles") ?? true;
  const opts = { excludeExtensions, excludePaths, excludeTestFiles };

  const files = getChangedFilesAndLines(workspaceRoot, commitHash);
  let totalLines = 0;
  let includedCount = 0;
  for (const f of files) {
    if (isFileExcluded(f.path, opts)) continue;
    includedCount++;
    totalLines += f.added + f.deleted;
  }
  return {
    totalLines,
    allExcluded: files.length > 0 && includedCount === 0,
    fileCount: includedCount,
  };
}

export function shouldSkipByChangedLines(
  workspaceRoot: string,
  commitHash: string
): { skip: boolean; reason?: string } {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const minLines = cfg.get<number>("minChangedLines") ?? 20;
  const { totalLines, allExcluded } = getIncludedChangedLines(
    workspaceRoot,
    commitHash
  );
  if (allExcluded) {
    log("变更文件均为排除类型或排除目录，跳过审查");
    return { skip: true, reason: "变更文件均为排除类型，跳过审查" };
  }
  if (totalLines < minLines) {
    log(`变更行数 ${totalLines} 低于阈值 ${minLines}，跳过审查`);
    return {
      skip: true,
      reason: `变更仅 ${totalLines} 行，低于阈值 ${minLines} 行，跳过审查`,
    };
  }
  return { skip: false };
}
