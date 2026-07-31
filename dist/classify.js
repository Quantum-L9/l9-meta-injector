"use strict";
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
exports.keywordHit = keywordHit;
exports.classify = classify;
exports.classifyWithSemantics = classifyWithSemantics;
const path = __importStar(require("path"));
const comment_1 = require("./comment");
const artifact_class_1 = require("./artifact_class");
const FAMILY_SIGNALS = [
    { family: "auditor", keywords: ["audit", "review", "check", "validate", "lint", "scan"] },
    { family: "compiler", keywords: ["compile", "build", "generate", "render", "produce"] },
    { family: "meta_kernel_forge", keywords: ["meta", "kernel", "forge", "bootstrap", "scaffold"] },
    { family: "builder", keywords: ["build", "construct", "create", "assemble", "install"] },
    { family: "planner", keywords: ["plan", "schedule", "orchestrate", "coordinate", "roadmap"] },
    { family: "research", keywords: ["research", "search", "find", "retrieve", "explore", "analyze"] },
    { family: "domain_agent", keywords: ["agent", "domain", "dispatch", "route", "delegate"] },
    { family: "legal", keywords: ["legal", "contract", "clause", "law", "compliance"] },
];
const TYPE_SIGNALS = [
    { type: "playbook", keywords: ["playbook", "workflow", "process", "procedure", "protocol"], pathPatterns: ["playbooks", "playbook"] },
    { type: "kernel", keywords: ["kernel", "runtime", "executor", "sandbox", "engine"], pathPatterns: ["kernels", "kernel"] },
    { type: "context", keywords: ["context", "knowledge", "documentation", "reference"], pathPatterns: ["contexts", "context"] },
    // "decisions"/"adr" covers the standard Architecture Decision Record convention
    // (docs/decisions/NNN-title.md) — a governance artifact by structure, independent of
    // prose content. Without the path signal, ADRs fall through to keyword-bag scoring,
    // which is fragile: ADRs share the same template (Status/Date/Context/Decision/
    // Consequences), so a single incidental word (e.g. "test", "engine") can tip an ADR
    // into an unrelated, inconsistent type across a semantically-identical document set.
    { type: "doctrine", keywords: ["doctrine", "governance", "policy", "principle", "standard"], pathPatterns: ["doctrines", "doctrine", "decisions", "decision", "adr"] },
    { type: "test", keywords: ["test", "spec", "fixture", "mock"], pathPatterns: ["tests", "test", "__tests__"] },
    { type: "script", keywords: ["script", "utility", "helper", "tool"], pathPatterns: ["scripts", "script"] },
    { type: "prompt", keywords: [], pathPatterns: ["prompts", "prompt"] },
    { type: "skill", keywords: ["skill", "capability", "function", "action", "operation"], pathPatterns: ["skills", "skill"] },
];
/** Types that block pipeline injection — keyword-only assignment needs a high bar (ADR-018). */
const NON_INJECTABLE_TYPES = new Set(["test", "script"]);
/**
 * Strong companions for keyword-only `test`/`script`. Ambiguous tokens alone
 * (`test`/`spec`/`tool`/`script` in ordinary prose or filenames like "Tool Search")
 * are not enough at score 2 — need a strong hit or score ≥ 3 (ADR-018).
 */
