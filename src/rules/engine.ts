import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { parseUnifiedDiff, DiffFile } from "./diff-parser";
import { EngineInput, Finding, RuleDefinition, RuleCategory } from "./types";
import { matchDiffRegex, matchFileRegex } from "./matchers/regex";
import { matchPropertiesKeyRegex } from "./matchers/properties";
import { matchXmlAttributeRegex } from "./matchers/xml";
import { matchJavaAstQuery } from "./matchers/java-ast";
import { matchJavaCfgCheck } from "./matchers/java-cfg";

const DEFAULT_RULES_PATH = "rules/critical.rules.json";
const MAX_FINDINGS = 50;
const MAX_BUFFER = 8 * 1024 * 1024;
const MAX_FILE_SIZE_BYTES = 512 * 1024;

const TEST_PATTERNS = [
  /Test\.(java|kt|kts|ts|js|tsx|jsx)$/i,
  /Tests\.(java|kt|kts)$/i,
  /Spec\.(java|kt|kts|ts|js)$/i,
  /^test_.*\.py$/i,
  /\.(test|spec)\.(ts|js|tsx|jsx)$/i,
];

function isTestFile(filePath: string): boolean {
  const name = path.basename(filePath);
  return TEST_PATTERNS.some((p) => p.test(name));
}

function isExcludedByExtension(filePath: string, excludeExtensions: string[]): boolean {
  const ext = path.extname(filePath);
  return excludeExtensions.some(
    (e) => e.toLowerCase() === ext.toLowerCase() || e === ext
  );
}

function isExcludedByPath(filePath: string, excludePaths: string[]): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return excludePaths.some((p) => normalized.startsWith(p.replace(/\\/g, "/")));
}

function isExcluded(filePath: string, exclude?: EngineInput["exclude"]): boolean {
  if (!exclude) return false;
  if (isExcludedByExtension(filePath, exclude.excludeExtensions || [])) return true;
  if (isExcludedByPath(filePath, exclude.excludePaths || [])) return true;
  if (exclude.excludeTestFiles && isTestFile(filePath)) return true;
  return false;
}

function readJsonRules(filePath: string): RuleDefinition[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return parsed as RuleDefinition[];
}

function resolveToAbsolute(workspaceRoot: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(workspaceRoot, p);
}

function loadRulesFromFile(absPath: string): RuleDefinition[] {
  try {
    return readJsonRules(absPath);
  } catch {
    return [];
  }
}

function loadRulesFromDirectory(absDir: string): RuleDefinition[] {
  try {
    const entries = fs.readdirSync(absDir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".rules.json"))
      .map((e) => path.join(absDir, e.name))
      .sort();
    const all: RuleDefinition[] = [];
    for (const fp of files) {
      all.push(...loadRulesFromFile(fp));
    }
    return all;
  } catch {
    return [];
  }
}

function loadRules(workspaceRoot: string, sources?: string[]): { rules: RuleDefinition[]; sourcesUsed: string[] } {
  const resolvedSources: string[] = [];

  const candidates = (sources && sources.length > 0)
    ? sources.map((s) => s.trim()).filter(Boolean)
    : [DEFAULT_RULES_PATH];

  const rules: RuleDefinition[] = [];
  for (const src of candidates) {
    const abs = resolveToAbsolute(workspaceRoot, src);
    if (!fs.existsSync(abs)) continue;
    try {
      const st = fs.statSync(abs);
      if (st.isDirectory()) {
        const r = loadRulesFromDirectory(abs);
        if (r.length) {
          rules.push(...r);
          resolvedSources.push(abs);
        }
      } else if (st.isFile()) {
        const r = loadRulesFromFile(abs);
        if (r.length) {
          rules.push(...r);
          resolvedSources.push(abs);
        }
      }
    } catch {
      // ignore
    }
  }

  // De-dup by rule_id: later sources override earlier ones
  const map = new Map<string, RuleDefinition>();
  for (const r of rules) {
    if (!r?.rule_id) continue;
    map.set(r.rule_id, r);
  }
  return { rules: Array.from(map.values()), sourcesUsed: resolvedSources };
}

