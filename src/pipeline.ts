// pipeline.ts — Full pipeline: scan → extract → assist → inject (async reconcile) → verify → index
import * as fs from "fs";
import * as path from "path";
import { PipelineConfig, NormalizedMeta, InjectionRecord, VerifyResult } from "./schema";
import { findFiles, scanFiles } from "./retrieval";
import { extract, splitContent } from "./extract";
import { classify } from "./classify";
import { buildMeta } from "./normalize_meta";
import { injectFileAsync, injectFile } from "./inject";
import { verify } from "./verify";
import { buildDedupEntries, buildDedupReport, buildPromptLibraryIndex, buildPrimitiveLibraryIndex, dedupReportToMarkdown } from "./compiler";
import { assistField, DEFAULT_ASSIST_CONFIG, PROSE_ORIGIN_FIELDS } from "./assist";
import { normalizeFilenames } from "./normalize_filename";
import { makeOpenAIAdapter, setAdapter, resetAdapter } from "./llm";
import { NamespaceConfig } from "./namespace";

function toCfg(config: PipelineConfig): NamespaceConfig {
  return { namespace: config.namespace, authority: config.authority, nearDupThreshold: config.nearDupThreshold, hashPrefixLength: config.hashPrefixLength, outputDir: config.outDir, indexDir: config.indexDir, promptGlob: "Prompt-*.md" };
}

export interface PipelineResult {
  scanned: ReturnType<typeof scanFiles>;
  injected: InjectionRecord[];
  verified: VerifyResult[];
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

  for (const e of scanned) {
    const raw = fs.readFileSync(e.sourcePath, "utf8");
    const { body } = splitContent(raw);
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
    const meta = metas.get(e.sourcePath)!;
    if (!meta.injectable) continue;
    // Use async inject (LLM boolean reconcile on description/intent) when LLM is enabled
    const record = config.llmEnabled
      ? await injectFileAsync(e.sourcePath, meta, opts)
      : injectFile(e.sourcePath, meta, opts);
    injected.push(record);
  }

  const verified = injected.map((r) => verify(r.sourcePath, r.originalBodyHash, r.meta));
  const dedupEntries = buildDedupEntries(injected, config.hashPrefixLength);
  const dedupReport = buildDedupReport(dedupEntries, config.nearDupThreshold, config.hashPrefixLength);

  if (!config.dryRun) {
    const d = config.indexDir;
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "primitive-library-index.json"), JSON.stringify(buildPrimitiveLibraryIndex(injected), null, 2));
    fs.writeFileSync(path.join(d, "prompt-library-index.json"), JSON.stringify(buildPromptLibraryIndex(injected), null, 2));
    fs.writeFileSync(path.join(d, "dedup-report.json"), JSON.stringify(dedupReport, null, 2));
    fs.writeFileSync(path.join(d, "dedup-report.md"), dedupReportToMarkdown(dedupReport));
    fs.writeFileSync(path.join(d, "verification-report.json"), JSON.stringify(verified, null, 2));
  }

  return { scanned, injected, verified };
}
