import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { execSync } from "child_process";
import { setOutputChannel, showError } from "./error-notifier";
import { create, update as updateStatusBar, dispose as disposeStatusBar } from "./status-bar";
import {
  checkPostCommitHook,
  checkPostMergeHook,
  installPostCommitHook,
  installPostMergeHook,
} from "./hooks";
import { startPolling, triggerReviewNow } from "./review-trigger";
import { startReportWatcher } from "./report-notifier";

const WELCOMED_KEY = "autoCR.welcomed";

function isGitAvailable(): boolean {
  try {
    execSync("git --version", { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

function getWorkspaceRoot(): string | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
}

function isGitRepo(root: string): boolean {
  return fs.existsSync(path.join(root, ".git"));
}

export function activate(context: vscode.ExtensionContext): void {
  const out = vscode.window.createOutputChannel("AutoCR");
  setOutputChannel(out);

  if (!isGitAvailable()) {
    showError(
      "AutoCR 需要 Git 支持，请先安装 Git（https://git-scm.com）后重启 Cursor"
    );
    return;
  }

  const workspaceRoot = getWorkspaceRoot();
  if (!workspaceRoot || !isGitRepo(workspaceRoot)) {
    out.appendLine("当前工作区非 Git 项目，AutoCR 已禁用");
    return;
  }

  if (!checkPostCommitHook(workspaceRoot)) {
    vscode.window
      .showInformationMessage(
        "检测到 post-commit hook 未配置，是否自动安装？",
        "安装",
        "跳过"
      )
      .then((choice) => {
        if (choice === "安装") {
          installPostCommitHook(workspaceRoot, (msg) => out.appendLine(msg));
        } else {
          out.appendLine("hook 未安装，将依赖 HEAD fallback 检测");
        }
      });
  }

  const cfg = vscode.workspace.getConfiguration("autoCR");
  if (cfg.get<boolean>("onMerge.enabled", false) && !checkPostMergeHook(workspaceRoot)) {
    vscode.window
      .showInformationMessage(
        "检测到 post-merge hook 未配置，是否自动安装？",
        "安装",
        "跳过"
      )
      .then((choice) => {
        if (choice === "安装") {
          installPostMergeHook(workspaceRoot, (msg) => out.appendLine(msg));
        }
      });
  }

  const welcomed = context.globalState.get<boolean>(WELCOMED_KEY);
  if (!welcomed) {
    vscode.window
      .showInformationMessage(
        "Commit 自动代码审查已默认开启，每次 commit 后将自动触发 CR。",
        "好的",
        "关闭自动 CR"
      )
      .then((choice) => {
        if (choice === "关闭自动 CR") {
          cfg.update("onCommit.enabled", false, vscode.ConfigurationTarget.Global);
          updateStatusBar(false, cfg.get("onMerge.enabled", false));
        }
        if (choice === "好的" || choice === "关闭自动 CR") {
          context.globalState.update(WELCOMED_KEY, true);
        }
      });
  }

  const statusBar = create(vscode.StatusBarAlignment.Right, 100);
  const refreshStatus = () => {
    const c = vscode.workspace.getConfiguration("autoCR");
    updateStatusBar(c.get("onCommit.enabled", true), c.get("onMerge.enabled", false));
  };
  refreshStatus();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("autoCR")) refreshStatus();
    })
  );

  const pollDisposable = startPolling(out);
  context.subscriptions.push(pollDisposable);

  const reportWatchers = startReportWatcher(workspaceRoot, out);
  reportWatchers.forEach((d) => context.subscriptions.push(d));

  context.subscriptions.push(
    vscode.commands.registerCommand("autoCR.toggleSettingsMenu", () => {
      const c = vscode.workspace.getConfiguration("autoCR");
      const commitOn = c.get("onCommit.enabled", true);
      const mergeOn = c.get("onMerge.enabled", false);
      vscode.window
        .showQuickPick(
          [
            {
              label: `Commit 自动审查 (当前: ${commitOn ? "开" : "关"})`,
              description: commitOn ? "点击关闭" : "点击开启",
              detail: "commit",
            },
            {
              label: `Merge 自动审查 (当前: ${mergeOn ? "开" : "关"})`,
              description: mergeOn ? "点击关闭" : "点击开启",
              detail: "merge",
            },
          ],
          { placeHolder: "选择要切换的选项" }
        )
        .then((item) => {
          if (!item?.detail) return;
          if (item.detail === "commit") {
            c.update("onCommit.enabled", !commitOn, vscode.ConfigurationTarget.Global);
            updateStatusBar(!commitOn, mergeOn);
          } else {
            c.update("onMerge.enabled", !mergeOn, vscode.ConfigurationTarget.Global);
            updateStatusBar(commitOn, !mergeOn);
          }
        });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoCR.toggleCommitMode", () => {
      const c = vscode.workspace.getConfiguration("autoCR");
      const next = !c.get("onCommit.enabled", true);
      c.update("onCommit.enabled", next, vscode.ConfigurationTarget.Global);
      updateStatusBar(next, c.get("onMerge.enabled", false));
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoCR.toggleMergeMode", () => {
      const c = vscode.workspace.getConfiguration("autoCR");
      const next = !c.get("onMerge.enabled", false);
      c.update("onMerge.enabled", next, vscode.ConfigurationTarget.Global);
      updateStatusBar(c.get("onCommit.enabled", true), next);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoCR.triggerReviewNow", () => {
      triggerReviewNow(out);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("autoCR.selectReviewTemplate", async () => {
      const uri = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        defaultUri: workspaceRoot ? vscode.Uri.file(workspaceRoot) : undefined,
      });
      if (uri?.[0]) {
        const c = vscode.workspace.getConfiguration("autoCR");
        await c.update(
          "onCommit.templatePath",
          uri[0].fsPath,
          vscode.ConfigurationTarget.Global
        );
        vscode.window.showInformationMessage("已设置 Commit 审查模板: " + uri[0].fsPath);
      }
    })
  );

  context.subscriptions.push({ dispose: disposeStatusBar });
}

export function deactivate(): void {
  disposeStatusBar();
}
