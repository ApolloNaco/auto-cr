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
import { runRulesEngine, formatFindingsAsMarkdown } from "./rules/engine";
import { Finding, RuleCategory } from "./rules/types";

const PROCESSED_MAX = 100;
const INSTRUCTION_MAX = 10000;
const MULTI_AGENT_TEMPLATE = ".cursor/commands/review-partial.md";

function nowStamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function categoryTitle(cat: RuleCategory): string {
  if (cat === "security") return "安全（Security）";
  if (cat === "performance") return "性能（Performance）";
  return "代码逻辑（Logic）";
}

function filterFindings(findings: Finding[], cat: RuleCategory): Finding[] {
  return findings.filter((f) => f.category === cat);
}

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
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const ruleSources = cfg.get<string[]>("ruleSources") || [];
  const multiAgent = cfg.get<boolean>("multiAgent.enabled", false);

  let findingsBlock = "";
  try {
    const r = runRulesEngine({
      workspaceRoot,
      mode: trigger,
      commitHash: trigger === "commit" ? commitHash : undefined,
      branch: trigger === "merge" ? branch : undefined,
      ruleSources,
      exclude: {
        excludeExtensions: cfg.get<string[]>("excludeExtensions") || [],
        excludePaths: cfg.get<string[]>("excludePaths") || [],
        excludeTestFiles: cfg.get<boolean>("excludeTestFiles") ?? true,
      },
    });
    findingsBlock = formatFindingsAsMarkdown(r.findings, {
      rulesPath: r.rulesPath,
      scannedFiles: r.scannedFiles,
      notes: r.notes,
    });

    if (multiAgent) {
      // Multi-agent mode: we will create 3 sub-instructions and the caller will send them sequentially.
      // Here we keep buildInstruction for single-agent mode only.
      // Caller will use buildMultiAgentInstructions below.
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    outputChannel.appendLine("规则引擎执行失败（将继续仅依赖 LLM 审查）: " + msg);
    findingsBlock = "--- 可执行规则命中（Critical） ---\n失败（本次回退仅 LLM 审查）";
  }
  const contextSection = contextBody
    ? `--- 用户补充上下文 ---\n${contextBody}\n（来源: ${sources.join("; ")})`
    : "--- 用户补充上下文 ---\n无";
  const raw = `${intro}\n\n${findingsBlock}\n\n--- 审查规则 ---\n${rulesBlock}\n\n${contextSection}\n\n执行命令: ${cmd}`;
  const final = truncateInstruction(raw);
  if (raw.length > INSTRUCTION_MAX) {
    outputChannel.appendLine("审查指令已截断至 10000 字符");
  }
  return final;
}

