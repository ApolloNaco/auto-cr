export interface DiffLine {
  kind: "add" | "del" | "ctx";
  text: string;
  oldLine?: number;
  newLine?: number;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  hunks: DiffHunk[];
}

function parseHunkHeader(header: string): {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
} | null {
  // @@ -a,b +c,d @@
  const m = header.match(/^@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?\s+@@/);
  if (!m) return null;
  const oldStart = parseInt(m[1], 10);
  const oldCount = m[2] ? parseInt(m[2], 10) : 1;
  const newStart = parseInt(m[3], 10);
  const newCount = m[4] ? parseInt(m[4], 10) : 1;
  return { oldStart, oldCount, newStart, newCount };
}

/**
 * Parse a unified diff as produced by `git show` or `git diff`.
 * Best-effort and intentionally conservative: if format is unexpected,
 * it will skip chunks rather than throwing.
 */
export function parseUnifiedDiff(patch: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = patch.split(/\r?\n/);
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  const flushHunk = () => {
    if (current && currentHunk) {
      current.hunks.push(currentHunk);
      currentHunk = null;
    }
  };
  const flushFile = () => {
    flushHunk();
    if (current) {
      files.push(current);
      current = null;
    }
  };

  for (const raw of lines) {
    if (raw.startsWith("diff --git ")) {
      flushFile();
      current = { path: "", hunks: [] };
      continue;
    }
    if (!current) continue;

    if (raw.startsWith("+++ ")) {
      // +++ b/path or +++ /dev/null
      const p = raw.slice(4).trim();
      if (p === "/dev/null") {
        current.path = current.path || "";
      } else if (p.startsWith("b/")) {
        current.path = p.slice(2);
      } else {
        current.path = p;
      }
      continue;
    }
    if (raw.startsWith("@@ ")) {
      flushHunk();
      const parsed = parseHunkHeader(raw);
      if (!parsed) continue;
      currentHunk = {
        header: raw,
        oldStart: parsed.oldStart,
        oldCount: parsed.oldCount,
        newStart: parsed.newStart,
        newCount: parsed.newCount,
        lines: [],
      };
      oldLine = parsed.oldStart;
      newLine = parsed.newStart;
      continue;
    }
    if (!currentHunk) continue;

    const prefix = raw[0];
    const text = raw.length > 0 ? raw.slice(1) : "";
    if (prefix === "+") {
      currentHunk.lines.push({ kind: "add", text, newLine });
      newLine++;
    } else if (prefix === "-") {
      currentHunk.lines.push({ kind: "del", text, oldLine });
      oldLine++;
    } else if (prefix === " ") {
      currentHunk.lines.push({ kind: "ctx", text, oldLine, newLine });
      oldLine++;
      newLine++;
    } else if (raw.startsWith("\\ No newline at end of file")) {
      // ignore marker
    } else {
      // Non-standard line inside hunk; ignore.
    }
  }
  flushFile();

  // Drop files without a path (format mismatch).
  return files.filter((f) => !!f.path);
}

