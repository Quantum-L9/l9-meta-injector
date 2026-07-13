"use strict";
// artifact_class.ts — deterministic semantic artifact classifier (17 classes).
//
// Classifies a file into one of 17 semantic classes using only path,
// extension, and filename signals. No LLM. A body snippet may be passed but is
// currently ignored — it is reserved for future content-based rules.
// Additive to the coarse ArtifactType taxonomy in schema.ts.
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CLASS_PLACEMENT_HINTS = exports.QUARANTINE_DIRECTORY = exports.SEMANTIC_ARTIFACT_CLASSES = void 0;
exports.classifyArtifact = classifyArtifact;
exports.isSemanticArtifactClass = isSemanticArtifactClass;
exports.placementHintFor = placementHintFor;
const path = __importStar(require("path"));
/** The 17 semantic classes, in canonical order. */
exports.SEMANTIC_ARTIFACT_CLASSES = [
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
// Ordered most-specific-first; the first matching rule wins.
const RULES = [
    {
        artifactClass: "type_definitions",
        confidence: "high",
        test: ({ base }) => (base.endsWith(".d.ts") ? "*.d.ts" : null),
    },
    {
        artifactClass: "test_suite",
        confidence: "high",
        test: ({ base, norm }) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(base)
            ? "*.test/spec.*"
            : /\/(tests?|__tests__)\//.test(norm)
                ? "/tests/"
                : null,
    },
    {
        artifactClass: "schema",
        confidence: "high",
        test: ({ base, norm }) => base.includes(".schema.") || base === "schema.ts" || base.endsWith("_schema.ts")
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
        test: ({ base, norm }) => base.includes(".contract.") || base.includes("contract")
            ? "contract"
            : /\/contracts?\//.test(norm)
                ? "/contracts/"
                : null,
    },
    {
        artifactClass: "build_manifest",
        confidence: "high",
        test: ({ base, ext }) => base === "package.json" || base === "package-lock.json"
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
        test: ({ base, norm }) => /^prompt-/.test(base) || base.includes(".prompt.")
            ? "prompt-"
            : /\/prompts?\//.test(norm)
                ? "/prompts/"
                : null,
    },
    {
        artifactClass: "skill_definition",
        confidence: "high",
        test: ({ base, norm }) => base.includes(".skill.") ? ".skill." : /\/skills?\//.test(norm) ? "/skills/" : null,
    },
    {
        artifactClass: "governance_doctrine",
        confidence: "high",
        test: ({ base, norm }) => base.includes(".doctrine.") || base.includes("doctrine") || base.includes("policy")
            ? "doctrine"
            : /\/doctrines?\//.test(norm)
                ? "/doctrines/"
                : null,
    },
    {
        artifactClass: "pipeline",
        confidence: "high",
        test: ({ base, norm }) => base.includes("pipeline") || /\/pipelines?\//.test(norm) ? "pipeline" : null,
    },
    {
        artifactClass: "fixture",
        confidence: "high",
        test: ({ base, norm }) => /\/(fixtures?|examples?|mocks?)\//.test(norm) || base.includes("fixture") || base.includes("mock")
            ? "fixture"
            : null,
    },
    {
        artifactClass: "script",
        confidence: "high",
        test: ({ ext, norm }) => [".sh", ".bash", ".zsh", ".py"].includes(ext)
            ? ext
            : /\/scripts?\//.test(norm)
                ? "/scripts/"
                : null,
    },
    {
        artifactClass: "configuration",
        confidence: "high",
        test: ({ base, ext }) => /\.config\.[cm]?[jt]s$/.test(base) || /^tsconfig.*\.json$/.test(base) || /^\..*rc(\..+)?$/.test(base)
            ? "config"
            : [".json", ".yaml", ".yml", ".toml", ".ini"].includes(ext)
                ? ext
                : null,
    },
    {
        artifactClass: "documentation",
        confidence: "high",
        test: ({ ext, norm }) => [".md", ".mdx", ".rst", ".txt"].includes(ext) ? ext : /\/docs?\//.test(norm) ? "/docs/" : null,
    },
    {
        artifactClass: "source_module",
        confidence: "medium",
        test: ({ ext }) => [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(ext) ? ext : null,
    },
];
/**
 * Classify a file into one of 17 semantic classes. Deterministic: depends only
 * on the path, extension, and filename. The optional `body` argument is
 * currently ignored (reserved for future content-based rules). Never throws.
 */
function classifyArtifact(filePath, body = "") {
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
function isSemanticArtifactClass(value) {
    return exports.SEMANTIC_ARTIFACT_CLASSES.includes(value);
}
/** Directory into which low-confidence / unknown artifacts are quarantined. */
exports.QUARANTINE_DIRECTORY = "99_CONFLICTS_AND_UNKNOWN";
/** Canonical placement hint for every one of the 17 semantic classes. */
exports.CLASS_PLACEMENT_HINTS = {
    source_module: { directory: "src", layer: "implementation" },
    type_definitions: { directory: "src/types", layer: "implementation" },
    test_suite: { directory: "tests", layer: "verification" },
    schema: { directory: "schemas", layer: "contract" },
    configuration: { directory: "config", layer: "operations" },
    documentation: { directory: "docs", layer: "documentation" },
    contract: { directory: "docs/contracts", layer: "contract" },
    build_manifest: { directory: ".", layer: "operations" },
    build_artifact: { directory: "dist", layer: "build" },
    fixture: { directory: "tests/fixtures", layer: "verification" },
    script: { directory: "scripts", layer: "operations" },
    pipeline: { directory: "src/pipeline", layer: "implementation" },
    prompt_template: { directory: "prompts", layer: "content" },
    skill_definition: { directory: "skills", layer: "content" },
    governance_doctrine: { directory: "doctrines", layer: "governance" },
    changelog: { directory: ".", layer: "documentation" },
    unknown: { directory: exports.QUARANTINE_DIRECTORY, layer: "quarantine" },
};
/** Placement hint for a semantic class (falls back to the quarantine hint). */
function placementHintFor(cls) {
    return exports.CLASS_PLACEMENT_HINTS[cls] ?? exports.CLASS_PLACEMENT_HINTS.unknown;
}
//# sourceMappingURL=artifact_class.js.map