async function buildMultiAgentInstructions(
  workspaceRoot: string,
  trigger: "commit" | "merge",
  commitHash: string,
  branch: string,
  outputChannel: vscode.OutputChannel
): Promise<{ mergedPath: string; instructions: Array<{ category: RuleCategory; outFile: string; instruction: string }> }> {
  const outputDir = getReportOutputDir(workspaceRoot);
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const ruleSources = cfg.get<string[]>("ruleSources") || [];
  const { body: contextBody, sources } = await resolveExtraContext(workspaceRoot);
  const contextSection = contextBody
    ? `--- 用户补充上下文 ---\n${contextBody}\n（来源: ${sources.join("; ")})`
    : "--- 用户补充上下文 ---\n无";

  // Always run engine once and split by category.
  const r = runRulesEngine({
    workspaceRoot,
    mode: trigger,
    commitHash: trigger === "commit" ? commitHash : undefined,
    branch: trigger === "merge" ? branch : undefined,
    ruleSources,
    exclude: {
      excludeExtensions: cfg.get<string[]>("excludeExtensions") || [],
      excludePaths: cfg.get<string[]>("excludePaths") || [],
      excludeTestFiles: cfg.get<boolean>("excludeTestFiles") ?? true,
    },
  });

  const base = trigger === "commit"
    ? `review-${commitHash.slice(0, 8)}-${nowStamp()}`
    : `review-branch-${branch.replace(/[^\w.-]+/g, "_")}-${nowStamp()}`;

  const mergedPath = path.join(outputDir, `${base}.md`);

  const templatePath = path.join(workspaceRoot, MULTI_AGENT_TEMPLATE);
  const rulesBlock = fs.existsSync(templatePath) ? `@${templatePath}` : `# 分工审查（子任务）\n请只输出指定维度的审查片段。`;

  const cats: RuleCategory[] = ["security", "performance", "logic"];
  const instructions = cats.map((cat) => {
    const outFile = path.join(outputDir, `${base}-${cat}.md`);
    const filtered = filterFindings(r.findings, cat);
    const findingsMd = formatFindingsAsMarkdown(filtered, {
      rulesPath: r.rulesPath,
      scannedFiles: r.scannedFiles,
      notes: r.notes,
    });
    const intro =
      trigger === "commit"
        ? `你是分工审查子 Agent，仅负责【${categoryTitle(cat)}】。\n请审查提交 ${commitHash} 的代码变更，并将输出写入文件：${outFile}\n最终总报告将由系统合并到：${mergedPath}`
        : `你是分工审查子 Agent，仅负责【${categoryTitle(cat)}】。\n请审查分支 ${branch} 与当前分支差异，并将输出写入文件：${outFile}\n最终总报告将由系统合并到：${mergedPath}`;
    const raw = `${intro}\n\n${findingsMd}\n\n--- 子任务模板 ---\n${rulesBlock}\n\n${contextSection}\n\n重要：不要执行 /review 命令；只写入上述 outFile。`;
    const final = raw.length > INSTRUCTION_MAX ? raw.slice(0, INSTRUCTION_MAX) + "\n...[指令已截断]" : raw;
    if (raw.length > INSTRUCTION_MAX) {
      outputChannel.appendLine(`分工审查指令(${cat})已截断至 10000 字符`);
    }
    return { category: cat, outFile, instruction: final };
  });

  return { mergedPath, instructions };
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
    const cfg = vscode.workspace.getConfiguration("autoCR");
    const multiAgent = cfg.get<boolean>("multiAgent.enabled", false);
    if (!multiAgent) {
      const instruction = await buildInstruction(
        workspaceRoot,
        "commit",
        commitHash,
        "",
        outputChannel
      );
      await triggerReview(instruction, outputChannel);
    } else {
      const built = await buildMultiAgentInstructions(
        workspaceRoot,
        "commit",
        commitHash,
        "",
        outputChannel
      );
      outputChannel.appendLine(`分工审查已启用，将顺序触发 3 个子审查；合并报告路径: ${built.mergedPath}`);
      for (const it of built.instructions) {
        outputChannel.appendLine(`触发子审查: ${it.category} -> ${it.outFile}`);
        await triggerReview(it.instruction, outputChannel);
        // Small delay to avoid paste/submit race conditions.
        await new Promise((r) => setTimeout(r, 800));
      }
    }
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
    const cfg = vscode.workspace.getConfiguration("autoCR");
    const multiAgent = cfg.get<boolean>("multiAgent.enabled", false);
    if (!multiAgent) {
      const instruction = await buildInstruction(
        workspaceRoot,
        "merge",
        "",
        branch,
        outputChannel
      );
      await triggerReview(instruction, outputChannel);
    } else {
      const built = await buildMultiAgentInstructions(
        workspaceRoot,
        "merge",
        "",
        branch,
        outputChannel
      );
      outputChannel.appendLine(`分工审查已启用，将顺序触发 3 个子审查；合并报告路径: ${built.mergedPath}`);
      for (const it of built.instructions) {
        outputChannel.appendLine(`触发子审查: ${it.category} -> ${it.outFile}`);
        await triggerReview(it.instruction, outputChannel);
        await new Promise((r) => setTimeout(r, 800));
      }
    }
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
