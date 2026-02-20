import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;

export function setOutputChannel(channel: vscode.OutputChannel): void {
  outputChannel = channel;
}

export function log(msg: string): void {
  outputChannel?.appendLine(msg);
}

export function showError(message: string, context?: string): void {
  const full = context ? `${message} (${context})` : message;
  outputChannel?.appendLine("[错误] " + full);
  vscode.window
    .showErrorMessage(full, "查看输出日志")
    .then((choice) => {
      if (choice === "查看输出日志" && outputChannel) {
        outputChannel.show();
      }
    });
}
