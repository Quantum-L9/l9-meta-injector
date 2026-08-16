// pipeline.ts — Full pipeline: scan → extract → assist → inject (async reconcile) → verify → index
import * as fs from "node:fs";
import * as path from "node:path";
import { PipelineConfig, NormalizedMeta, InjectionRecord, VerifyResult, UNKNOWN, asRecord, coerceNormalizedMeta } from "./schema";
import { discoverFiles, scanFiles } from "./retrieval";
import type { CarrierInjectionStrategy } from "./mutation_policy";
import type { DiscoverySummary } from "./discovery_contracts";
import { extract, splitContent } from "./extract";
import { classify, classifyWithSemantics } from "./classify";
import { buildMeta } from "./normalize_meta";
import { injectFileAsync, injectFile } from "./inject";
import { verify } from "./verify";
import { buildDedupEntries, buildDedupReport, buildPromptLibraryIndex, buildPrimitiveLibraryIndex, dedupReportToMarkdown } from "./compiler";
import { compilePlacementPlans, PlacementPlan } from "./placement_policy";
import { buildMetaV3, MetaV3Record } from "./meta_v3";
import { assistField, DEFAULT_ASSIST_CONFIG, PROSE_ORIGIN_FIELDS } from "./assist";
import { normalizeFilenames } from "./normalize_filename";
import { makeOpenAIAdapter, setAdapter, resetAdapter } from "./llm";
import { applySchema, targetIncludes } from "./meta_schema";
import { MetricsCollector, MetricsSnapshot } from "./metrics";
import { NamespaceConfig } from "./namespace";
import { resolveStrategy, stripInjectedBlock } from "./comment";
import { inspectFrontMatterDocument, isPatcherLimitation, type FrontMatterIssueCode } from "./frontmatter_patch";
import { expandArchivesUnderRoot, ArchiveRecord } from "./archives";
import { buildOmitMatcher } from "./omit";

// classify()'s coarse "high"/"medium"/"low" confidence, numerically scaled to line up
// with inventoryTree's InventoryRecord.classification_confidence (a 0..1 float), so a
// meta-schema's `source: classification_confidence` resolves consistently in both modes.
const CONFIDENCE_NUMERIC: Record<"high" | "medium" | "low", number> = { high: 0.9, medium: 0.6, low: 0.3 };
const UNKNOWN_EXCERPT = "Unknown";

function relativeSourcePath(root: string, filePath: string): string {
  const relative = path.relative(root, filePath);
  if (relative === "") return ".";
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`persisted path escapes repository root: ${filePath}`);
  }
  return relative.split(path.sep).join("/");
}

/** Inspect a markdown document once and describe why it cannot be inline-patched, if so. */
function inlineCarrierBlockFor(raw: string): InlineCarrierBlock | undefined {
  const inspected = inspectFrontMatterDocument(raw);
  if (inspected.safe || !inspected.issue) return undefined;
  const { code, message, line } = inspected.issue;
  return { code, message, malformed: !isPatcherLimitation(code), ...(line !== undefined ? { line } : {}) };
}

function toCfg(config: PipelineConfig): NamespaceConfig {
  return { namespace: config.namespace, authority: config.authority, nearDupThreshold: config.nearDupThreshold, hashPrefixLength: config.hashPrefixLength, outputDir: config.outDir, indexDir: config.indexDir, namespaceGlobs: config.namespaceGlobs };
}

export interface VerificationSummary {
  total: number;
  clean: number;
  withIssues: number;
  /** True iff every verified file passed with zero issues. Callers/CI should gate on this. */
  passed: boolean;
  failures: Array<{ sourcePath: string; issues: string[] }>;
}

/**
 * Why a discovered markdown file cannot act as its own inline metadata carrier.
 *
 * Valid-but-unsupported frontmatter (`malformed: false`) is a limitation of the
 * byte-preserving patcher, not a defect in the file. Either way the source bytes are left
 * untouched and the file is carried by the central manifest instead; the run continues.
 */
export interface InlineCarrierBlock {
  code: FrontMatterIssueCode;
  message: string;
  line?: number;
  /** True when the header is structurally broken rather than merely unsupported. */
  malformed: boolean;
}

