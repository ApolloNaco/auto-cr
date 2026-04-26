import * as fs from "fs";
import * as path from "path";
import * as Parser from "tree-sitter";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Java = require("tree-sitter-java");

import { Finding, RuleDefinition } from "../types";

let cachedParser: Parser | null = null;

function getParser(): Parser {
  if (cachedParser) return cachedParser;
  const P: unknown = (Parser as unknown as { default?: any }).default ?? (Parser as unknown);
  const p = new (P as any)();
  p.setLanguage(Java);
  cachedParser = p;
  return p;
}

function readFileText(workspaceRoot: string, relPath: string): string | null {
  const abs = path.join(workspaceRoot, relPath);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return null;
    if (st.size > 512 * 1024) return null;
    return fs.readFileSync(abs, "utf8");
  } catch {
    return null;
  }
}

function nodeToLineRange(text: string, node: Parser.SyntaxNode): { start: number; end: number } {
  // Tree-sitter is 0-based rows.
  const start = node.startPosition.row + 1;
  const end = node.endPosition.row + 1;
  return { start, end };
}

function extractSnippet(text: string, startLine: number, endLine: number, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  const s = Math.max(1, startLine);
  const e = Math.min(lines.length, endLine);
  const clippedEnd = Math.min(e, s + maxLines - 1);
  return lines.slice(s - 1, clippedEnd).join("\n");
}

/**
 * Stage-2 matcher: run a Tree-sitter query against a Java file.
 *
 * Query should capture a node named `@hit` to indicate finding location.
 */
export function matchJavaAstQuery(
  rule: RuleDefinition,
  workspaceRoot: string,
  relPath: string
): Finding[] {
  if (rule.trigger.type !== "javaAstQuery") return [];
  const text = readFileText(workspaceRoot, relPath);
  if (text == null) return [];

  const parser = getParser();
  const tree = parser.parse(text);

  let query: Parser.Query;
  try {
    const P: any = (Parser as any).default ?? Parser;
    query = new P.Query(Java, rule.trigger.query);
  } catch {
    return [];
  }

  const findings: Finding[] = [];
  const caps = query.captures(tree.rootNode);
  const maxSnippetLines = rule.evidence?.maxSnippetLines ?? 12;

  for (const c of caps) {
    if (c.name !== "hit") continue;
    const lr = nodeToLineRange(text, c.node);
    const snippet = rule.evidence?.requireSnippet
      ? extractSnippet(text, lr.start, lr.end, maxSnippetLines)
      : undefined;
    findings.push({
      rule_id: rule.rule_id,
      title: rule.title,
      severity: rule.severity,
      file: relPath,
      line_start: lr.start,
      line_end: lr.end,
      snippet,
      reason: "命中 Java AST Query 规则（tree-sitter）",
    });
  }

  return findings;
}

