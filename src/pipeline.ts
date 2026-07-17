// pipeline.ts — Full pipeline: scan → extract → assist → inject (async reconcile) → verify → index
import * as fs from "fs";
import * as path from "path";
import { PipelineConfig, NormalizedMeta, InjectionRecord, VerifyResult } from "./schema";
import { findFiles, scanFiles } from "./retrieval";
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
import { NamespaceConfig } from "./namespace";
import { resolveStrategy, stripInjectedBlock } from "./comment";

function toCfg(config: PipelineConfig): NamespaceConfig {
  return { namespace: config.namespace, authority: config.authority, nearDupThreshold: config.nearDupThreshold, hashPrefixLength: config.hashPrefixLength, outputDir: config.outDir, indexDir: config.indexDir, promptGlob: "Prompt-*.md" };
}

export interface VerificationSummary {
  total: number;
  clean: number;
  withIssues: number;
  /** True iff every verified file passed with zero issues. Callers/CI should gate on this. */
  passed: boolean;
  failures: Array<{ sourcePath: string; issues: string[] }>;
}

export interface PipelineResult {
  scanned: ReturnType<typeof scanFiles>;
  injected: InjectionRecord[];
  verified: VerifyResult[];
  /** Aggregated verification outcome. `passed: false` means at least one file failed verification. */
  verification: VerificationSummary;
  /** Advisory placement plans (one per injected artifact) from the placement compiler. */
  placementPlans: PlacementPlan[];
  /** v3 nine-plane records (one per injected artifact), each with its semantic class. */
  metaV3: MetaV3Record[];
}

export async function runPipelineAsync(config: PipelineConfig): Promise<PipelineResult> {
  const now = new Date().toISOString();
  const nsCfg = toCfg(config);

  if (config.llmEnabled && config.llmBaseUrl && config.llmApiKey && config.llmModel) {
    setAdapter(makeOpenAIAdapter({ baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel }));
  } else {
    resetAdapter();
  }

  const assistCfg = { ...DEFAULT_ASSIST_CONFIG, enabled: config.llmEnabled };
  const filePaths = findFiles(config.root, config.glob);

  if (config.normalizeFilenames) normalizeFilenames(filePaths, { dryRun: config.dryRun, verbose: config.verbose });

  const scanned = scanFiles(filePaths);
  const metas = new Map<string, NormalizedMeta>();
  // Clean body per file (same representation used for hashing/classification),
  // retained so the dedup compiler can compute near-duplicate similarity.
  const bodies = new Map<string, string>();

  for (const e of scanned) {
    const raw = fs.readFileSync(e.sourcePath, "utf8");
    const spec = resolveStrategy(e.sourcePath, raw);
    if (spec.strategy === "skip-binary") continue; // never annotate binary/media
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
    const ef = extract(body);
    const cls = classify(e.sourcePath, body, e.headerConvention);
    let meta = buildMeta(e.sourcePath, body, ef, cls, nsCfg, config.authority, now);

    // assist: LLM fills prose-origin fields only when seed fails "good" predicate
    if (config.llmEnabled) {
      const rec = meta as unknown as Record<string, unknown>;
      for (const field of assistCfg.proseFields) {
        if (PROSE_ORIGIN_FIELDS.has(field)) {
          const improved = await assistField(field, rec[field], body, assistCfg);
          if (improved !== rec[field]) rec[field] = improved;
        }
      }
      meta = rec as unknown as NormalizedMeta;
    }
    metas.set(e.sourcePath, meta);
  }

  const opts = { dryRun: config.dryRun, outDir: config.outDir, verbose: config.verbose, writeInjectLog: true };
  const injected: InjectionRecord[] = [];

  for (const e of scanned) {
    const meta = metas.get(e.sourcePath);
    if (!meta || !meta.injectable) continue;
    // Use async inject (LLM boolean reconcile on description/intent) when LLM is enabled
    const record = config.llmEnabled
      ? await injectFileAsync(e.sourcePath, meta, opts)
      : injectFile(e.sourcePath, meta, opts);
    injected.push(record);
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
  if (!verification.passed) {
    const preview = failures.slice(0, 5).map((f) => `  - ${f.sourcePath}: ${f.issues.join("; ")}`).join("\n");
    const more = failures.length > 5 ? `\n  … and ${failures.length - 5} more` : "";
    process.stderr.write(
      `[l9-meta-injector] verification FAILED for ${verification.withIssues}/${verification.total} file(s):\n${preview}${more}\n`,
    );
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

  if (!config.dryRun) {
    const d = config.indexDir;
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "primitive-library-index.json"), JSON.stringify(buildPrimitiveLibraryIndex(injected), null, 2));
    fs.writeFileSync(path.join(d, "prompt-library-index.json"), JSON.stringify(buildPromptLibraryIndex(injected), null, 2));
    fs.writeFileSync(path.join(d, "dedup-report.json"), JSON.stringify(dedupReport, null, 2));
    fs.writeFileSync(path.join(d, "dedup-report.md"), dedupReportToMarkdown(dedupReport));
    fs.writeFileSync(path.join(d, "verification-report.json"), JSON.stringify(verified, null, 2));
    fs.writeFileSync(path.join(d, "placement-plan.json"), JSON.stringify(placementPlans, null, 2));
    fs.writeFileSync(path.join(d, "meta-v3-index.json"), JSON.stringify(metaV3, null, 2));
  }

  return { scanned, injected, verified, verification, placementPlans, metaV3 };
}
