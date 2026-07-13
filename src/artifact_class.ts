// artifact_class.ts — deterministic semantic artifact classifier (17 classes).
//
// Classifies a file into one of 17 semantic classes using only path,
// extension, and filename signals (optionally a small body snippet). No LLM.
// Additive to the coarse ArtifactType taxonomy in schema.ts.

import * as path from "path";
import {
  SemanticArtifactClass,
  ArtifactClassification,
  ClassConfidence,
} from "./schema";

/** The 17 semantic classes, in canonical order. */
export const SEMANTIC_ARTIFACT_CLASSES: readonly SemanticArtifactClass[] = [
  "source_module",
  "type_definitions",
  "test_suite",
  "schema",
  "configuration",
  "documentation",
  "contract",
  "build_manifest",
  "build_artifact",
  "fixture",
  "script",
  "pipeline",
  "prompt_template",
  "skill_definition",
  "governance_doctrine",
  "changelog",
  "unknown",
];

interface Rule {
  artifactClass: SemanticArtifactClass;
  confidence: ClassConfidence;
  test: (ctx: { base: string; ext: string; norm: string; text: string }) => string | null;
}

// Ordered most-specific-first; the first matching rule wins.
const RULES: Rule[] = [
  {
    artifactClass: "type_definitions",
    confidence: "high",
    test: ({ base }) => (base.endsWith(".d.ts") ? "*.d.ts" : null),
  },
  {
    artifactClass: "test_suite",
    confidence: "high",
    test: ({ base, norm }) =>
      /\.(test|spec)\.[cm]?[jt]sx?$/.test(base)
        ? "*.test/spec.*"
        : /\/(tests?|__tests__)\//.test(norm)
        ? "/tests/"
        : null,
  },
  {
    artifactClass: "schema",
    confidence: "high",
    test: ({ base, norm }) =>
      base.includes(".schema.") || base === "schema.ts" || base.endsWith("_schema.ts")
        ? ".schema."
        : /\/schemas?\//.test(norm)
        ? "/schemas/"
        : null,
  },
  {
    artifactClass: "changelog",
    confidence: "high",
    test: ({ base }) => (/^changelog/i.test(base) || base.includes("changelog") ? "changelog" : null),
  },
  {
    artifactClass: "contract",
    confidence: "high",
    test: ({ base, norm }) =>
      base.includes(".contract.") || base.includes("contract")
        ? "contract"
        : /\/contracts?\//.test(norm)
        ? "/contracts/"
        : null,
  },
  {
    artifactClass: "build_manifest",
    confidence: "high",
    test: ({ base }) =>
      base === "package.json" || base === "package-lock.json"
        ? base
        : base.includes("manifest")
        ? "manifest"
        : null,
  },
  {
    artifactClass: "build_artifact",
    confidence: "high",
    test: ({ norm }) => (/\/(dist|build|\.out)\//.test(norm) ? "/dist/" : null),
  },
  {
    artifactClass: "prompt_template",
    confidence: "high",
    test: ({ base, norm }) =>
      /^prompt-/.test(base) || base.includes(".prompt.")
        ? "prompt-"
        : /\/prompts?\//.test(norm)
        ? "/prompts/"
        : null,
  },
  {
    artifactClass: "skill_definition",
    confidence: "high",
    test: ({ base, norm }) =>
      base.includes(".skill.") ? ".skill." : /\/skills?\//.test(norm) ? "/skills/" : null,
  },
  {
    artifactClass: "governance_doctrine",
    confidence: "high",
    test: ({ base, norm }) =>
      base.includes(".doctrine.") || base.includes("doctrine") || base.includes("policy")
        ? "doctrine"
        : /\/doctrines?\//.test(norm)
        ? "/doctrines/"
        : null,
  },
  {
    artifactClass: "pipeline",
    confidence: "high",
    test: ({ base, norm }) =>
      base.includes("pipeline") || /\/pipelines?\//.test(norm) ? "pipeline" : null,
  },
  {
    artifactClass: "fixture",
    confidence: "high",
    test: ({ base, norm }) =>
      /\/(fixtures?|examples?|mocks?)\//.test(norm) || base.includes("fixture") || base.includes("mock")
        ? "fixture"
        : null,
  },
  {
    artifactClass: "script",
    confidence: "high",
    test: ({ ext, norm }) =>
      [".sh", ".bash", ".zsh", ".py"].includes(ext)
        ? ext
        : /\/scripts?\//.test(norm)
        ? "/scripts/"
        : null,
  },
  {
    artifactClass: "configuration",
    confidence: "high",
    test: ({ base, ext }) =>
      /\.config\.[cm]?[jt]s$/.test(base) || /^tsconfig.*\.json$/.test(base) || /^\..*rc(\..+)?$/.test(base)
        ? "config"
        : [".json", ".yaml", ".yml", ".toml", ".ini"].includes(ext)
        ? ext
        : null,
  },
  {
    artifactClass: "documentation",
    confidence: "high",
    test: ({ ext, norm }) =>
      [".md", ".mdx", ".rst", ".txt"].includes(ext) ? ext : /\/docs?\//.test(norm) ? "/docs/" : null,
  },
  {
    artifactClass: "source_module",
    confidence: "medium",
    test: ({ ext }) =>
      [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext) ? ext : null,
  },
];

/**
 * Classify a file into one of 17 semantic classes. Deterministic: depends only
 * on the path (and optional body snippet). Never throws.
 */
export function classifyArtifact(filePath: string, body = ""): ArtifactClassification {
  const base = path.basename(String(filePath)).toLowerCase();
  const ext = path.extname(base);
  // Leading "/" guarantees a boundary so segment checks (e.g. "/dist/") also
  // match when the segment starts a relative path ("dist/index.js").
  const norm = ("/" + String(filePath).replace(/\\/g, "/")).toLowerCase();
  const text = (base + " " + body.slice(0, 400)).toLowerCase();
  const ctx = { base, ext, norm, text };

  for (const rule of RULES) {
    const signal = rule.test(ctx);
    if (signal) {
      return { artifactClass: rule.artifactClass, confidence: rule.confidence, signals: [signal] };
    }
  }
  return { artifactClass: "unknown", confidence: "low", signals: [] };
}

/** True if the value is one of the 17 known semantic classes. */
export function isSemanticArtifactClass(value: string): value is SemanticArtifactClass {
  return (SEMANTIC_ARTIFACT_CLASSES as readonly string[]).includes(value);
}