/** Per-path detail for a non-injectable skip (OBS-003 / ADR-018). */
export interface NonInjectableSkipDetail {
  path: string;
  reason: "taxonomy_non_injectable";
  artifactType: string;
  confidence: "high" | "medium" | "low";
}

export interface PipelineMetadataSubject {
  path: string;
  artifactType: NormalizedMeta["artifact_type"];
  strategy: CarrierInjectionStrategy;
  contentHash: string;
  metadata: Readonly<Record<string, unknown>>;
  /** Present when this file's existing frontmatter cannot be safely inline-patched. */
  inlineCarrierBlock?: InlineCarrierBlock;
}

export interface CoverageSummary {
  scanned: number;
  injected: number;
  skippedBinary: number;
  skippedNonInjectable: number;
  verifyFailed: number;
  /** Archives expanded when `localFiles` is on (0 otherwise). */
  archivesExpanded: number;
  /** Source paths skipped, by reason — so coverage gaps are correlatable to inputs. */
  skipped: {
    binary: string[];
    nonInjectable: string[];
    /** Classification detail for each non-injectable skip (same order as `nonInjectable`). */
    nonInjectableDetails: NonInjectableSkipDetail[];
  };
  /** Runtime path of coverage-report.json, empty when persistence is disabled. */
  reportPath: string;
  /** Complete deterministic terminal disposition ledger for encountered paths. */
  discovery: DiscoverySummary;
}

export interface PipelineResult {
  /** Runtime envelope timestamp. It is not embedded into canonical file metadata. */
  runStartedAt: string;
  scanned: ReturnType<typeof scanFiles>;
  /** Canonical metadata subjects before carrier selection. */
  metadataSubjects: PipelineMetadataSubject[];
  injected: InjectionRecord[];
  verified: VerifyResult[];
  /** Aggregated verification outcome. `passed: false` means at least one file failed verification. */
  verification: VerificationSummary;
  /** What the run did vs. skipped (scanned/injected/skipped/verify-failed). */
  coverage: CoverageSummary;
  /** Advisory placement plans (one per injected artifact) from the placement compiler. */
  placementPlans: PlacementPlan[];
  /** v3 nine-plane records (one per injected artifact), each with its semantic class. */
  metaV3: MetaV3Record[];
  /** LLM/IO hotpath metrics for this run: call counts, failures, p50/p95, decision paths. */
  metrics: MetricsSnapshot;
  /** Archives expanded in local-files mode (empty when `localFiles` is off). */
  archives: ArchiveRecord[];
}

