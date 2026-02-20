import * as vscode from "vscode";

let item: vscode.StatusBarItem | undefined;

export function create(
  align: vscode.StatusBarAlignment,
  priority: number
): vscode.StatusBarItem {
  item = vscode.window.createStatusBarItem(align, priority);
  return item;
}

export function update(commitOn: boolean, mergeOn: boolean): void {
  if (!item) return;
  const commit = commitOn ? "Commit ON" : "Commit OFF";
  const merge = mergeOn ? "Merge ON" : "Merge OFF";
  item.text = `CR: ${commit} | ${merge}`;
  item.tooltip = "点击切换 AutoCR 开关";
  item.command = "autoCR.toggleSettingsMenu";
  item.show();
}

export function dispose(): void {
  item?.dispose();
  item = undefined;
}