const STRONG_NON_INJECTABLE_KEYWORDS = {
    test: new Set(["fixture", "mock"]),
    script: new Set(["utility", "helper"]),
};
/** Word-boundary match for ASCII taxonomy tokens on already-lowercased text. */
function keywordHit(text, keyword) {
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(?:^|[^a-z0-9_])${escaped}(?:[^a-z0-9_]|$)`).test(text);
}
function scoreType(text, keywords) {
    const hits = keywords.filter((k) => keywordHit(text, k));
    return { score: hits.length, hits };
}
/**
 * Keyword-only test/script is accepted only when score ≥ 2 and either a strong
 * companion keyword hit or score ≥ 3 (avoids medium false positives like
 * filename "tool" + incidental "script").
 */
function acceptKeywordNonInjectable(type, score, hits) {
    if (score < 2)
        return false;
    if (score >= 3)
        return true;
    const strong = STRONG_NON_INJECTABLE_KEYWORDS[type];
    return hits.some((h) => strong.has(h));
}
function scoreBest(text, types) {
    let best = "context";
    let bestScore = 0;
    let hits = [];
    for (const ts of types) {
        const scored = scoreType(text, ts.keywords);
        if (scored.score > bestScore) {
            best = ts.type;
            bestScore = scored.score;
            hits = scored.hits;
        }
    }
    return { best, bestScore, hits };
}
function classify(filePath, body, _hc) {
    const fn = path.basename(filePath).toLowerCase();
    const norm = filePath.replace(/\\/g, "/").toLowerCase();
    const text = (fn + " " + body.slice(0, 800)).toLowerCase();
    // Dot-convention: l9.skill.foo.md → skill
    const dotMatch = fn.match(/\.(skill|playbook|kernel|context|prompt|doctrine|test|script)\./);
    if (dotMatch) {
        const t = dotMatch[1];
        return { artifactType: t, family: detectFamily(text), signals: extractSignals(text), confidence: "high" };
    }
    // Prompt-*.md
    if (/^prompt-/.test(fn))
        return { artifactType: "prompt", family: detectFamily(text), signals: extractSignals(text), confidence: "high" };
    // Non-prose files (code, config, markup, data) are "source" — injectable, but the
    // prose taxonomy (skill/kernel/test/script/…) and its keyword/path heuristics only
    // make sense for markdown/txt artifacts and must not be applied to code. (An explicit
    // dot-convention name like `foo.skill.ts` still wins above.)
    const ext = path.extname(filePath).toLowerCase();
    if (!comment_1.FRONTMATTER_EXTS.has(ext)) {
        return { artifactType: "source", family: detectFamily(text), signals: extractSignals(text), confidence: "low" };
    }
    // --- markdown/txt only, below ---
    // Path segment
    for (const ts of TYPE_SIGNALS) {
        if (ts.pathPatterns.some((p) => norm.includes(`/${p}/`))) {
            return { artifactType: ts.type, family: detectFamily(text), signals: extractSignals(text), confidence: "high" };
        }
    }
    // Keyword scoring (prose taxonomy). Scanned markdown with no strong type signal
    // defaults to injectable "context" (ADR-018) — not "unknown".
    const { best: rawBest, bestScore, hits } = scoreBest(text, TYPE_SIGNALS);
    let best = rawBest;
    let score = bestScore;
    if (NON_INJECTABLE_TYPES.has(best) && (best === "test" || best === "script")) {
        if (!acceptKeywordNonInjectable(best, score, hits)) {
            // Demote weak/ambiguous non-injectable wins to the best injectable type, or context.
            const injectableTypes = TYPE_SIGNALS.filter((ts) => !NON_INJECTABLE_TYPES.has(ts.type));
            const next = scoreBest(text, injectableTypes);
            best = next.bestScore > 0 ? next.best : "context";
            score = next.bestScore > 0 ? next.bestScore : 0;
        }
    }
    if (score === 0) {
        best = "context";
    }
    const conf = score >= 2 ? "medium" : "low";
    return { artifactType: best, family: detectFamily(text), signals: extractSignals(text), confidence: conf };
}
/**
 * Additive companion to {@link classify}: returns the exact same coarse
 * classification plus the fine-grained 17-class semantic classification.
 * `classify()` itself is left unchanged.
 */
function classifyWithSemantics(filePath, body, hc) {
    return { ...classify(filePath, body, hc), semantic: (0, artifact_class_1.classifyArtifact)(filePath, body) };
}
function detectFamily(text) {
    for (const { family, keywords } of FAMILY_SIGNALS) {
        if (keywords.some((k) => keywordHit(text, k)))
            return family;
    }
    return "Unknown";
}
function extractSignals(text) {
    const signals = [];
    for (const { keywords } of FAMILY_SIGNALS) {
        for (const k of keywords) {
            if (keywordHit(text, k) && !signals.includes(k))
                signals.push(k);
        }
    }
    return signals.slice(0, 6);
}
//# sourceMappingURL=classify.js.map