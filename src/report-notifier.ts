import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { showError } from "./error-notifier";
import { getReportOutputDir } from "./command-resolver";

const CRITICAL_HEADING = "### 🔴 严重问题";
const MAX_LINES_TO_SCAN = 50;

function parseCriticalCount(content: string): number {
  const lines = content.split(/\r?\n/).slice(0, MAX_LINES_TO_SCAN);
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (line.includes(CRITICAL_HEADING)) {
      inSection = true;
      continue;
    }
    if (inSection) {
      if (line.startsWith("### ") && !line.includes("🔴")) break;
      if (/^\s*[-*]\s+.+/.test(line) || /^\d+\.\s+.+/.test(line)) {
        count++;
      }
    }
  }
  return count;
}

function getNotifyMode(): "always" | "criticalOnly" {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const v = cfg.get<string | boolean>("notifyOnComplete", "always");
  if (v === true) return "always";
  if (v === false) return "criticalOnly";
  return (v === "criticalOnly" ? "criticalOnly" : "always") as "always" | "criticalOnly";
}

export function startReportWatcher(
  workspaceRoot: string,
  outputChannel: vscode.OutputChannel
): vscode.Disposable[] {
  const disposables: vscode.Disposable[] = [];
  const outputDir = getReportOutputDir(workspaceRoot);
  const baseUri = vscode.Uri.file(outputDir);
  const patterns = [
    new vscode.RelativePattern(baseUri, "review-*.md"),
    new vscode.RelativePattern(baseUri, "prd-review-*.md"),
  ];
  const onCreated = (uri: vscode.Uri) => handleNewReport(uri, outputChannel);
  for (const p of patterns) {
    const w = vscode.workspace.createFileSystemWatcher(p);
    disposables.push(w.onDidCreate(onCreated));
    disposables.push(w);
  }
  return disposables;
}

type PartialCat = "security" | "performance" | "logic";

function parsePartialCategory(fileName: string): PartialCat | null {
  if (fileName.endsWith("-security.md")) return "security";
  if (fileName.endsWith("-performance.md")) return "performance";
  if (fileName.endsWith("-logic.md")) return "logic";
  return null;
}

function baseNameForPartial(fileName: string, cat: PartialCat): string {
  return fileName.slice(0, -(`-${cat}.md`.length));
}

function mergeTitle(cat: PartialCat): string {
  if (cat === "security") return "## 安全（Security）";
  if (cat === "performance") return "## 性能（Performance）";
  return "## 代码逻辑（Logic）";
}

const partialState = new Map<string, { rootDir: string; parts: Partial<Record<PartialCat, string>> }>();

function tryMerge(baseKey: string, outputChannel: vscode.OutputChannel): void {
  const st = partialState.get(baseKey);
  if (!st) return;
  const { parts, rootDir } = st;
  if (!parts.security || !parts.performance || !parts.logic) return;

  const mergedPath = path.join(rootDir, `${baseKey}.md`);
  const merged = `# 代码审查报告（分工合并） - ${baseKey}\n\n` +
    `${mergeTitle("security")}\n\n${parts.security}\n\n` +
    `${mergeTitle("performance")}\n\n${parts.performance}\n\n` +
    `${mergeTitle("logic")}\n\n${parts.logic}\n`;

  try {
    fs.writeFileSync(mergedPath, merged, "utf8");
    outputChannel.appendLine("分工审查已合并报告: " + mergedPath);
  } catch (e) {
    showError("合并分工审查报告失败: " + (e instanceof Error ? e.message : String(e)), mergedPath);
  } finally {
    partialState.delete(baseKey);
  }
}

function handleNewReport(uri: vscode.Uri, outputChannel: vscode.OutputChannel): void {
  const filePath = uri.fsPath;
  const fileName = path.basename(filePath);

  const cat = parsePartialCategory(fileName);
  if (cat) {
    // In multi-agent mode, partial reports are merged; skip normal notification flow.
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (e) {
      showError(
        "分片审查报告读取失败: " + (e instanceof Error ? e.message : String(e)),
        filePath
      );
      return;
    }
    const baseKey = baseNameForPartial(fileName, cat);
    const rootDir = path.dirname(filePath);
    const st = partialState.get(baseKey) ?? { rootDir, parts: {} };
    st.parts[cat] = content;
    partialState.set(baseKey, st);
    outputChannel.appendLine(`收到分片报告: ${cat} (${fileName})，等待合并...`);
    tryMerge(baseKey, outputChannel);
    return;
  }

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (e) {
    showError(
      "审查报告文件读取失败: " + (e instanceof Error ? e.message : String(e)),
      filePath
    );
    return;
  }
  let criticalCount: number;
  try {
    criticalCount = parseCriticalCount(content);
  } catch {
    showError("审查报告解析失败，文件可能损坏或格式异常", filePath);
    return;
  }
  const mode = getNotifyMode();
  if (criticalCount > 0) {
    vscode.window
      .showWarningMessage(
        `⚠️ AI 代码审查已完成，发现 ${criticalCount} 个严重问题，请立即查看！`,
        "查看报告"
      )
      .then((choice) => {
        if (choice === "查看报告") {
          vscode.window.showTextDocument(uri).then((editor) => {
            const doc = editor.document.getText();
            const idx = doc.indexOf(CRITICAL_HEADING);
            if (idx >= 0) {
              const pos = editor.document.positionAt(idx);
              editor.revealRange(new vscode.Range(pos, pos));
            }
          });
        }
      });
  } else if (mode === "always") {
    vscode.window
      .showInformationMessage(
        "✅ AI 代码审查已完成，未发现严重问题。",
        "查看报告"
      )
      .then((choice) => {
        if (choice === "查看报告") {
          vscode.window.showTextDocument(uri);
        }
      });
  } else {
    outputChannel.appendLine("审查完成，无严重问题（criticalOnly 模式不弹通知）");
  }
}
