import * as fs from "fs";
import * as http from "http";
import * as https from "https";
import * as path from "path";
import * as vscode from "vscode";
import { log } from "./error-notifier";

const TEXT_MAX = 5000;
const URL_MAX = 2000;
const DIR_MAX_FILES = 10;
const DIR_MAX_FILE_SIZE = 50 * 1024;

export interface ExtraContextItem {
  type: "text" | "directory" | "url";
  value: string;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + "...[截断]";
}

function resolveText(item: ExtraContextItem): string {
  return truncate(item.value.trim(), TEXT_MAX);
}

function resolveDirectory(
  workspaceRoot: string,
  item: ExtraContextItem
): { text: string; source: string } {
  const raw = item.value.trim();
  const dirPath = path.isAbsolute(raw) ? raw : path.join(workspaceRoot, raw);
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
    log(`上下文目录不存在或非目录: ${dirPath}`);
    return { text: "", source: "" };
  }
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  const textFiles = entries
    .filter((e) => e.isFile() && !e.name.startsWith("."))
    .slice(0, DIR_MAX_FILES);
  const parts: string[] = [];
  for (const f of textFiles) {
    const fp = path.join(dirPath, f.name);
    try {
      const stat = fs.statSync(fp);
      if (stat.size > DIR_MAX_FILE_SIZE) continue;
      const content = fs.readFileSync(fp, "utf8");
      parts.push(`### ${f.name}\n${truncate(content, DIR_MAX_FILE_SIZE)}`);
    } catch {
      // skip binary or unreadable
    }
  }
  const text = parts.join("\n\n");
  return {
    text,
    source: `[目录] ${raw} (${textFiles.length} 个文件)`,
  };
}

function resolveUrl(item: ExtraContextItem): Promise<{ text: string; source: string }> {
  const url = item.value.trim();
  const protocol = url.startsWith("https") ? https : http;
  return new Promise((resolve) => {
    const req = protocol.get(url, { timeout: 10000 }, (res: http.IncomingMessage) => {
      let data = "";
      res.on("data", (ch: Buffer) => (data += ch.toString()));
      res.on("end", () =>
        resolve({
          text: truncate(data, URL_MAX),
          source: `[网页] ${url}`,
        })
      );
    });
    req.on("error", () => {
      log(`获取 URL 失败: ${url}`);
      resolve({ text: "", source: "" });
    });
    req.on("timeout", () => {
      req.destroy();
      log(`URL 超时: ${url}`);
      resolve({ text: "", source: "" });
    });
  });
}

export async function resolveExtraContext(
  workspaceRoot: string
): Promise<{ body: string; sources: string[] }> {
  const cfg = vscode.workspace.getConfiguration("autoCR");
  const items = (cfg.get<ExtraContextItem[]>("extraContext") || []).filter(
    (x) => x && x.type && x.value
  );
  const parts: string[] = [];
  const sources: string[] = [];
  for (const item of items) {
    if (item.type === "text") {
      const t = resolveText(item);
      if (t) {
        parts.push(t);
        sources.push("[文本] " + truncate(item.value, 50));
      }
    } else if (item.type === "directory") {
      const { text, source } = resolveDirectory(workspaceRoot, item);
      if (text) {
        parts.push(text);
        if (source) sources.push(source);
      }
    } else if (item.type === "url") {
      const { text, source } = await resolveUrl(item);
      if (text) {
        parts.push(text);
        if (source) sources.push(source);
      }
    }
  }
  const body = parts.join("\n\n---\n\n");
  return { body, sources };
}