function gitShowPatch(workspaceRoot: string, commitHash: string): string {
  return execSync(`git show ${commitHash} --format= --patch`, {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
}

function gitDiffForMerge(workspaceRoot: string, branch: string): string {
  // Keep consistent with your review.md baseline convention: origin/master.
  // Note: we do not reset local branches; this is advisory only.
  try {
    execSync("git fetch --all --prune", {
      cwd: workspaceRoot,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: MAX_BUFFER,
    });
  } catch {
    // ignore fetch failure; best-effort diff
  }
  return execSync(`git diff origin/master...${branch} --patch`, {
    cwd: workspaceRoot,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
  });
}

function uniqueFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.rule_id}|${f.file}|${f.line_start ?? 0}|${f.snippet ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= MAX_FINDINGS) break;
  }
  return out;
}

function getFileText(
  workspaceRoot: string,
  relPath: string
): { text: string | null; skippedReason?: "too_large" | "not_file" | "read_error"; sizeBytes?: number } {
  const abs = path.join(workspaceRoot, relPath);
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return { text: null, skippedReason: "not_file", sizeBytes: st.size };
    if (st.size > MAX_FILE_SIZE_BYTES) {
      return { text: null, skippedReason: "too_large", sizeBytes: st.size };
    }
    return { text: fs.readFileSync(abs, "utf8"), sizeBytes: st.size };
  } catch {
    return { text: null, skippedReason: "read_error" };
  }
}

function isScopeMatch(scope: string, filePath: string): boolean {
  if (scope === "any") return true;
  const lower = filePath.toLowerCase();
  if (scope === "java") return lower.endsWith(".java");
  if (scope === "xml") return lower.endsWith(".xml");
  if (scope === "properties") return lower.endsWith(".properties");
  return false;
}

function indexRulesById(rules: RuleDefinition[]): Map<string, RuleDefinition> {
  const m = new Map<string, RuleDefinition>();
  for (const r of rules) {
    if (!r?.rule_id) continue;
    m.set(r.rule_id, r);
  }
  return m;
}

function applyCategory(findings: Finding[], rulesById: Map<string, RuleDefinition>): Finding[] {
  return findings.map((f) => {
    const r = rulesById.get(f.rule_id);
    return r?.category ? { ...f, category: r.category } : f;
  });
}

function categoryTitle(cat: RuleCategory): string {
  if (cat === "security") return "安全（Security）";
  if (cat === "performance") return "性能（Performance）";
  return "代码逻辑（Logic）";
}

export interface RunEngineResult {
  findings: Finding[];
  rulesPath?: string;
  scannedFiles: number;
  notes?: string[];
}

export function runRulesEngine(input: EngineInput): RunEngineResult {
  const loaded = loadRules(input.workspaceRoot, input.ruleSources);
  const rules = loaded.rules;
  if (!rules.length) return { findings: [], scannedFiles: 0, notes: [] };
  const rulesPath = loaded.sourcesUsed.join("; ");
  const rulesById = indexRulesById(rules);

  let patch = "";
  try {
    if (input.mode === "commit" && input.commitHash) {
      patch = gitShowPatch(input.workspaceRoot, input.commitHash);
    } else if (input.mode === "merge" && input.branch) {
      patch = gitDiffForMerge(input.workspaceRoot, input.branch);
    }
  } catch {
    patch = "";
  }

  const diffFiles: DiffFile[] = patch ? parseUnifiedDiff(patch) : [];
  const findings: Finding[] = [];
  const notes: string[] = [];

  // 1) Diff-based rules
  for (const rule of rules) {
    if (!rule || rule.severity !== "critical") continue;
    if (rule.trigger.type !== "diffRegex") continue;
    const scoped = diffFiles
      .filter((f) => isScopeMatch(rule.scope, f.path))
      .filter((f) => !isExcluded(f.path, input.exclude));
    findings.push(...matchDiffRegex(rule, scoped));
    if (findings.length >= MAX_FINDINGS) break;
  }

  // 2) File-content rules on changed files only (best-effort)
  const changedPaths = new Set<string>();
  for (const f of diffFiles) {
    if (isExcluded(f.path, input.exclude)) continue;
    changedPaths.add(f.path);
  }

  let scanned = 0;
  for (const rel of changedPaths) {
    const r = getFileText(input.workspaceRoot, rel);
    if (r.text == null) {
      if (r.skippedReason === "too_large") {
        const kb = typeof r.sizeBytes === "number" ? Math.ceil(r.sizeBytes / 1024) : undefined;
        notes.push(
          `文件过大已降级仅跑 diffRegex：\`${rel}\`${kb ? `（约 ${kb}KB）` : ""}；未执行 fileRegex/properties/xml/AST/CFG`
        );
      }
      continue;
    }
    scanned++;
    for (const rule of rules) {
      if (!rule || rule.severity !== "critical") continue;
      if (!isScopeMatch(rule.scope, rel)) continue;
      if (rule.trigger.type === "fileRegex") {
        findings.push(...matchFileRegex(rule, rel, r.text));
      } else if (rule.trigger.type === "propertiesKeyRegex") {
        findings.push(...matchPropertiesKeyRegex(rule, rel, r.text));
      } else if (rule.trigger.type === "xmlAttributeRegex") {
        findings.push(...matchXmlAttributeRegex(rule, rel, r.text));
      } else if (rule.trigger.type === "javaAstQuery") {
        // AST matching reads file content itself; we already checked size via getFileText.
        findings.push(...matchJavaAstQuery(rule, input.workspaceRoot, rel));
      } else if (rule.trigger.type === "javaCfgCheck") {
        findings.push(...matchJavaCfgCheck(rule, input.workspaceRoot, rel));
      }
      if (findings.length >= MAX_FINDINGS) break;
    }
    if (findings.length >= MAX_FINDINGS) break;
  }

  return {
    findings: applyCategory(uniqueFindings(findings), rulesById),
    rulesPath,
    scannedFiles: scanned,
    notes,
  };
}

