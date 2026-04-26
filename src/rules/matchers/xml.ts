import { Finding, RuleDefinition } from "../types";

function safeRegex(pattern: string, flags?: string): RegExp | null {
  try {
    return new RegExp(pattern, flags);
  } catch {
    return null;
  }
}

/**
 * Lightweight XML attribute scanning without building a full DOM.
 * It scans tag attribute text segments and applies regex to the `name="value"` pairs.
 *
 * This is intentionally conservative and works well for config-style rules.
 */
export function matchXmlAttributeRegex(
  rule: RuleDefinition,
  filePath: string,
  content: string
): Finding[] {
  if (rule.trigger.type !== "xmlAttributeRegex") return [];
  const re = safeRegex(rule.trigger.pattern, rule.trigger.flags);
  if (!re) return [];

  const findings: Finding[] = [];
  const lines = content.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Best-effort: only scan lines containing "<" and "="
    if (!line.includes("<") || !line.includes("=")) continue;
    if (!re.test(line)) continue;
    findings.push({
      rule_id: rule.rule_id,
      title: rule.title,
      severity: rule.severity,
      file: filePath,
      line_start: i + 1,
      line_end: i + 1,
      snippet: rule.evidence?.requireSnippet ? line.trim() : undefined,
      reason: `命中 xml attribute 规则正则: /${rule.trigger.pattern}/${rule.trigger.flags || ""}`,
    });
  }

  return findings;
}

