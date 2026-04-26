export type RuleScope = "java" | "xml" | "properties" | "any";

export type RuleSeverity = "critical" | "major" | "minor";

export type RuleCategory = "security" | "performance" | "logic";

export interface RuleEvidenceSpec {
  /**
   * If true, the engine must include a code snippet in the finding.
   */
  requireSnippet?: boolean;
  /**
   * Max snippet lines to include (best-effort).
   */
  maxSnippetLines?: number;
}

export type RuleTrigger =
  | {
      type: "diffRegex";
      /**
       * JavaScript regex string, evaluated with flags below.
       * Example: "(?i)password\\s*=" is NOT supported; use flags instead.
       */
      pattern: string;
      flags?: string;
      /**
       * Optional: only apply to added lines in diff.
       */
      addedLinesOnly?: boolean;
    }
  | {
      type: "fileRegex";
      pattern: string;
      flags?: string;
    }
  | {
      type: "propertiesKeyRegex";
      pattern: string;
      flags?: string;
    }
  | {
      type: "xmlAttributeRegex";
      /**
       * Regex applied against the serialized `name="value"` pairs per tag.
       */
      pattern: string;
      flags?: string;
    }
  | {
      /**
       * Reserved for stage-2 AST matching.
       */
      type: "javaAstQuery";
      query: string;
    }
  | {
      /**
       * Reserved for stage-3 CFG/dataflow checks.
       */
      type: "javaCfgCheck";
      checkId: string;
    };

export interface RuleDefinition {
  rule_id: string;
  title: string;
  severity: RuleSeverity;
  /**
   * High-level grouping for review: security / performance / logic.
   */
  category?: RuleCategory;
  scope: RuleScope;
  trigger: RuleTrigger;
  evidence?: RuleEvidenceSpec;
  suggestion?: string;
}

export interface Finding {
  rule_id: string;
  title: string;
  severity: RuleSeverity;
  category?: RuleCategory;
  file: string;
  /**
   * Best-effort 1-based line range in the *new* file (for diffs),
   * or in the file (for file-content scanning).
   */
  line_start?: number;
  line_end?: number;
  snippet?: string;
  reason: string;
}

export interface EngineInput {
  workspaceRoot: string;
  mode: "commit" | "merge";
  commitHash?: string;
  branch?: string;
  /**
   * Optional rules sources to load from.
   * - If omitted, engine falls back to `${workspaceRoot}/rules/critical.rules.json` if present.
   * - Each entry can be a file path or directory path; relative paths are resolved from workspaceRoot.
   */
  ruleSources?: string[];
  /**
   * Optional exclusion rules, typically from AutoCR settings.
   * If provided, the rules engine will skip excluded files for BOTH diff rules and file-content rules.
   */
  exclude?: {
    excludeExtensions: string[];
    excludePaths: string[];
    excludeTestFiles: boolean;
  };
}

