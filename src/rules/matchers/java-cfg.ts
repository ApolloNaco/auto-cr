import * as fs from "fs";
import * as path from "path";
import * as Parser from "tree-sitter";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Java = require("tree-sitter-java");

import { Finding, RuleDefinition } from "../types";

let cachedParser: any | null = null;

function getParser(): any {
  if (cachedParser) return cachedParser;
  const P: any = (Parser as any).default ?? Parser;
  const p = new P();
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

function snippet(text: string, startRow: number, endRow: number, maxLines: number): string {
  const lines = text.split(/\r?\n/);
  const start = Math.max(1, startRow + 1);
  const end = Math.min(lines.length, endRow + 1);
  const clippedEnd = Math.min(end, start + maxLines - 1);
  return lines.slice(start - 1, clippedEnd).join("\n");
}

function walk(node: any, fn: (n: any) => void): void {
  fn(node);
  for (const ch of node.namedChildren ?? []) walk(ch, fn);
}

function findMethodBodies(root: any): any[] {
  const methods: any[] = [];
  walk(root, (n) => {
    if (n.type === "method_declaration") methods.push(n);
  });
  return methods;
}

function hasTryWithResources(methodNode: any): boolean {
  let found = false;
  walk(methodNode, (n) => {
    if (n.type === "try_with_resources_statement") found = true;
  });
  return found;
}

function findResourceCreations(methodNode: any): any[] {
  // Heuristic: `new <X>InputStream/OutputStream/Reader/Writer/Socket/...`
  const hits: any[] = [];
  walk(methodNode, (n) => {
    if (n.type !== "object_creation_expression") return;
    const typeNode = n.childForFieldName?.("type");
    const typeText = typeNode?.text ?? "";
    if (!typeText) return;
    if (/(InputStream|OutputStream|Reader|Writer|Socket|Connection|Channel|RandomAccessFile)\b/.test(typeText)) {
      hits.push(n);
    }
  });
  return hits;
}

function findCatchClauses(methodNode: any): any[] {
  const hits: any[] = [];
  walk(methodNode, (n) => {
    if (n.type === "catch_clause") hits.push(n);
  });
  return hits;
}

function catchLooksSwallowing(catchNode: any): boolean {
  const block = catchNode.childForFieldName?.("body");
  if (!block) return false;
  const txt = block.text ?? "";
  // minimal heuristic: no throw/return inside, and has some statement (e.g. log)
  const hasThrow = /\bthrow\b/.test(txt);
  const hasReturn = /\breturn\b/.test(txt);
  if (hasThrow || hasReturn) return false;
  // If block is empty, also counts (swallow)
  const hasAny = /;|[A-Za-z0-9_]+\s*\(/.test(txt);
  return true && hasAny;
}

/**
 * Stage-3 (minimal) CFG/dataflow checks:
 * - resource_not_try_with_resources: if method creates likely-resource objects but has no try-with-resources at all.
 * - catch_without_rethrow: if a catch clause appears to swallow exceptions (heuristic).
 *
 * This is NOT a full CFG; it's an on-demand, intra-procedural approximation with AST evidence.
 */
export function matchJavaCfgCheck(
  rule: RuleDefinition,
  workspaceRoot: string,
  relPath: string
): Finding[] {
  if (rule.trigger.type !== "javaCfgCheck") return [];
  const text = readFileText(workspaceRoot, relPath);
  if (text == null) return [];

  const parser = getParser();
  const tree = parser.parse(text);
  const root = tree.rootNode;

  const findings: Finding[] = [];
  const maxSnippetLines = rule.evidence?.maxSnippetLines ?? 12;

  for (const m of findMethodBodies(root)) {
    const body = m.childForFieldName?.("body");
    if (!body) continue;

    if (rule.trigger.checkId === "resource_not_try_with_resources") {
      const hasTry = hasTryWithResources(m);
      if (hasTry) continue;
      const creates = findResourceCreations(m);
      if (!creates.length) continue;
      const hit = creates[0];
      findings.push({
        rule_id: rule.rule_id,
        title: rule.title,
        severity: rule.severity,
        file: relPath,
        line_start: hit.startPosition.row + 1,
        line_end: hit.endPosition.row + 1,
        snippet: rule.evidence?.requireSnippet
          ? snippet(text, hit.startPosition.row, hit.endPosition.row, maxSnippetLines)
          : undefined,
        reason: "方法内创建疑似资源对象，但未发现 try-with-resources（启发式/按需分析）",
      });
    } else if (rule.trigger.checkId === "catch_without_rethrow") {
      const catches = findCatchClauses(m);
      for (const c of catches) {
        if (!catchLooksSwallowing(c)) continue;
        findings.push({
          rule_id: rule.rule_id,
          title: rule.title,
          severity: rule.severity,
          file: relPath,
          line_start: c.startPosition.row + 1,
          line_end: c.endPosition.row + 1,
          snippet: rule.evidence?.requireSnippet
            ? snippet(text, c.startPosition.row, c.endPosition.row, maxSnippetLines)
            : undefined,
          reason: "catch 中未发现 throw/return，疑似吞异常（启发式/按需分析）",
        });
        break;
      }
    }
  }

  return findings;
}

