import * as vscode from "vscode";
import { showError } from "./error-notifier";

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 500;

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function openAgentChat(): Promise<boolean> {
  const commands = ["composer.newAgentChat", "aichat.newchataction"];
  for (let i = 0; i < MAX_RETRIES; i++) {
    for (const cmd of commands) {
      try {
        await vscode.commands.executeCommand(cmd);
        await sleep(300);
        return true;
      } catch {
        // try next
      }
    }
    if (i < MAX_RETRIES - 1) await sleep(RETRY_DELAY_MS);
  }
  return false;
}

async function submitChat(): Promise<boolean> {
  const commands = ["composer.submitChat", "composer.submit"];
  for (const cmd of commands) {
    try {
      await vscode.commands.executeCommand(cmd);
      return true;
    } catch {
      // continue
    }
  }
  return false;
}

export async function triggerReview(
  instruction: string,
  outputChannel: vscode.OutputChannel
): Promise<void> {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const autoSubmit = cfg.get<boolean>("autoSubmit", true);

  let clipboardBackup: string | undefined;
  try {
    clipboardBackup = await vscode.env.clipboard.readText();
  } catch {
    // ignore
  }

  try {
    const opened = await openAgentChat();
    if (!opened) {
      showError("无法打开 Agent 对话，请检查 Cursor 版本或手动执行 /review");
      return;
    }
    await sleep(400);
    await vscode.env.clipboard.writeText(instruction);
    await sleep(200);
    await vscode.commands.executeCommand("editor.action.clipboardPasteAction");
    await sleep(200);
    if (autoSubmit) {
      const submitted = await submitChat();
      if (!submitted) {
        outputChannel.appendLine("自动提交未生效，请手动按 Enter 发送");
      }
    }
    await vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    showError("触发审查失败: " + msg);
    return;
  } finally {
    try {
      if (clipboardBackup !== undefined) {
        await vscode.env.clipboard.writeText(clipboardBackup);
      }
    } catch {
      // ignore restore
    }
  }
}
