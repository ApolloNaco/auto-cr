import * as vscode from "vscode";
import { update as updateStatusBar } from "./status-bar";

export type ConfirmResult = "yes" | "skip" | "disable";

export async function confirmBeforeReview(
  trigger: "commit" | "merge",
  detail: string
): Promise<ConfirmResult> {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  if (!cfg.get<boolean>("confirmBeforeReview", true)) {
    return "yes";
  }
  const message = trigger === "commit"
    ? `是否对本次提交执行代码审查？\n${detail}`
    : `是否对本次合并执行代码审查？\n${detail}`;
  const choice = await vscode.window.showInformationMessage(
    message,
    { modal: true },
    "是",
    "跳过本次",
    "关闭自动 CR"
  );
  if (choice === "关闭自动 CR") {
    if (trigger === "commit") {
      await cfg.update("onCommit.enabled", false, vscode.ConfigurationTarget.Global);
    } else {
      await cfg.update("onMerge.enabled", false, vscode.ConfigurationTarget.Global);
    }
    const c = vscode.workspace.getConfiguration("autoCR");
    updateStatusBar(c.get("onCommit.enabled", true), c.get("onMerge.enabled", false));
    vscode.window.showInformationMessage(
      "已关闭自动 CR，可通过状态栏重新开启"
    );
    return "disable";
  }
  if (choice === "跳过本次") return "skip";
  return "yes";
}