export async function runPipelineAsync(config: PipelineConfig): Promise<PipelineResult> {
  const runStartedAt = new Date().toISOString();
  const root = path.resolve(config.root);
  const metadataTimestamp = config.metadataTimestamp?.trim() || UNKNOWN;
  const nsCfg = toCfg(config);

  // One collector per run aggregates the LLM/IO hotpath signal (OBS-009/OBS-010):
  // decision paths, call counts, failure counts, and p50/p95 latency.
  const metrics = new MetricsCollector();

  if (config.llmEnabled && config.llmBaseUrl && config.llmApiKey && config.llmModel) {
    setAdapter(makeOpenAIAdapter({
      baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel,
      onDiagnostic: metrics.onLlmDiagnostic,
      allowInsecure: config.llmAllowInsecure,
    }));
  } else {
    resetAdapter();
  }

  const assistCfg = { ...DEFAULT_ASSIST_CONFIG, enabled: config.llmEnabled };

  // Shared omit matcher for archive expansion + discovery (ADR-017). Pipeline
  // always protects SKILL.md; noise / .l9metaignore / --omit apply everywhere.
  const omit = buildOmitMatcher({
    root,
    patterns: config.omitPatterns,
    omitFile: config.omitFile,
    protectSkillMd: true,
    ignoreDirNames: ["node_modules"],
  });

  // Local-files mode (ADR-016): expand archives before discovery so members are
  // ordinary text inject targets. Default repo mode never extracts. Omit applies
  // to archives and members the same way findFiles does.
  let archives: ArchiveRecord[] = [];
  if (config.localFiles) {
    const expanded = expandArchivesUnderRoot(root, {
      dryRun: config.dryRun,
      verbose: config.verbose,
      omit,
    });
    archives = expanded.archives;
  }

  const discovery = discoverFiles(root, config.glob, { omit, protectSkillMd: true });
  if (!config.dryRun && discovery.summary.blocking > 0) {
    const preview = discovery.summary.entries
      .filter((entry) => entry.disposition === "unreadable" || entry.disposition === "symlink" || entry.disposition === "unsupported_entry")
      .slice(0, 10)
      .map((entry) => `${entry.path}: ${entry.disposition}`)
      .join(", ");
    throw new Error(`DISCOVERY_INCOMPLETE: apply refused because ${discovery.summary.blocking} path(s) could not be safely governed: ${preview}`);
  }
  const filePaths = discovery.files;

  if (config.normalizeFilenames) normalizeFilenames(filePaths, { dryRun: config.dryRun, verbose: config.verbose });

  const scanned = scanFiles(filePaths);
  const metas = new Map<string, NormalizedMeta>();
  // Clean body per file (same representation used for hashing/classification),
  // retained so the dedup compiler can compute near-duplicate similarity.
  const bodies = new Map<string, string>();
  // Coverage accounting: record why files were not injected so a run's coverage
  // is observable instead of silently dropping skipped files (finding OBS-003).
  const skippedBinaryPaths: string[] = [];
  const skippedNonInjectablePaths: string[] = [];
  const skippedNonInjectableDetails: NonInjectableSkipDetail[] = [];
  // Coarse classify result retained so non-injectable skips can report type/confidence.
  const classifications = new Map<string, ReturnType<typeof classify>>();
  const metadataSubjects: PipelineMetadataSubject[] = [];
  // Files that cannot carry their own inline metadata. They are governed and indexed,
  // but never inline-patched, and their bytes are never touched.
  const inlineCarrierBlocks = new Map<string, InlineCarrierBlock>();

  for (const e of scanned) {
    const raw = fs.readFileSync(e.sourcePath, "utf8");
    const spec = resolveStrategy(e.sourcePath, raw);
    if (spec.strategy === "skip-binary") { skippedBinaryPaths.push(e.sourcePath); continue; } // never annotate binary/media
    // Strip any previously-injected block so re-runs classify/hash the true body only
    // (keeps content_hash stable and prevents the injected metadata from skewing classification).
    const cleanRaw = spec.strategy === "line-comment" || spec.strategy === "block-comment"
      ? stripInjectedBlock(raw, spec)
      : raw;
    // Only frontmatter files carry a `--- … ---` header; for other strategies the
    // whole cleanRaw is the body. Running splitContent unconditionally would let a
    // leading `---` in non-markdown (e.g. YAML document separators) be mistaken for
    // frontmatter and truncate real content, skewing extraction/classification/hash.
    const body = spec.strategy === "yaml-frontmatter" ? splitContent(cleanRaw).body : cleanRaw;
    bodies.set(e.sourcePath, body);
    // Classify inline-carrier eligibility here, before any mutation planning. A file whose
    // existing frontmatter is outside the patchable subset is still a governed subject —
    // it simply cannot carry its own metadata, so the carrier policy routes it to the
    // central manifest. Throwing here instead would abort the whole repository operation
    // over one file the injector was never going to be able to rewrite safely.
    const inlineCarrierBlock = spec.strategy === "yaml-frontmatter"
      ? inlineCarrierBlockFor(raw)
      : undefined;
    if (inlineCarrierBlock) inlineCarrierBlocks.set(e.sourcePath, inlineCarrierBlock);
    const ef = extract(body);
    const cls = classify(e.sourcePath, body, e.headerConvention);
    classifications.set(e.sourcePath, cls);
    let meta = buildMeta(e.sourcePath, body, ef, cls, nsCfg, config.authority, metadataTimestamp, root);

    // assist: LLM fills prose-origin fields only when seed fails "good" predicate
    if (config.llmEnabled) {
      const rec = asRecord(meta);
      for (const field of assistCfg.proseFields) {
        if (PROSE_ORIGIN_FIELDS.has(field)) {
          const improved = await assistField(field, rec[field], body, assistCfg, metrics);
          if (improved !== rec[field]) rec[field] = improved;
        }
      }
      // assist only touches prose fields; the identity block is intact — coerce
      // (not blind-cast) so any drift is caught at this boundary (QTE-005).
      meta = coerceNormalizedMeta(rec);
    }

    // Optional custom meta-schema (the same canonical-YAML mechanism inventoryTree's
    // --schema uses): MERGE the schema's resolved fields on top of the canonical
    // NormalizedMeta identity block, so verify/dedup/placement/MetaV3 below (which all
    // read known identity-field names) stay correct while the header additionally
    // carries whatever operator-defined fields the schema declares. Only applies when
    // the schema actually targets "file_header" — a schema scoped to sidecar/manifest
    // only must not affect what gets injected here.
    if (config.metaSchema && targetIncludes(config.metaSchema, "file_header")) {
      const sourceRecord: Record<string, unknown> = {
        ...asRecord(meta),
        // Aliases matching the InventoryRecord field names inventory --schema files
        // already use (examples/meta-schema.example.yaml), so the same schema file is
        // reusable across `inventory` and `pipeline` modes without rewriting `source:`.
        artifact_id: meta.id,
        relative_path: relativeSourcePath(root, e.sourcePath),
        evidence_excerpt: cls.signals.join(", ") || UNKNOWN_EXCERPT,
        classification_confidence: CONFIDENCE_NUMERIC[cls.confidence],
        created_at: meta.created_or_detected_at,
      };
      const applied = applySchema(sourceRecord, config.metaSchema);
      if (applied.missingRequired.length) {
        process.stderr.write(
          `[l9-meta-injector] schema '${config.metaSchema.schema_id}': ${e.sourcePath} missing required field(s): ${applied.missingRequired.join(", ")}\n`,
        );
      }
      // Merge, not replace: schema fields win on name collision, canonical identity
      // fields survive untouched otherwise (coerce re-validates the identity block).
      meta = coerceNormalizedMeta({ ...asRecord(meta), ...applied.fields });
    }

    metas.set(e.sourcePath, meta);
    metadataSubjects.push({
      path: relativeSourcePath(root, e.sourcePath),
      artifactType: meta.artifact_type,
      strategy: spec.strategy,
      contentHash: meta.content_hash,
      metadata: asRecord(meta),
      ...(inlineCarrierBlock ? { inlineCarrierBlock } : {}),
    });
  }

  const opts = {
    dryRun: config.dryRun,
    outDir: config.outDir,
    verbose: config.verbose,
    writeInjectLog: config.writeInjectLog ?? false,
    writeDryRunDiff: config.persistOutputs !== false,
  };
  const injected: InjectionRecord[] = [];

  for (const e of scanned) {
    const meta = metas.get(e.sourcePath);
    if (!meta) continue; // binary — already recorded in skippedBinaryPaths
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
    // the carrier policy place its metadata in the central manifest.
    if (inlineCarrierBlocks.has(e.sourcePath)) continue;
    // Use async inject (LLM boolean reconcile on description/intent) when LLM is enabled
    const record = config.llmEnabled
      ? await injectFileAsync(e.sourcePath, meta, opts, metrics)
      : injectFile(e.sourcePath, meta, opts);
    injected.push(record);
    metrics.recordInject();
  }

  const verified = injected.map((r) => verify(r.sourcePath, r.originalBodyHash, r.meta));
  // Consume the verification signal at the decision point — a computed VerifyResult
  // that nothing inspects is indistinguishable from no verification at all. Aggregate
  // failures, surface them (independent of dryRun), and expose a gate flag to callers/CI.
  const failures = verified
    .filter((v) => v.issues.length > 0)
    .map((v) => ({ sourcePath: v.sourcePath, issues: v.issues }));
  const verification: VerificationSummary = {
    total: verified.length,
    clean: verified.length - failures.length,
    withIssues: failures.length,
    passed: failures.length === 0,
    failures,
  };
  // Only report verification when there is a written file to verify. In plan mode nothing
  // has been written, so `verify` necessarily reads the pre-injection bytes and reports a
  // missing header for every file that is *about* to receive one. Printing that as
  // "verification FAILED" during a successful governed check or apply is a phantom
  // failure, and phantom failures make the real ones unreadable.
  if (!verification.passed && !config.dryRun) {
    const preview = failures.slice(0, 5).map((f) => `  - ${f.sourcePath}: ${f.issues.join("; ")}`).join("\n");
    const more = failures.length > 5 ? `\n  … and ${failures.length - 5} more` : "";
    process.stderr.write(
      `[l9-meta-injector] verification FAILED for ${verification.withIssues}/${verification.total} file(s):\n${preview}${more}\n`,
    );
  }

  // Persist coverage even on dry-run so skipped paths are inspectable after the fact (ADR-018).
  const coverageReportDir = config.outDir || config.indexDir;
  const coverageReportPath = config.persistOutputs === false
    ? ""
    : path.join(coverageReportDir, "coverage-report.json");
  if (config.persistOutputs !== false) {
    fs.mkdirSync(coverageReportDir, { recursive: true });
  }

  const coverage: CoverageSummary = {
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
    process.stderr.write(
      `[l9-meta-injector] coverage: scanned=${coverage.scanned} injected=${coverage.injected} ` +
      `skipped-binary=${coverage.skippedBinary} skipped-noninjectable=${coverage.skippedNonInjectable} ` +
      `archives-expanded=${coverage.archivesExpanded} ` +
      `verify-failed=${coverage.verifyFailed} report=${coverageReportPath}\n`,
    );
  }
  // Surface the LLM/IO hotpath metrics whenever the LLM path ran or on verbose runs,
  // so a degraded run (llm_failed_fallback / no_adapter) is visible (OBS-009/OBS-010).
  if (config.llmEnabled || config.verbose) {
    process.stderr.write(`[l9-meta-injector] metrics: ${metrics.formatLine()}\n`);
  }

  const dedupEntries = buildDedupEntries(injected, config.hashPrefixLength, bodies);
  const dedupReport = buildDedupReport(dedupEntries, config.nearDupThreshold, config.hashPrefixLength);

  // Compile advisory placement plans for the injected artifacts (placement compiler
  // was previously unreachable outside tests — finding DWL-002).
  const placementPlans = compilePlacementPlans(
    injected.map((r) => ({ sourcePath: r.sourcePath, body: bodies.get(r.sourcePath) ?? "" })),
    { namespace: config.namespace },
  );
  const planBySource = new Map(placementPlans.map((p) => [p.sourcePath, p]));

  // Build a v3 nine-plane record per artifact, driven by the 17-class semantic
  // classifier (DWL-001) and the placement plan (DWL-002). This is the first live
  // producer + consumer of the MetaV3 model (DWL-003 / RAA-001).
  const hcBySource = new Map(scanned.map((e) => [e.sourcePath, e.headerConvention]));
  const metaV3: MetaV3Record[] = injected.map((r) => {
    const body = bodies.get(r.sourcePath) ?? "";
    const semantic = classifyWithSemantics(r.sourcePath, body, hcBySource.get(r.sourcePath) ?? "none").semantic;
    return {
      sourcePath: r.sourcePath,
      semanticClass: semantic.artifactClass,
      semanticConfidence: semantic.confidence,
      metaV3: buildMetaV3({ meta: r.meta, semantic, placement: planBySource.get(r.sourcePath), sizeBytes: Buffer.byteLength(body, "utf8") }),
    };
  });

  if (!config.dryRun && config.persistOutputs !== false) {
    const d = config.indexDir;
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "primitive-library-index.json"), JSON.stringify(buildPrimitiveLibraryIndex(injected), null, 2));
    fs.writeFileSync(path.join(d, "prompt-library-index.json"), JSON.stringify(buildPromptLibraryIndex(injected), null, 2));
    fs.writeFileSync(path.join(d, "dedup-report.json"), JSON.stringify(dedupReport, null, 2));
    fs.writeFileSync(path.join(d, "dedup-report.md"), dedupReportToMarkdown(dedupReport));
    fs.writeFileSync(path.join(d, "verification-report.json"), JSON.stringify(verified, null, 2));
    fs.writeFileSync(path.join(d, "placement-plan.json"), JSON.stringify(placementPlans, null, 2));
    fs.writeFileSync(path.join(d, "meta-v3-index.json"), JSON.stringify(metaV3, null, 2));
    fs.writeFileSync(path.join(d, "archives-expanded.json"), JSON.stringify(archives, null, 2));
  }

  return { runStartedAt, scanned, metadataSubjects, injected, verified, verification, coverage, placementPlans, metaV3, metrics: metrics.snapshot(), archives };
}
