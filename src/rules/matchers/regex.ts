import { DiffFile } from "../diff-parser";
import { Finding, RuleDefinition } from "../types";

function safeRegex(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function firstLines(text: string, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  return lines.slice(0, maxLines).join("\n");
}

export function matchDiffRegex(rule: RuleDefinition, files: DiffFile[]): Finding[] {
  if (rule.trigger.type !== "diffRegex") return [];
  const re = safeRegex(rule.trigger.pattern, rule.trigger.flags);
  if (!re) return [];

  const findings: Finding[] = [];
  const addedOnly = rule.trigger.addedLinesOnly ?? false;
  const maxSnippetLines = rule.evidence?.maxSnippetLines ?? 12;

  for (const f of files) {
    for (const h of f.hunks) {
      for (const dl of h.lines) {
        if (addedOnly && dl.kind !== "add") continue;
        const hay = dl.text;
        if (!re.test(hay)) continue;

        const snippet = rule.evidence?.requireSnippet
          ? firstLines(dl.text, maxSnippetLines)
          : undefined;

        findings.push({
          rule_id: rule.rule_id,
          title: rule.title,
          severity: rule.severity,
          file: f.path,
          line_start: dl.newLine,
          line_end: dl.newLine,
          snippet,
          reason: `命中 diff 规则正则: /${rule.trigger.pattern}/${rule.trigger.flags || ""}`,
        });
      }
    }
  }
  return findings;
}

export function matchFileRegex(
  rule: RuleDefinition,
  filePath: string,
  content: string
): Finding[] {
  if (rule.trigger.type !== "fileRegex") return [];
  const re = safeRegex(rule.trigger.pattern, rule.trigger.flags);
  if (!re) return [];

  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);
  const maxSnippetLines = rule.evidence?.maxSnippetLines ?? 12;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!re.test(line)) continue;

    const snippet = rule.evidence?.requireSnippet
      ? lines.slice(i, Math.min(lines.length, i + maxSnippetLines)).join("\n")
      : undefined;

    findings.push({
      rule_id: rule.rule_id,
      title: rule.title,
      severity: rule.severity,
      file: filePath,
      line_start: i + 1,
      line_end: i + 1,
      snippet,
      reason: `命中 file 规则正则: /${rule.trigger.pattern}/${rule.trigger.flags || ""}`,
    });
  }
  return findings;
}

