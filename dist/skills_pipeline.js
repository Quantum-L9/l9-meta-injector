"use strict";
// skills_pipeline.ts — Cursor-native skills mode (ADR-017).
// Only skill artifacts are considered. Inventory/pipeline never mutate SKILL.md;
// this mode may patch Cursor frontmatter under materiality rules:
//   - Primary: description (what + "Use when …")
//   - Optional: activation_signals as L9 metadata when missing/empty
//   - Never invent a Cursor `triggers:` key or stamp L9 identity headers
// Write only when there is at least one material field diff.
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
exports.runSkillsPipelineAsync = runSkillsPipelineAsync;
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const retrieval_1 = require("./retrieval");
const frontmatter_patch_1 = require("./frontmatter_patch");
const schema_1 = require("./schema");
const assist_1 = require("./assist");
const materiality_1 = require("./materiality");
const llm_1 = require("./llm");
const omit_1 = require("./omit");
const metrics_1 = require("./metrics");
function isMateriallyBetterSync(old, next) {
    if (!(0, assist_1.isGoodValue)(next))
        return false;
    if (!(0, assist_1.isGoodValue)(old))
        return true;
    // Prefer descriptions that gain "Use when" trigger language.
    if (!(0, assist_1.hasUseWhenSignal)(old) && (0, assist_1.hasUseWhenSignal)(next))
        return true;
    return JSON.stringify(next).length > JSON.stringify(old).length * 1.2;
}
async function isMateriallyBetter(field, old, next) {
    if (!(0, assist_1.isGoodValue)(next))
        return false;
    if (!(0, assist_1.isGoodValue)(old) || (field === "description" && !(0, assist_1.hasUseWhenSignal)(old) && (0, assist_1.hasUseWhenSignal)(next))) {
        if (!(0, assist_1.isGoodValue)(old))
            return true;
        if (field === "description" && !(0, assist_1.hasUseWhenSignal)(old) && (0, assist_1.hasUseWhenSignal)(next))
            return true;
    }
    const adapter = (0, llm_1.getAdapter)();
    if (!adapter.classify)
        return isMateriallyBetterSync(old, next);
    const reply = await adapter.classify((0, materiality_1.buildMaterialityPrompt)(field, old, next));
    if (reply === null || reply === undefined)
        return isMateriallyBetterSync(old, next);
    return (0, materiality_1.parseMaterialityReply)(reply);
}
function parseExistingFrontMatter(raw) {
    const inspected = (0, frontmatter_patch_1.inspectFrontMatterDocument)(raw);
    if (!inspected.safe) {
        return {
            meta: {},
            body: raw,
            hadFrontMatter: false,
            issue: `${inspected.issue?.code ?? "FRONTMATTER_UNSAFE"}: ${inspected.issue?.message ?? "unsafe header"}`,
        };
    }
    return { meta: inspected.meta, body: inspected.body, hadFrontMatter: inspected.hadFrontMatter };
}
function parseSignalList(v) {
    if (v === schema_1.UNKNOWN || v === null || v === undefined)
        return [];
    if (Array.isArray(v))
        return v.map(String).map((s) => s.trim()).filter(Boolean);
    if (typeof v === "string") {
        return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
    }
    return [];
}
async function improveDescription(existing, body, assistCfg, metrics) {
    const seedDesc = typeof existing.description === "string" ? existing.description : "";
    const proposedDesc = await (0, assist_1.assistField)("description", seedDesc || schema_1.UNKNOWN, body, assistCfg, metrics);
    const descStr = typeof proposedDesc === "string" ? proposedDesc : "";
    if (!(0, assist_1.isGoodValue)(descStr))
        return null;
    const missingOrWeak = !("description" in existing)
        || !(0, assist_1.isGoodValue)(existing.description)
        || !(0, assist_1.hasUseWhenSignal)(existing.description);
    if (missingOrWeak) {
        const usable = (0, assist_1.hasUseWhenSignal)(descStr) || !(0, assist_1.isGoodValue)(existing.description);
        if (!usable)
            return null;
        const better = !("description" in existing) || !(0, assist_1.isGoodValue)(existing.description)
            || await isMateriallyBetter("description", existing.description, descStr);
        if (!better || descStr === existing.description)
            return null;
        return {
            field: "description",
            action: ("description" in existing) ? "revise" : "add",
            oldValue: existing.description,
            newValue: descStr.slice(0, 1024),
            reason: "Cursor-native description material improvement",
        };
    }
    if (descStr === existing.description)
        return null;
    if (!(await isMateriallyBetter("description", existing.description, descStr)))
        return null;
    return {
        field: "description",
        action: "revise",
        oldValue: existing.description,
        newValue: descStr.slice(0, 1024),
        reason: "Cursor-native description material improvement",
    };
}
async function fillActivationSignals(existing, body, assistCfg, metrics) {
    if (parseSignalList(existing.activation_signals).length > 0)
        return null;
    const proposed = await (0, assist_1.assistField)("activation_signals", schema_1.UNKNOWN, body, assistCfg, metrics);
    const list = parseSignalList(proposed);
    if (list.length === 0)
        return null;
    return {
        field: "activation_signals",
        action: "add",
        oldValue: existing.activation_signals,
        newValue: list,
        reason: "optional L9 activation_signals filled (missing/empty)",
    };
}
async function processSkillFile(abs, root, config, assistCfg, metrics) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const raw = fs.readFileSync(abs, "utf8");
    const parsed = parseExistingFrontMatter(raw);
    if (parsed.issue) {
        if (config.verbose)
            process.stderr.write(`[l9-meta-injector] skills: ${rel} skipped: ${parsed.issue}\n`);
        return { sourcePath: abs, relativePath: rel, changed: false, diffs: [], skippedReason: parsed.issue };
    }
    const { meta: existing, body, hadFrontMatter } = parsed;
    const next = { ...existing };
    const diffs = [];
    const descDiff = await improveDescription(existing, body, assistCfg, metrics);
    if (descDiff) {
        next.description = descDiff.newValue;
        diffs.push(descDiff);
    }
    const signalDiff = await fillActivationSignals(existing, body, assistCfg, metrics);
    if (signalDiff) {
        next.activation_signals = signalDiff.newValue;
        diffs.push(signalDiff);
    }
    if (typeof existing.name === "string" && existing.name.trim()) {
        next.name = existing.name;
    }
    const didChange = diffs.some((d) => d.action === "add" || d.action === "revise");
    if (!didChange)
        return { sourcePath: abs, relativePath: rel, changed: false, diffs };
    if (!config.dryRun) {
        if (!hadFrontMatter && !next.description) {
            return { sourcePath: abs, relativePath: rel, changed: false, diffs: [] };
        }
        const managed = {};
        for (const diff of diffs)
            managed[diff.field] = diff.newValue;
        const patched = (0, frontmatter_patch_1.patchManagedFrontMatter)(raw, managed);
        if (!patched.safe) {
            const skippedReason = `${patched.issue?.code ?? "FRONTMATTER_UNSAFE"}: ${patched.issue?.message ?? "unsafe header"}`;
            if (config.verbose)
                process.stderr.write(`[l9-meta-injector] skills: ${rel} skipped: ${skippedReason}\n`);
            return { sourcePath: abs, relativePath: rel, changed: false, diffs: [], skippedReason };
        }
        fs.writeFileSync(abs, patched.content, "utf8");
    }
    if (config.verbose) {
        process.stderr.write(`[l9-meta-injector] skills: ${rel} → ${diffs.map((d) => d.field).join(",")}\n`);
    }
    return { sourcePath: abs, relativePath: rel, changed: true, diffs };
}
async function runSkillsPipelineAsync(config) {
    const metrics = new metrics_1.MetricsCollector();
    if (config.llmEnabled && config.llmBaseUrl && config.llmApiKey && config.llmModel) {
        (0, llm_1.setAdapter)((0, llm_1.makeOpenAIAdapter)({
            baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel,
            onDiagnostic: metrics.onLlmDiagnostic,
            allowInsecure: config.llmAllowInsecure,
        }));
    }
    else if (!config.llmEnabled) {
        (0, llm_1.resetAdapter)();
    }
    const root = path.resolve(config.root);
    fs.mkdirSync(config.outDir, { recursive: true });
    const omit = (0, omit_1.buildOmitMatcher)({
        root,
        patterns: config.omitPatterns,
        omitFile: config.omitFile,
        protectSkillMd: false,
        ignoreDirNames: ["node_modules"],
    });
    const skillPaths = (0, retrieval_1.findFiles)(root, "**/*", { omit, protectSkillMd: false })
        .filter((p) => (0, omit_1.isSkillArtifactPath)(p));
    const assistCfg = {
        ...assist_1.DEFAULT_ASSIST_CONFIG,
        enabled: config.llmEnabled,
        cursorSkillDescription: true,
        proseFields: ["description", "activation_signals"],
    };
    const files = [];
    for (const abs of skillPaths) {
        files.push(await processSkillFile(abs, root, config, assistCfg, metrics));
    }
    const changed = files.filter((f) => f.changed).length;
    const report = {
        generatedAt: new Date().toISOString(),
        root,
        considered: skillPaths.length,
        changed,
        unchanged: skillPaths.length - changed,
        files: files.map((f) => ({
            relativePath: f.relativePath,
            changed: f.changed,
            diffs: f.diffs,
            skippedReason: f.skippedReason,
        })),
    };
    fs.writeFileSync(path.join(config.outDir, "skills-report.json"), JSON.stringify(report, null, 2), "utf8");
    return {
        considered: skillPaths.length,
        changed,
        unchanged: skillPaths.length - changed,
        files,
        metrics: metrics.snapshot(),
    };
}
//# sourceMappingURL=skills_pipeline.js.map