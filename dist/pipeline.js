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
const schema_1 = require("./schema");
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
const meta_schema_1 = require("./meta_schema");
const metrics_1 = require("./metrics");
const comment_1 = require("./comment");
const archives_1 = require("./archives");
const omit_1 = require("./omit");
// classify()'s coarse "high"/"medium"/"low" confidence, numerically scaled to line up
// with inventoryTree's InventoryRecord.classification_confidence (a 0..1 float), so a
// meta-schema's `source: classification_confidence` resolves consistently in both modes.
const CONFIDENCE_NUMERIC = { high: 0.9, medium: 0.6, low: 0.3 };
const UNKNOWN_EXCERPT = "Unknown";
function relativeSourcePath(root, filePath) {
    const relative = path.relative(root, filePath);
    if (relative === "")
        return ".";
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`persisted path escapes repository root: ${filePath}`);
    }
    return relative.split(path.sep).join("/");
}
function toCfg(config) {
    return { namespace: config.namespace, authority: config.authority, nearDupThreshold: config.nearDupThreshold, hashPrefixLength: config.hashPrefixLength, outputDir: config.outDir, indexDir: config.indexDir, namespaceGlobs: config.namespaceGlobs };
}
async function runPipelineAsync(config) {
    const runStartedAt = new Date().toISOString();
    const root = path.resolve(config.root);
    const metadataTimestamp = config.metadataTimestamp?.trim() || schema_1.UNKNOWN;
    const nsCfg = toCfg(config);
    // One collector per run aggregates the LLM/IO hotpath signal (OBS-009/OBS-010):
    // decision paths, call counts, failure counts, and p50/p95 latency.
    const metrics = new metrics_1.MetricsCollector();
    if (config.llmEnabled && config.llmBaseUrl && config.llmApiKey && config.llmModel) {
        (0, llm_1.setAdapter)((0, llm_1.makeOpenAIAdapter)({
            baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel,
            onDiagnostic: metrics.onLlmDiagnostic,
            allowInsecure: config.llmAllowInsecure,
        }));
    }
    else {
        (0, llm_1.resetAdapter)();
    }
    const assistCfg = { ...assist_1.DEFAULT_ASSIST_CONFIG, enabled: config.llmEnabled };
    // Shared omit matcher for archive expansion + discovery (ADR-017). Pipeline
    // always protects SKILL.md; noise / .l9metaignore / --omit apply everywhere.
    const omit = (0, omit_1.buildOmitMatcher)({
        root,
        patterns: config.omitPatterns,
        omitFile: config.omitFile,
        protectSkillMd: true,
        ignoreDirNames: ["node_modules"],
    });
    // Local-files mode (ADR-016): expand archives before discovery so members are
    // ordinary text inject targets. Default repo mode never extracts. Omit applies
    // to archives and members the same way findFiles does.
    let archives = [];
    if (config.localFiles) {
        const expanded = (0, archives_1.expandArchivesUnderRoot)(root, {
            dryRun: config.dryRun,
            verbose: config.verbose,
            omit,
        });
        archives = expanded.archives;
    }
    const discovery = (0, retrieval_1.discoverFiles)(root, config.glob, { omit, protectSkillMd: true });
    if (!config.dryRun && discovery.summary.blocking > 0) {
        const preview = discovery.summary.entries
            .filter((entry) => entry.disposition === "unreadable" || entry.disposition === "symlink" || entry.disposition === "unsupported_entry")
            .slice(0, 10)
            .map((entry) => `${entry.path}: ${entry.disposition}`)
            .join(", ");
        throw new Error(`DISCOVERY_INCOMPLETE: apply refused because ${discovery.summary.blocking} path(s) could not be safely governed: ${preview}`);
    }
    const filePaths = discovery.files;
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
    const skippedNonInjectableDetails = [];
    // Coarse classify result retained so non-injectable skips can report type/confidence.
    const classifications = new Map();
    const metadataSubjects = [];
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
        classifications.set(e.sourcePath, cls);
        let meta = (0, normalize_meta_1.buildMeta)(e.sourcePath, body, ef, cls, nsCfg, config.authority, metadataTimestamp, root);
        // assist: LLM fills prose-origin fields only when seed fails "good" predicate
        if (config.llmEnabled) {
            const rec = (0, schema_1.asRecord)(meta);
            for (const field of assistCfg.proseFields) {
                if (assist_1.PROSE_ORIGIN_FIELDS.has(field)) {
                    const improved = await (0, assist_1.assistField)(field, rec[field], body, assistCfg, metrics);
                    if (improved !== rec[field])
                        rec[field] = improved;
                }
            }
            // assist only touches prose fields; the identity block is intact — coerce
            // (not blind-cast) so any drift is caught at this boundary (QTE-005).
            meta = (0, schema_1.coerceNormalizedMeta)(rec);
        }
        // Optional custom meta-schema (the same canonical-YAML mechanism inventoryTree's
        // --schema uses): MERGE the schema's resolved fields on top of the canonical
        // NormalizedMeta identity block, so verify/dedup/placement/MetaV3 below (which all
        // read known identity-field names) stay correct while the header additionally
        // carries whatever operator-defined fields the schema declares. Only applies when
        // the schema actually targets "file_header" — a schema scoped to sidecar/manifest
        // only must not affect what gets injected here.
        if (config.metaSchema && (0, meta_schema_1.targetIncludes)(config.metaSchema, "file_header")) {
            const sourceRecord = {
                ...(0, schema_1.asRecord)(meta),
                // Aliases matching the InventoryRecord field names inventory --schema files
                // already use (examples/meta-schema.example.yaml), so the same schema file is
                // reusable across `inventory` and `pipeline` modes without rewriting `source:`.
                artifact_id: meta.id,
                relative_path: relativeSourcePath(root, e.sourcePath),
                evidence_excerpt: cls.signals.join(", ") || UNKNOWN_EXCERPT,
                classification_confidence: CONFIDENCE_NUMERIC[cls.confidence],
                created_at: meta.created_or_detected_at,
            };
            const applied = (0, meta_schema_1.applySchema)(sourceRecord, config.metaSchema);
            if (applied.missingRequired.length) {
                process.stderr.write(`[l9-meta-injector] schema '${config.metaSchema.schema_id}': ${e.sourcePath} missing required field(s): ${applied.missingRequired.join(", ")}\n`);
            }
            // Merge, not replace: schema fields win on name collision, canonical identity
            // fields survive untouched otherwise (coerce re-validates the identity block).
            meta = (0, schema_1.coerceNormalizedMeta)({ ...(0, schema_1.asRecord)(meta), ...applied.fields });
        }
        metas.set(e.sourcePath, meta);
        metadataSubjects.push({
            path: relativeSourcePath(root, e.sourcePath),
            artifactType: meta.artifact_type,
            strategy: spec.strategy,
            contentHash: meta.content_hash,
            metadata: (0, schema_1.asRecord)(meta),
        });
    }
    const opts = {
        dryRun: config.dryRun,
        outDir: config.outDir,
        verbose: config.verbose,
        writeInjectLog: config.writeInjectLog ?? false,
        writeDryRunDiff: config.persistOutputs !== false,
    };
    const injected = [];
    for (const e of scanned) {
        const meta = metas.get(e.sourcePath);
        if (!meta)
            continue; // binary — already recorded in skippedBinaryPaths
        if (!meta.injectable) {
            skippedNonInjectablePaths.push(e.sourcePath);
            const cls = classifications.get(e.sourcePath);
            skippedNonInjectableDetails.push({
                path: e.sourcePath,
                reason: "taxonomy_non_injectable",
                artifactType: cls?.artifactType ?? meta.artifact_type,
                confidence: cls?.confidence ?? "low",
            });
            continue;
        }
        // Use async inject (LLM boolean reconcile on description/intent) when LLM is enabled
        const record = config.llmEnabled
            ? await (0, inject_1.injectFileAsync)(e.sourcePath, meta, opts, metrics)
            : (0, inject_1.injectFile)(e.sourcePath, meta, opts);
        injected.push(record);
        metrics.recordInject();
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
    // Persist coverage even on dry-run so skipped paths are inspectable after the fact (ADR-018).
    const coverageReportDir = config.outDir || config.indexDir;
    const coverageReportPath = config.persistOutputs === false
        ? ""
        : path.join(coverageReportDir, "coverage-report.json");
    if (config.persistOutputs !== false) {
        fs.mkdirSync(coverageReportDir, { recursive: true });
    }
    const coverage = {
        scanned: scanned.length,
        injected: injected.length,
        skippedBinary: skippedBinaryPaths.length,
        skippedNonInjectable: skippedNonInjectablePaths.length,
        verifyFailed: verification.withIssues,
        archivesExpanded: archives.length,
        skipped: {
            binary: skippedBinaryPaths,
            nonInjectable: skippedNonInjectablePaths,
            nonInjectableDetails: skippedNonInjectableDetails,
        },
        reportPath: coverageReportPath,
        discovery: discovery.summary,
    };
    if (config.persistOutputs !== false) {
        const persistedCoverage = { ...coverage, reportPath: path.basename(coverageReportPath) };
        fs.writeFileSync(coverageReportPath, JSON.stringify(persistedCoverage, null, 2));
    }
    // Surface coverage when anything was skipped or on verbose runs — otherwise the
    // library path emits no signal about what it processed vs. dropped (OBS-003).
    if (config.verbose || coverage.skippedBinary + coverage.skippedNonInjectable > 0 || coverage.archivesExpanded > 0) {
        process.stderr.write(`[l9-meta-injector] coverage: scanned=${coverage.scanned} injected=${coverage.injected} ` +
            `skipped-binary=${coverage.skippedBinary} skipped-noninjectable=${coverage.skippedNonInjectable} ` +
            `archives-expanded=${coverage.archivesExpanded} ` +
            `verify-failed=${coverage.verifyFailed} report=${coverageReportPath}\n`);
    }
    // Surface the LLM/IO hotpath metrics whenever the LLM path ran or on verbose runs,
    // so a degraded run (llm_failed_fallback / no_adapter) is visible (OBS-009/OBS-010).
    if (config.llmEnabled || config.verbose) {
        process.stderr.write(`[l9-meta-injector] metrics: ${metrics.formatLine()}\n`);
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
    if (!config.dryRun && config.persistOutputs !== false) {
        const d = config.indexDir;
        fs.mkdirSync(d, { recursive: true });
        fs.writeFileSync(path.join(d, "primitive-library-index.json"), JSON.stringify((0, compiler_1.buildPrimitiveLibraryIndex)(injected), null, 2));
        fs.writeFileSync(path.join(d, "prompt-library-index.json"), JSON.stringify((0, compiler_1.buildPromptLibraryIndex)(injected), null, 2));
        fs.writeFileSync(path.join(d, "dedup-report.json"), JSON.stringify(dedupReport, null, 2));
        fs.writeFileSync(path.join(d, "dedup-report.md"), (0, compiler_1.dedupReportToMarkdown)(dedupReport));
        fs.writeFileSync(path.join(d, "verification-report.json"), JSON.stringify(verified, null, 2));
        fs.writeFileSync(path.join(d, "placement-plan.json"), JSON.stringify(placementPlans, null, 2));
        fs.writeFileSync(path.join(d, "meta-v3-index.json"), JSON.stringify(metaV3, null, 2));
        fs.writeFileSync(path.join(d, "archives-expanded.json"), JSON.stringify(archives, null, 2));
    }
    return { runStartedAt, scanned, metadataSubjects, injected, verified, verification, coverage, placementPlans, metaV3, metrics: metrics.snapshot(), archives };
}
//# sourceMappingURL=pipeline.js.map