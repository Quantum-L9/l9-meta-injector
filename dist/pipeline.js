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
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const schema_1 = require("./schema");
const retrieval_1 = require("./retrieval");
const mutation_policy_1 = require("./mutation_policy");
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
const frontmatter_patch_1 = require("./frontmatter_patch");
const archives_1 = require("./archives");
const omit_1 = require("./omit");
const authority_1 = require("./authority");
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
/** Inspect a markdown document once and describe why it cannot be inline-patched, if so. */
function inlineCarrierBlockFor(raw) {
    const inspected = (0, frontmatter_patch_1.inspectFrontMatterDocument)(raw);
    if (inspected.safe || !inspected.issue)
        return undefined;
    const { code, message, line } = inspected.issue;
    return { code, message, malformed: !(0, frontmatter_patch_1.isPatcherLimitation)(code), ...(line !== undefined ? { line } : {}) };
}
function toCfg(config) {
    return { namespace: config.namespace ?? "l9", authority: config.authority ?? "", nearDupThreshold: config.nearDupThreshold, hashPrefixLength: config.hashPrefixLength, outputDir: config.outDir, indexDir: config.indexDir, namespaceGlobs: config.namespaceGlobs };
}
/** Refuse a run in which two paths normalize to one metadata id, naming every colliding path. */
function assertUniqueMetadataIds(subjects) {
    const byId = new Map();
    for (const subject of subjects) {
        const id = String(subject.metadata["id"] ?? "");
        const paths = byId.get(id) ?? [];
        paths.push(subject.path);
        byId.set(id, paths);
    }
    const duplicates = [...byId.entries()].filter(([, paths]) => paths.length > 1);
    if (duplicates.length === 0)
        return;
    const detail = duplicates.map(([id, paths]) => `${id}: ${paths.join(", ")}`).join("; ");
    throw new Error(`DUPLICATE_METADATA_ID: ${duplicates.length} id(s) map to more than one path: ${detail}`);
}
/** Refuse a real run over a tree with a blocking discovery disposition, naming the paths. */
function assertTreeGovernable(discovery) {
    if (discovery.summary.blocking === 0)
        return;
    const preview = discovery.summary.entries
        .filter((entry) => entry.disposition === "unreadable" || entry.disposition === "symlink" || entry.disposition === "unsupported_entry")
        .slice(0, 10)
        .map((entry) => `${entry.path}: ${entry.disposition}`)
        .join(", ");
    throw new Error(`DISCOVERY_INCOMPLETE: apply refused because ${discovery.summary.blocking} path(s) could not be safely governed: ${preview}`);
}
/**
 * Anchored, directory-only omit patterns for every output directory that sits
 * inside the scanned root, after refusing one that *is* the root.
 */
