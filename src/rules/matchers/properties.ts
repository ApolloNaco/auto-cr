import { Finding, RuleDefinition } from "../types";

function safeRegex(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

function parsePropertiesLines(content: string): Array<{ lineNo: number; key: string; value: string; raw: string }> {
  const lines = content.split(/\r?\n/);
  const result: Array<{ lineNo: number; key: string; value: string; raw: string }> = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#") || trimmed.startsWith("!")) continue;
    const idx = raw.indexOf("=");
    if (idx < 0) continue;
    const key = raw.slice(0, idx).trim();
    const value = raw.slice(idx + 1).trim();
    if (!key) continue;
    result.push({ lineNo: i + 1, key, value, raw });
  }
  return result;
}

export function matchPropertiesKeyRegex(
  rule: RuleDefinition,
  filePath: string,
  content: string
): Finding[] {
  if (rule.trigger.type !== "propertiesKeyRegex") return [];
  const re = safeRegex(rule.trigger.pattern, rule.trigger.flags);
  if (!re) return [];

  const items = parsePropertiesLines(content);
  const findings: Finding[] = [];
  for (const it of items) {
    if (!re.test(it.key)) continue;
    findings.push({
      rule_id: rule.rule_id,
      title: rule.title,
      severity: rule.severity,
      file: filePath,
      line_start: it.lineNo,
      line_end: it.lineNo,
      snippet: rule.evidence?.requireSnippet ? it.raw : undefined,
      reason: `命中 properties key 规则正则: /${rule.trigger.pattern}/${rule.trigger.flags || ""}`,
    });
  }
  return findings;
}