export function formatFindingsAsMarkdown(
  findings: Finding[],
  meta?: { rulesPath?: string; scannedFiles?: number; notes?: string[] }
): string {
  const notes = meta?.notes?.filter(Boolean) ?? [];
  if (!findings.length && notes.length === 0) {
    return `--- 可执行规则命中（Critical） ---\n无`;
  }
  const header = `--- 可执行规则命中（Critical） ---\n` +
    (meta?.rulesPath ? `规则集: ${meta.rulesPath}\n` : "") +
    (typeof meta?.scannedFiles === "number" ? `扫描文件: ${meta.scannedFiles}\n` : "") +
    `命中数量: ${findings.length}\n`;

  const noteBlock =
    notes.length > 0
      ? `\n--- 降级/限制说明 ---\n${notes.map((n) => `- ${n}`).join("\n")}\n`
      : "";

  const renderItems = (items: Finding[], indexOffset: number) =>
    items.map((f, idx) => {
      const loc =
        f.line_start && f.line_end
          ? `${f.file}:${f.line_start}-${f.line_end}`
          : f.line_start
            ? `${f.file}:${f.line_start}`
            : f.file;
      const snippet = f.snippet ? `\n\n\`\`\`\n${f.snippet}\n\`\`\`` : "";
      const cat = f.category ? `\n- 分类: \`${f.category}\`` : "";
      return `### R${indexOffset + idx + 1}. ${f.title}\n- rule_id: \`${f.rule_id}\`${cat}\n- 位置: \`${loc}\`\n- 原因: ${f.reason}${snippet}`;
    })
    .join("\n\n");

  const groups: Array<{ cat?: RuleCategory; title: string; items: Finding[] }> = [
    { cat: "security", title: categoryTitle("security"), items: [] },
    { cat: "performance", title: categoryTitle("performance"), items: [] },
    { cat: "logic", title: categoryTitle("logic"), items: [] },
    { cat: undefined, title: "未分类（Uncategorized）", items: [] },
  ];
  for (const f of findings) {
    const g = groups.find((x) => x.cat === (f.category ?? undefined)) ?? groups[3];
    g.items.push(f);
  }
  const nonEmpty = groups.filter((g) => g.items.length > 0);
  let offset = 0;
  const body = nonEmpty
    .map((g) => {
      const section = `## ${g.title}（${g.items.length}）\n\n${renderItems(g.items, offset)}`;
      offset += g.items.length;
      return section;
    })
    .join("\n\n");

  return `${header}${noteBlock}\n${body || "无"}`;
}

