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
    { type: "doctrine", keywords: ["doctrine", "governance", "policy", "principle", "standard"], pathPatterns: ["doctrines", "doctrine"] },
    { type: "test", keywords: ["test", "spec", "fixture", "mock"], pathPatterns: ["tests", "test", "__tests__"] },
    { type: "script", keywords: ["script", "utility", "helper", "tool"], pathPatterns: ["scripts", "script"] },
    { type: "prompt", keywords: [], pathPatterns: ["prompts", "prompt"] },
    { type: "skill", keywords: ["skill", "capability", "function", "action", "operation"], pathPatterns: ["skills", "skill"] },
];
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
    // Keyword scoring (prose taxonomy). Unclassifiable prose stays "unknown" (not injected).
    let best = "unknown";
    let bestScore = 0;
    for (const ts of TYPE_SIGNALS) {
        const score = ts.keywords.filter((k) => text.includes(k)).length;
        if (score > bestScore) {
            best = ts.type;
            bestScore = score;
        }
    }
    const conf = bestScore >= 2 ? "medium" : "low";
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
        if (keywords.some((k) => text.includes(k)))
            return family;
    }
    return "Unknown";
}
function extractSignals(text) {
    const signals = [];
    for (const { keywords } of FAMILY_SIGNALS) {
        for (const k of keywords) {
            if (text.includes(k) && !signals.includes(k))
                signals.push(k);
        }
    }
    return signals.slice(0, 6);
}
//# sourceMappingURL=classify.js.map