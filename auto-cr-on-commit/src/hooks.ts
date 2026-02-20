import * as fs from "fs";
import * as path from "path";

const PENDING_REVIEW_MARKER = ".pending-review";
const PENDING_MERGE_MARKER = ".pending-merge-review";
const AUTO_CR_MARKER = "AUTO_CR_POST_COMMIT";
const AUTO_CR_MERGE_MARKER = "AUTO_CR_POST_MERGE";

function postCommitScript(gitDir: string): string {
  const target = path.join(gitDir, PENDING_REVIEW_MARKER);
  return `
# --- ${AUTO_CR_MARKER} ---
REVIEW_FILE="${target.replace(/\\/g, "/")}"
if [ -n "$REVIEW_FILE" ]; then
  git rev-parse HEAD > "$REVIEW_FILE" 2>/dev/null || true
fi
# --- end ${AUTO_CR_MARKER} ---
`;
}

function postMergeScript(gitDir: string): string {
  const target = path.join(gitDir, PENDING_MERGE_MARKER);
  return `
# --- ${AUTO_CR_MERGE_MARKER} ---
CUR=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
REVIEW_FILE="${target.replace(/\\/g, "/")}"
case "$CUR" in
  master|main)
    MSG=$(git log -1 --pretty=%s HEAD 2>/dev/null)
    BRANCH=$(echo "$MSG" | sed -n "s/^Merge branch .'\\([^']*\\)'.*/\\1/p")
    [ -z "$BRANCH" ] && BRANCH=$(echo "$MSG" | sed -n 's/^Merge branch "\\([^"]*\\)".*/\\1/p')
    [ -n "$BRANCH" ] && [ -n "$REVIEW_FILE" ] && echo "$BRANCH" > "$REVIEW_FILE" 2>/dev/null || true
    ;;
esac
# --- end ${AUTO_CR_MERGE_MARKER} ---
`;
}

export function getPendingReviewPath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".git", PENDING_REVIEW_MARKER);
}

export function getPendingMergePath(workspaceRoot: string): string {
  return path.join(workspaceRoot, ".git", PENDING_MERGE_MARKER);
}

export function hasPostCommitHookContent(content: string): boolean {
  return content.includes(AUTO_CR_MARKER);
}

export function hasPostMergeHookContent(content: string): boolean {
  return content.includes(AUTO_CR_MERGE_MARKER);
}

export function installPostCommitHook(workspaceRoot: string, log: (msg: string) => void): boolean {
  const gitDir = path.join(workspaceRoot, ".git");
  const hookPath = path.join(gitDir, "hooks", "post-commit");
  try {
    let content = "";
    if (fs.existsSync(hookPath)) {
      content = fs.readFileSync(hookPath, "utf8");
      if (hasPostCommitHookContent(content)) {
        log("post-commit hook 已包含 Auto CR 逻辑，跳过");
        return true;
      }
    } else {
      fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    }
    const toAppend = postCommitScript(gitDir);
    fs.writeFileSync(hookPath, content + toAppend, "utf8");
    fs.chmodSync(hookPath, 0o755);
    log("post-commit hook 已安装");
    return true;
  } catch (e) {
    log("安装 post-commit hook 失败: " + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

export function installPostMergeHook(workspaceRoot: string, log: (msg: string) => void): boolean {
  const gitDir = path.join(workspaceRoot, ".git");
  const hookPath = path.join(gitDir, "hooks", "post-merge");
  try {
    let content = "";
    if (fs.existsSync(hookPath)) {
      content = fs.readFileSync(hookPath, "utf8");
      if (hasPostMergeHookContent(content)) {
        log("post-merge hook 已包含 Auto CR 逻辑，跳过");
        return true;
      }
    } else {
      fs.mkdirSync(path.dirname(hookPath), { recursive: true });
    }
    const toAppend = postMergeScript(gitDir);
    fs.writeFileSync(hookPath, content + toAppend, "utf8");
    fs.chmodSync(hookPath, 0o755);
    log("post-merge hook 已安装");
    return true;
  } catch (e) {
    log("安装 post-merge hook 失败: " + (e instanceof Error ? e.message : String(e)));
    return false;
  }
}

export function checkPostCommitHook(workspaceRoot: string): boolean {
  const hookPath = path.join(workspaceRoot, ".git", "hooks", "post-commit");
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, "utf8");
  return hasPostCommitHookContent(content);
}

export function checkPostMergeHook(workspaceRoot: string): boolean {
  const hookPath = path.join(workspaceRoot, ".git", "hooks", "post-merge");
  if (!fs.existsSync(hookPath)) return false;
  const content = fs.readFileSync(hookPath, "utf8");
  return hasPostMergeHookContent(content);
}