function omitPatternsForOutputs(root, outputs) {
    const patterns = [];
    for (const output of outputs) {
        if (!output)
            continue;
        const absolute = path.resolve(output);
        if (absolute === root) {
            throw new Error("pipeline: outDir/indexDir must not equal the root directory (generated reports would be re-scanned and injected); "
                + "use a sibling such as <root>.l9out");
        }
        const relative = path.relative(root, absolute);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
            continue;
        patterns.push(`/${relative.split(path.sep).join("/")}/`);
    }
    return patterns;
}
async function runPipelineAsync(config) {
    const runStartedAt = new Date().toISOString();
    const root = path.resolve(config.root);
    const metadataTimestamp = config.metadataTimestamp?.trim() || schema_1.UNKNOWN;
    const identity = (0, authority_1.assertHeaderIdentity)((0, authority_1.resolveHeaderIdentity)(root, {
        authority: config.authority,
        namespace: config.namespace,
        unboundNamespaceDefault: path.basename(root),
        namespaceGlobs: config.namespaceGlobs,
    }));
    const nsCfg = toCfg({
        ...config,
        authority: identity.authority,
        namespace: identity.namespace,
    });
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
    // The run's own output must never be its next input. An output directory equal
    // to the root would scatter reports among the sources; one nested inside the
    // root was rediscovered on the next run, which then annotated the previous run's
    // reports and wrote sidecars beside them (MUT-005). inventoryTree already refused
    // both; the pipeline now applies the same rule.
    const generatedOutputPatterns = omitPatternsForOutputs(root, [config.outDir, config.indexDir]);
    // Shared omit matcher for archive expansion + discovery (ADR-017). Pipeline
    // always protects SKILL.md; noise / .l9metaignore / --omit apply everywhere.
    const omit = (0, omit_1.buildOmitMatcher)({
        root,
        patterns: [...(config.omitPatterns ?? []), ...generatedOutputPatterns],
        omitFile: config.omitFile,
        protectSkillMd: true,
        ignoreDirNames: ["node_modules"],
    });
    // Local-files mode (ADR-016): expand archives before discovery so members are
    // ordinary text inject targets. Default repo mode never extracts. Omit applies
    // to archives and members the same way findFiles does.
    //
    // A real run refuses a tree it cannot fully govern (a symlink, an unreadable or
    // unsupported entry) — and it must refuse *before* it materializes anything.
    // Materializing first and refusing afterwards left sibling extractions and
    // archive sidecars behind a run that reported it had done nothing. Extracted
    // members can never add a blocking entry (preflight refuses links and special
    // entries), so judging the tree before expansion judges the same question.
    let archives = [];
    if (config.localFiles) {
        if (!config.dryRun) {
            assertTreeGovernable((0, retrieval_1.discoverFiles)(root, config.glob, { omit, protectSkillMd: true }));
        }
        const expanded = (0, archives_1.expandArchivesUnderRoot)(root, {
            dryRun: config.dryRun,
            verbose: config.verbose,
            omit,
        });
        archives = expanded.archives;
    }
    const discovery = (0, retrieval_1.discoverFiles)(root, config.glob, { omit, protectSkillMd: true });
    if (!config.dryRun)
        assertTreeGovernable(discovery);
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
    // Files that cannot carry their own inline metadata. They are governed and indexed,
    // but never inline-patched, and their bytes are never touched.
    const inlineCarrierBlocks = new Map();
    const carrierTiers = new Map();
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
        //
        // For frontmatter the hashed/classified body is exactly what the patcher preserves —
        // the same definition the injector and inventory hash (managedCarrierFreeBody): the
        // body after a safe header, or the whole document when the leading `---` block is not
        // patchable frontmatter. The looser splitContent fence would drop that block, so edits
        // inside it would never change content_hash (RC-022).
        const body = spec.strategy === "yaml-frontmatter" ? (0, inject_1.managedCarrierFreeBody)(e.sourcePath, raw) : cleanRaw;
        const relativePath = relativeSourcePath(root, e.sourcePath);
        const cls = (0, classify_1.classify)(relativePath, body, e.headerConvention);
        classifications.set(e.sourcePath, cls);
        const tier = (0, mutation_policy_1.authorityFreeCarrierTier)({ path: relativePath, strategy: spec.strategy });
        if (tier?.carrier === "hard_skip") {
            skippedNonInjectablePaths.push(e.sourcePath);
            skippedNonInjectableDetails.push({
                path: e.sourcePath,
                reason: "carrier_hard_skip",
                artifactType: cls.artifactType,
                confidence: cls.confidence,
            });
            continue;
        }
        carrierTiers.set(e.sourcePath, tier);
        bodies.set(e.sourcePath, body);
        // Classify inline-carrier eligibility here, before any mutation planning. A file whose
        // existing frontmatter is outside the patchable subset is still a governed subject —
        // it simply cannot carry its own metadata, so the carrier policy routes it to the
        // central manifest. Throwing here instead would abort the whole repository operation
        // over one file the injector was never going to be able to rewrite safely.
        const inlineCarrierBlock = spec.strategy === "yaml-frontmatter"
            ? inlineCarrierBlockFor(raw)
            : undefined;
        if (inlineCarrierBlock)
            inlineCarrierBlocks.set(e.sourcePath, inlineCarrierBlock);
        const ef = (0, extract_1.extract)(body);
        let meta = (0, normalize_meta_1.buildMeta)(e.sourcePath, body, ef, cls, nsCfg, identity.authority, metadataTimestamp, root, identity);
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
                relative_path: relativePath,
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
            const merged = { ...(0, schema_1.asRecord)(meta), ...applied.fields };
            // A bound run's identity comes from the binding, never from the schema: a
            // schema field named owner, authority or namespace would otherwise make
            // injected headers, the metadata index and MetaV3 governance claim an
            // arbitrary identity in place of product.owner / product.id. The owner is
            // reasserted only where the canonical meta carried one (source, test,
            // script), so a schema cannot invent the field for other types either.
            if (identity.source === "semantic_binding") {
                merged.authority = identity.authority;
                merged.namespace = identity.namespace;
                if ("owner" in (0, schema_1.asRecord)(meta))
                    merged.owner = identity.product?.owner ?? schema_1.UNKNOWN;
            }
            meta = (0, schema_1.coerceNormalizedMeta)(merged);
        }
        metas.set(e.sourcePath, meta);
        metadataSubjects.push({
            path: relativePath,
            artifactType: meta.artifact_type,
            strategy: spec.strategy,
            contentHash: meta.content_hash,
            metadata: (0, schema_1.asRecord)(meta),
            ...(inlineCarrierBlock ? { inlineCarrierBlock } : {}),
        });
    }
    assertUniqueMetadataIds(metadataSubjects);
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
            continue; // binary or hard_skip — already recorded
        if (carrierTiers.get(e.sourcePath)?.carrier === "inventory_only") {
            skippedNonInjectablePaths.push(e.sourcePath);
            const cls = classifications.get(e.sourcePath);
            skippedNonInjectableDetails.push({
                path: e.sourcePath,
                reason: "carrier_inventory_only",
                artifactType: cls?.artifactType ?? meta.artifact_type,
                confidence: cls?.confidence ?? "low",
            });
            continue;
        }
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
        // The file is governed, but it cannot rewrite itself: leave its bytes alone and let
        // the carrier policy place its metadata in the central manifest. The standalone
        // pipeline writes no central manifest, so coverage names the file and the exact
        // block instead of dropping it from every bucket (RC-021).
        const inlineCarrierBlock = inlineCarrierBlocks.get(e.sourcePath);
        if (inlineCarrierBlock) {
            skippedNonInjectablePaths.push(e.sourcePath);
            const cls = classifications.get(e.sourcePath);
            skippedNonInjectableDetails.push({
                path: e.sourcePath,
                reason: "carrier_inline_blocked",
                artifactType: cls?.artifactType ?? meta.artifact_type,
                confidence: cls?.confidence ?? "low",
                inlineCarrierBlock,
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
    // In dry-run nothing was written. A record whose planned bytes differ from the current
    // target (or whose plan cannot prove otherwise) is verified only by the checks that do
    // not read written bytes; reading the pre-injection file would report the header it is
    // about to receive as missing (RC-015). A record already holding its planned bytes is
    // verified in full from disk, exactly as a real run would.
    const verified = injected.map((r) => (0, verify_1.verify)(r.sourcePath, r.originalBodyHash, r.meta, {
        semanticallyBound: identity.source === "semantic_binding",
        skipWrittenBytesChecks: config.dryRun && r.wouldChange !== false,
    }));
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
    // Only print verification for a real run. Dry-run no longer reports the phantom
    // header/body failures above, but governed check/apply plan in dry-run and must stay
    // quiet; their verdict comes from the carrier operation, not from this print.
    if (!verification.passed && !config.dryRun) {
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
    const semanticBinding = identity.source === "semantic_binding" && identity.semanticFoundation && identity.product
        ? { semantic_foundation: identity.semanticFoundation, product: identity.product }
        : undefined;
    if (config.persistOutputs !== false) {
        const persistedCoverage = {
            ...coverage,
            reportPath: path.basename(coverageReportPath),
            ...(semanticBinding ? { semantic_binding: semanticBinding } : {}),
        };
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
    // was previously unreachable outside tests — finding DWL-002). Segment rules see the
    // repository-relative path, never directories above the root (ADR-054 item 5,
    // RC-017), so plan.sourcePath is repo-relative like metadataSubjects.path. Each plan
    // carries its record's resolved header namespace, so identity defaults, bound
    // product ids and namespace globs agree with the header (RC-026).
    const relativeBySource = new Map(injected.map((r) => [r.sourcePath, relativeSourcePath(root, r.sourcePath)]));
    const placementPlans = injected.map((r) => (0, placement_policy_1.compilePlacementPlan)(relativeBySource.get(r.sourcePath) ?? relativeSourcePath(root, r.sourcePath), bodies.get(r.sourcePath) ?? "", { namespace: r.meta.namespace }));
    const planBySource = new Map(placementPlans.map((p) => [p.sourcePath, p]));
    // Build a v3 nine-plane record per artifact, driven by the 17-class semantic
    // classifier (DWL-001) and the placement plan (DWL-002). This is the first live
    // producer + consumer of the MetaV3 model (DWL-003 / RAA-001).
    const hcBySource = new Map(scanned.map((e) => [e.sourcePath, e.headerConvention]));
    const metaV3 = injected.map((r) => {
        const body = bodies.get(r.sourcePath) ?? "";
        const relativePath = relativeBySource.get(r.sourcePath) ?? relativeSourcePath(root, r.sourcePath);
        const semantic = (0, classify_1.classifyWithSemantics)(relativePath, body, hcBySource.get(r.sourcePath) ?? "none").semantic;
        return {
            sourcePath: r.sourcePath,
            semanticClass: semantic.artifactClass,
            semanticConfidence: semantic.confidence,
            metaV3: (0, meta_v3_1.buildMetaV3)({ meta: r.meta, semantic, placement: planBySource.get(relativePath), sizeBytes: Buffer.byteLength(body, "utf8") }),
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
    return {
        runStartedAt, scanned, metadataSubjects, injected, verified, verification, coverage,
        placementPlans, metaV3, metrics: metrics.snapshot(), archives,
        ...(semanticBinding ? { semanticBinding } : {}),
    };
}
//# sourceMappingURL=pipeline.js.map