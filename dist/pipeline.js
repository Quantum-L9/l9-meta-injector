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
exports.runPipelineAsync = runPipelineAsync;
// pipeline.ts — Full pipeline: scan → extract → assist → inject (async reconcile) → verify → index
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const retrieval_1 = require("./retrieval");
const extract_1 = require("./extract");
const classify_1 = require("./classify");
const normalize_meta_1 = require("./normalize_meta");
const inject_1 = require("./inject");
const verify_1 = require("./verify");
const compiler_1 = require("./compiler");
const placement_policy_1 = require("./placement_policy");
const meta_v3_1 = require("./meta_v3");
const assist_1 = require("./assist");
const normalize_filename_1 = require("./normalize_filename");
const llm_1 = require("./llm");
const comment_1 = require("./comment");
function toCfg(config) {
    return { namespace: config.namespace, authority: config.authority, nearDupThreshold: config.nearDupThreshold, hashPrefixLength: config.hashPrefixLength, outputDir: config.outDir, indexDir: config.indexDir, promptGlob: "Prompt-*.md" };
}
async function runPipelineAsync(config) {
    const now = new Date().toISOString();
    const nsCfg = toCfg(config);
    if (config.llmEnabled && config.llmBaseUrl && config.llmApiKey && config.llmModel) {
        (0, llm_1.setAdapter)((0, llm_1.makeOpenAIAdapter)({ baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel }));
    }
    else {
        (0, llm_1.resetAdapter)();
    }
    const assistCfg = { ...assist_1.DEFAULT_ASSIST_CONFIG, enabled: config.llmEnabled };
    const filePaths = (0, retrieval_1.findFiles)(config.root, config.glob);
    if (config.normalizeFilenames)
        (0, normalize_filename_1.normalizeFilenames)(filePaths, { dryRun: config.dryRun, verbose: config.verbose });
    const scanned = (0, retrieval_1.scanFiles)(filePaths);
    const metas = new Map();
    // Clean body per file (same representation used for hashing/classification),
    // retained so the dedup compiler can compute near-duplicate similarity.
    const bodies = new Map();
    // Coverage accounting: record why files were not injected so a run's coverage
    // is observable instead of silently dropping skipped files (finding OBS-003).
    const skippedBinaryPaths = [];
    const skippedNonInjectablePaths = [];
    for (const e of scanned) {
        const raw = fs.readFileSync(e.sourcePath, "utf8");
        const spec = (0, comment_1.resolveStrategy)(e.sourcePath, raw);
        if (spec.strategy === "skip-binary") {
            skippedBinaryPaths.push(e.sourcePath);
            continue;
        } // never annotate binary/media
        // Strip any previously-injected block so re-runs classify/hash the true body only
        // (keeps content_hash stable and prevents the injected metadata from skewing classification).
        const cleanRaw = spec.strategy === "line-comment" || spec.strategy === "block-comment"
            ? (0, comment_1.stripInjectedBlock)(raw, spec)
            : raw;
        // Only frontmatter files carry a `--- … ---` header; for other strategies the
        // whole cleanRaw is the body. Running splitContent unconditionally would let a
        // leading `---` in non-markdown (e.g. YAML document separators) be mistaken for
        // frontmatter and truncate real content, skewing extraction/classification/hash.
        const body = spec.strategy === "yaml-frontmatter" ? (0, extract_1.splitContent)(cleanRaw).body : cleanRaw;
        bodies.set(e.sourcePath, body);
        const ef = (0, extract_1.extract)(body);
        const cls = (0, classify_1.classify)(e.sourcePath, body, e.headerConvention);
        let meta = (0, normalize_meta_1.buildMeta)(e.sourcePath, body, ef, cls, nsCfg, config.authority, now);
        // assist: LLM fills prose-origin fields only when seed fails "good" predicate
        if (config.llmEnabled) {
            const rec = meta;
            for (const field of assistCfg.proseFields) {
                if (assist_1.PROSE_ORIGIN_FIELDS.has(field)) {
                    const improved = await (0, assist_1.assistField)(field, rec[field], body, assistCfg);
                    if (improved !== rec[field])
                        rec[field] = improved;
                }
            }
            meta = rec;
        }
        metas.set(e.sourcePath, meta);
    }
    const opts = { dryRun: config.dryRun, outDir: config.outDir, verbose: config.verbose, writeInjectLog: true };
    const injected = [];
    for (const e of scanned) {
        const meta = metas.get(e.sourcePath);
        if (!meta)
            continue; // binary — already recorded in skippedBinaryPaths
        if (!meta.injectable) {
            skippedNonInjectablePaths.push(e.sourcePath);
            continue;
        }
        // Use async inject (LLM boolean reconcile on description/intent) when LLM is enabled
        const record = config.llmEnabled
            ? await (0, inject_1.injectFileAsync)(e.sourcePath, meta, opts)
            : (0, inject_1.injectFile)(e.sourcePath, meta, opts);
        injected.push(record);
    }
    const verified = injected.map((r) => (0, verify_1.verify)(r.sourcePath, r.originalBodyHash, r.meta));
    // Consume the verification signal at the decision point — a computed VerifyResult
    // that nothing inspects is indistinguishable from no verification at all. Aggregate
    // failures, surface them (independent of dryRun), and expose a gate flag to callers/CI.
    const failures = verified
        .filter((v) => v.issues.length > 0)
        .map((v) => ({ sourcePath: v.sourcePath, issues: v.issues }));
    const verification = {
        total: verified.length,
        clean: verified.length - failures.length,
        withIssues: failures.length,
        passed: failures.length === 0,
        failures,
    };
    if (!verification.passed) {
        const preview = failures.slice(0, 5).map((f) => `  - ${f.sourcePath}: ${f.issues.join("; ")}`).join("\n");
        const more = failures.length > 5 ? `\n  … and ${failures.length - 5} more` : "";
        process.stderr.write(`[l9-meta-injector] verification FAILED for ${verification.withIssues}/${verification.total} file(s):\n${preview}${more}\n`);
    }
    const coverage = {
        scanned: scanned.length,
        injected: injected.length,
        skippedBinary: skippedBinaryPaths.length,
        skippedNonInjectable: skippedNonInjectablePaths.length,
        verifyFailed: verification.withIssues,
        skipped: { binary: skippedBinaryPaths, nonInjectable: skippedNonInjectablePaths },
    };
    // Surface coverage when anything was skipped or on verbose runs — otherwise the
    // library path emits no signal about what it processed vs. dropped (OBS-003).
    if (config.verbose || coverage.skippedBinary + coverage.skippedNonInjectable > 0) {
        process.stderr.write(`[l9-meta-injector] coverage: scanned=${coverage.scanned} injected=${coverage.injected} ` +
            `skipped-binary=${coverage.skippedBinary} skipped-noninjectable=${coverage.skippedNonInjectable} ` +
            `verify-failed=${coverage.verifyFailed}\n`);
    }
    const dedupEntries = (0, compiler_1.buildDedupEntries)(injected, config.hashPrefixLength, bodies);
    const dedupReport = (0, compiler_1.buildDedupReport)(dedupEntries, config.nearDupThreshold, config.hashPrefixLength);
    // Compile advisory placement plans for the injected artifacts (placement compiler
    // was previously unreachable outside tests — finding DWL-002).
    const placementPlans = (0, placement_policy_1.compilePlacementPlans)(injected.map((r) => ({ sourcePath: r.sourcePath, body: bodies.get(r.sourcePath) ?? "" })), { namespace: config.namespace });
    const planBySource = new Map(placementPlans.map((p) => [p.sourcePath, p]));
    // Build a v3 nine-plane record per artifact, driven by the 17-class semantic
    // classifier (DWL-001) and the placement plan (DWL-002). This is the first live
    // producer + consumer of the MetaV3 model (DWL-003 / RAA-001).
    const hcBySource = new Map(scanned.map((e) => [e.sourcePath, e.headerConvention]));
    const metaV3 = injected.map((r) => {
        const body = bodies.get(r.sourcePath) ?? "";
        const semantic = (0, classify_1.classifyWithSemantics)(r.sourcePath, body, hcBySource.get(r.sourcePath) ?? "none").semantic;
        return {
            sourcePath: r.sourcePath,
            semanticClass: semantic.artifactClass,
            semanticConfidence: semantic.confidence,
            metaV3: (0, meta_v3_1.buildMetaV3)({ meta: r.meta, semantic, placement: planBySource.get(r.sourcePath), sizeBytes: Buffer.byteLength(body, "utf8") }),
        };
    });
    if (!config.dryRun) {
        const d = config.indexDir;
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, "primitive-library-index.json"), JSON.stringify((0, compiler_1.buildPrimitiveLibraryIndex)(injected), null, 2));
        fs.writeFileSync(path.join(d, "prompt-library-index.json"), JSON.stringify((0, compiler_1.buildPromptLibraryIndex)(injected), null, 2));
        fs.writeFileSync(path.join(d, "dedup-report.json"), JSON.stringify(dedupReport, null, 2));
        fs.writeFileSync(path.join(d, "dedup-report.md"), (0, compiler_1.dedupReportToMarkdown)(dedupReport));
        fs.writeFileSync(path.join(d, "verification-report.json"), JSON.stringify(verified, null, 2));
        fs.writeFileSync(path.join(d, "placement-plan.json"), JSON.stringify(placementPlans, null, 2));
        fs.writeFileSync(path.join(d, "meta-v3-index.json"), JSON.stringify(metaV3, null, 2));
    }
    return { scanned, injected, verified, verification, coverage, placementPlans, metaV3 };
}
//# sourceMappingURL=pipeline.js.map