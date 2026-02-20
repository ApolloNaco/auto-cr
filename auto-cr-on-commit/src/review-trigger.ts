import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { execSync } from "child_process";
import {
  getPendingReviewPath,
  getPendingMergePath,
} from "./hooks";
import { getReportOutputDir } from "./command-resolver";
import {
  resolveCommitCommand,
  resolveMergeCommand,
} from "./command-resolver";
import { resolveTemplatePath, getTemplateContentForInstruction } from "./template-resolver";
import { resolveExtraContext } from "./context-resolver";
import { shouldSkipByChangedLines } from "./changed-lines";
import { confirmBeforeReview } from "./confirm-dialog";
import { triggerReview } from "./agent-trigger";
import { log, showError } from "./error-notifier";

const PROCESSED_MAX = 100;
const INSTRUCTION_MAX = 10000;

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  return folders?.[0]?.uri.fsPath;
}

function gitHead(workspaceRoot: string): string | null {
  try {
    return execSync("git rev-parse HEAD", {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 3000,
    }).trim();
  } catch {
    return null;
  }
}

function getCommitMessageFirstLine(workspaceRoot: string, hash: string): string {
  try {
    const out = execSync(`git log -1 --pretty=%s ${hash}`, {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    return out.slice(0, 60) + (out.length > 60 ? "..." : "");
  } catch {
    return hash.slice(0, 8);
  }
}

function truncateInstruction(s: string): string {
  if (s.length <= INSTRUCTION_MAX) return s;
  return s.slice(0, INSTRUCTION_MAX) + "\n...[指令已截断]";
}

async function buildInstruction(
  workspaceRoot: string,
  trigger: "commit" | "merge",
  commitHash: string,
  branch: string,
  outputChannel: vscode.OutputChannel
): Promise<string> {
  const outputDir = getReportOutputDir(workspaceRoot);
  const { path: templatePath, isFallback } = resolveTemplatePath(
    workspaceRoot,
    trigger
  );
  const cmd =
    trigger === "commit"
      ? resolveCommitCommand(workspaceRoot, commitHash)
      : resolveMergeCommand(workspaceRoot, branch);
  const { body: contextBody, sources } = await resolveExtraContext(workspaceRoot);

  let rulesBlock: string;
  if (isFallback || !templatePath) {
    rulesBlock = getTemplateContentForInstruction(templatePath, true);
  } else {
    rulesBlock = `@${templatePath}`;
  }

  const intro =
    trigger === "commit"
      ? `请按照以下审查规则，对提交 ${commitHash} 的代码变更进行代码审查，并将审查报告输出到 ${outputDir} 目录。`
      : `请按照以下审查规则，对合并分支 ${branch} 与当前分支的差异进行代码审查，并将审查报告输出到 ${outputDir} 目录。`;
  const contextSection = contextBody
    ? `--- 用户补充上下文 ---\n${contextBody}\n（来源: ${sources.join("; ")})`
    : "--- 用户补充上下文 ---\n无";
  const raw = `${intro}\n\n--- 审查规则 ---\n${rulesBlock}\n\n${contextSection}\n\n执行命令: ${cmd}`;
  const final = truncateInstruction(raw);
  if (raw.length > INSTRUCTION_MAX) {
    outputChannel.appendLine("审查指令已截断至 10000 字符");
  }
  return final;
}

async function runCommitPipeline(
  workspaceRoot: string,
  commitHash: string,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const skip = shouldSkipByChangedLines(workspaceRoot, commitHash);
  if (skip.skip) {
    if (skip.reason) outputChannel.appendLine(skip.reason);
    return;
  }
  const detail = `${commitHash.slice(0, 8)} ${getCommitMessageFirstLine(workspaceRoot, commitHash)}`;
  const confirm = await confirmBeforeReview("commit", detail);
  if (confirm === "skip" || confirm === "disable") return;
  try {
    const instruction = await buildInstruction(
      workspaceRoot,
      "commit",
      commitHash,
      "",
      outputChannel
    );
    await triggerReview(instruction, outputChannel);
  } catch (e) {
    showError("Commit 审查触发失败: " + (e instanceof Error ? e.message : String(e)));
  }
}

async function runMergePipeline(
  workspaceRoot: string,
  branch: string,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const detail = `合并分支: ${branch}`;
  const confirm = await confirmBeforeReview("merge", detail);
  if (confirm === "skip" || confirm === "disable") return;
  try {
    const instruction = await buildInstruction(
      workspaceRoot,
      "merge",
      "",
      branch,
      outputChannel
    );
    await triggerReview(instruction, outputChannel);
  } catch (e) {
    showError("Merge 审查触发失败: " + (e instanceof Error ? e.message : String(e)));
  }
}

export function startPolling(outputChannel: vscode.OutputChannel): vscode.Disposable {
  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot) return { dispose: () => {} };

  const processedHashes = new Set<string>();
  const hashQueue: string[] = [];
  let lastHead: string | null = gitHead(workspaceRoot);
  let pendingCommit: string | null = null;
  let mergePending: string | null = null;

  const cfg = vscode.workspace.getConfiguration("autoCR");
  const intervalMs = cfg.get<number>("pollIntervalMs") ?? 2000;
  const commitEnabled = () => cfg.get<boolean>("onCommit.enabled", true);
  const mergeEnabled = () => cfg.get<boolean>("onMerge.enabled", false);

  const tick = () => {
    const root = getWorkspaceRoot();
    if (!root) return;
    const commitOn = commitEnabled();
    const mergeOn = mergeEnabled();

    if (commitOn) {
      const pendingPath = getPendingReviewPath(root);
      if (fs.existsSync(pendingPath)) {
        try {
          const hash = fs.readFileSync(pendingPath, "utf8").trim();
          fs.unlinkSync(pendingPath);
          if (hash && !processedHashes.has(hash)) {
            processedHashes.add(hash);
            hashQueue.push(hash);
            if (hashQueue.length > PROCESSED_MAX) {
              const old = hashQueue.shift();
              if (old) processedHashes.delete(old);
            }
            pendingCommit = hash;
          }
        } catch (e) {
          log("读取 pending-review 失败: " + (e instanceof Error ? e.message : String(e)));
        }
      }
      const head = gitHead(root);
      if (head && head !== lastHead && !processedHashes.has(head)) {
        processedHashes.add(head);
        hashQueue.push(head);
        if (hashQueue.length > PROCESSED_MAX) {
          const old = hashQueue.shift();
          if (old) processedHashes.delete(old);
        }
        pendingCommit = head;
      }
      lastHead = head ?? lastHead;
    }

    if (mergeOn) {
      const mergePath = getPendingMergePath(root);
      if (fs.existsSync(mergePath)) {
        try {
          const branch = fs.readFileSync(mergePath, "utf8").trim();
          fs.unlinkSync(mergePath);
          if (branch) mergePending = branch;
        } catch (e) {
          log("读取 pending-merge-review 失败: " + (e instanceof Error ? e.message : String(e)));
        }
      }
    }

    if (pendingCommit) {
      const hash = pendingCommit;
      pendingCommit = null;
      runCommitPipeline(root, hash, outputChannel);
    }
    if (mergePending) {
      const branch = mergePending;
      mergePending = null;
      runMergePipeline(root, branch, outputChannel);
    }
  };

  const id = setInterval(tick, intervalMs);
  return {
    dispose: () => clearInterval(id),
  };
}

export async function triggerReviewNow(outputChannel: vscode.OutputChannel): Promise<void> {
  const root = getWorkspaceRoot();
  if (!root) {
    showError("当前无工作区或非文件夹");
    return;
  }
  const head = gitHead(root);
  if (!head) {
    showError("无法获取当前 HEAD，请确认 Git 已安装且当前为有效仓库");
    return;
  }
  await runCommitPipeline(root, head, outputChannel);
}
