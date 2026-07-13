// artifact_class.ts — deterministic semantic artifact classifier (17 classes).
//
// Classifies a file into one of 17 semantic classes using only path,
// extension, and filename signals. No LLM. A body snippet may be passed but is
// currently ignored — it is reserved for future content-based rules.
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
    test: ({ base, ext }) =>
      base === "package.json" || base === "package-lock.json"
        ? base
        : base.includes("manifest") && ![".md", ".mdx", ".rst", ".txt"].includes(ext)
        ? "manifest"
        : null,
  },
  {
    artifactClass: "build_artifact",
    confidence: "high",
    test: ({ norm }) => {
      const m = norm.match(/\/(dist|build|\.out)\//);
      return m ? `/${m[1]}/` : null;
    },
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
 * on the path, extension, and filename. The optional `body` argument is
 * currently ignored (reserved for future content-based rules). Never throws.
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

// ---------------------------------------------------------------------------
// Placement wiring — the canonical target directory / logical layer for each
// semantic class. Consumed by the placement compiler (src/placement_policy.ts)
// so that placement depends on classification, not the reverse.
// ---------------------------------------------------------------------------

export interface PlacementHint {
  /** Canonical target directory (repo-relative, POSIX separators). */
  directory: string;
  /** Logical layer the class belongs to. */
  layer: string;
}

/** Directory into which low-confidence / unknown artifacts are quarantined. */
export const QUARANTINE_DIRECTORY = "99_CONFLICTS_AND_UNKNOWN";

/** Canonical placement hint for every one of the 17 semantic classes. */
export const CLASS_PLACEMENT_HINTS: Record<SemanticArtifactClass, PlacementHint> = {
  source_module:       { directory: "src",                    layer: "implementation" },
  type_definitions:    { directory: "src/types",              layer: "implementation" },
  test_suite:          { directory: "tests",                  layer: "verification" },
  schema:              { directory: "schemas",                layer: "contract" },
  configuration:       { directory: "config",                 layer: "operations" },
  documentation:       { directory: "docs",                   layer: "documentation" },
  contract:            { directory: "docs/contracts",         layer: "contract" },
  build_manifest:      { directory: ".",                      layer: "operations" },
  build_artifact:      { directory: "dist",                   layer: "build" },
  fixture:             { directory: "tests/fixtures",         layer: "verification" },
  script:              { directory: "scripts",                layer: "operations" },
  pipeline:            { directory: "src/pipeline",           layer: "implementation" },
  prompt_template:     { directory: "prompts",                layer: "content" },
  skill_definition:    { directory: "skills",                 layer: "content" },
  governance_doctrine: { directory: "doctrines",              layer: "governance" },
  changelog:           { directory: ".",                      layer: "documentation" },
  unknown:             { directory: QUARANTINE_DIRECTORY,     layer: "quarantine" },
};

/** Placement hint for a semantic class (falls back to the quarantine hint). */
export function placementHintFor(cls: SemanticArtifactClass): PlacementHint {
  return CLASS_PLACEMENT_HINTS[cls] ?? CLASS_PLACEMENT_HINTS.unknown;
}
