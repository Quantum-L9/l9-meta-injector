// skills_pipeline.ts — Cursor-native skills mode (ADR-017).
// Only skill artifacts are considered. Inventory/pipeline never mutate SKILL.md;
// this mode may patch Cursor frontmatter under materiality rules:
//   - Primary: description (what + "Use when …")
//   - Optional: activation_signals as L9 metadata when missing/empty
//   - Never invent a Cursor `triggers:` key or stamp L9 identity headers
// Write only when there is at least one material field diff.

import * as fs from "node:fs";
import * as path from "node:path";
import { findFiles } from "./retrieval";
import { inspectFrontMatterDocument, patchManagedFrontMatter } from "./frontmatter_patch";
import { MetaRecord, UNKNOWN, FieldDiff } from "./schema";
import { assistField, isGoodValue, hasUseWhenSignal, DEFAULT_ASSIST_CONFIG } from "./assist";
import type { AssistConfig } from "./assist";
import { buildMaterialityPrompt, parseMaterialityReply } from "./materiality";
import { getAdapter, makeOpenAIAdapter, setAdapter, resetAdapter } from "./llm";
import { isSkillArtifactPath, buildOmitMatcher } from "./omit";
import { MetricsCollector, MetricsSnapshot } from "./metrics";

export interface SkillsPipelineConfig {
  root: string;
  dryRun: boolean;
  outDir: string;
  verbose: boolean;
  llmEnabled: boolean;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  llmAllowInsecure?: boolean;
  omitPatterns?: string[];
  omitFile?: string;
}

export interface SkillsFileResult {
  sourcePath: string;
  relativePath: string;
  changed: boolean;
  diffs: FieldDiff[];
  skippedReason?: string;
}

export interface SkillsPipelineResult {
  considered: number;
  changed: number;
  unchanged: number;
  files: SkillsFileResult[];
  metrics: MetricsSnapshot;
}

function isMateriallyBetterSync(old: unknown, next: unknown): boolean {
  if (!isGoodValue(next)) return false;
  if (!isGoodValue(old)) return true;
  // Prefer descriptions that gain "Use when" trigger language.
  if (!hasUseWhenSignal(old) && hasUseWhenSignal(next)) return true;
  return JSON.stringify(next).length > JSON.stringify(old).length * 1.2;
}

async function isMateriallyBetter(field: string, old: unknown, next: unknown): Promise<boolean> {
  if (!isGoodValue(next)) return false;
  if (!isGoodValue(old) || (field === "description" && !hasUseWhenSignal(old) && hasUseWhenSignal(next))) {
    if (!isGoodValue(old)) return true;
    if (field === "description" && !hasUseWhenSignal(old) && hasUseWhenSignal(next)) return true;
  }
  const adapter = getAdapter();
  if (!adapter.classify) return isMateriallyBetterSync(old, next);
  const reply = await adapter.classify(buildMaterialityPrompt(field, old, next));
  if (reply === null || reply === undefined) return isMateriallyBetterSync(old, next);
  return parseMaterialityReply(reply);
}

function parseExistingFrontMatter(raw: string): { meta: MetaRecord; body: string; hadFrontMatter: boolean; issue?: string } {
  const inspected = inspectFrontMatterDocument(raw);
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

function parseSignalList(v: unknown): string[] {
  if (v === UNKNOWN || v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") {
    return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

async function improveDescription(
  existing: MetaRecord,
  body: string,
  assistCfg: AssistConfig,
  metrics: MetricsCollector,
): Promise<FieldDiff | null> {
  const seedDesc = typeof existing.description === "string" ? existing.description : "";
  const proposedDesc = await assistField("description", seedDesc || UNKNOWN, body, assistCfg, metrics);
  const descStr = typeof proposedDesc === "string" ? proposedDesc : "";
  if (!isGoodValue(descStr)) return null;

  const missingOrWeak = !("description" in existing)
    || !isGoodValue(existing.description)
    || !hasUseWhenSignal(existing.description);

  if (missingOrWeak) {
    const usable = hasUseWhenSignal(descStr) || !isGoodValue(existing.description);
    if (!usable) return null;
    const better = !("description" in existing) || !isGoodValue(existing.description)
      || await isMateriallyBetter("description", existing.description, descStr);
    if (!better || descStr === existing.description) return null;
    return {
      field: "description",
      action: ("description" in existing) ? "revise" : "add",
      oldValue: existing.description,
      newValue: descStr.slice(0, 1024),
      reason: "Cursor-native description material improvement",
    };
  }

  if (descStr === existing.description) return null;
  if (!(await isMateriallyBetter("description", existing.description, descStr))) return null;
  return {
    field: "description",
    action: "revise",
    oldValue: existing.description,
    newValue: descStr.slice(0, 1024),
    reason: "Cursor-native description material improvement",
  };
}

async function fillActivationSignals(
  existing: MetaRecord,
  body: string,
  assistCfg: AssistConfig,
  metrics: MetricsCollector,
): Promise<FieldDiff | null> {
  if (parseSignalList(existing.activation_signals).length > 0) return null;
  const proposed = await assistField("activation_signals", UNKNOWN, body, assistCfg, metrics);
  const list = parseSignalList(proposed);
  if (list.length === 0) return null;
  return {
    field: "activation_signals",
    action: "add",
    oldValue: existing.activation_signals,
    newValue: list,
    reason: "optional L9 activation_signals filled (missing/empty)",
  };
}

async function processSkillFile(
  abs: string,
  root: string,
  config: SkillsPipelineConfig,
  assistCfg: AssistConfig,
  metrics: MetricsCollector,
): Promise<SkillsFileResult> {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const raw = fs.readFileSync(abs, "utf8");
  const parsed = parseExistingFrontMatter(raw);
  if (parsed.issue) {
    if (config.verbose) process.stderr.write(`[l9-meta-injector] skills: ${rel} skipped: ${parsed.issue}\n`);
    return { sourcePath: abs, relativePath: rel, changed: false, diffs: [], skippedReason: parsed.issue };
  }
  const { meta: existing, body, hadFrontMatter } = parsed;
  const next: MetaRecord = { ...existing };
  const diffs: FieldDiff[] = [];

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
  if (!didChange) return { sourcePath: abs, relativePath: rel, changed: false, diffs };

  if (!config.dryRun) {
    if (!hadFrontMatter && !next.description) {
      return { sourcePath: abs, relativePath: rel, changed: false, diffs: [] };
    }
    const managed: MetaRecord = {};
    for (const diff of diffs) managed[diff.field] = diff.newValue;
    const patched = patchManagedFrontMatter(raw, managed);
    if (!patched.safe) {
      const skippedReason = `${patched.issue?.code ?? "FRONTMATTER_UNSAFE"}: ${patched.issue?.message ?? "unsafe header"}`;
      if (config.verbose) process.stderr.write(`[l9-meta-injector] skills: ${rel} skipped: ${skippedReason}\n`);
      return { sourcePath: abs, relativePath: rel, changed: false, diffs: [], skippedReason };
    }
    fs.writeFileSync(abs, patched.content, "utf8");
  }
  if (config.verbose) {
    process.stderr.write(`[l9-meta-injector] skills: ${rel} → ${diffs.map((d) => d.field).join(",")}\n`);
  }
  return { sourcePath: abs, relativePath: rel, changed: true, diffs };
}

export async function runSkillsPipelineAsync(config: SkillsPipelineConfig): Promise<SkillsPipelineResult> {
  const metrics = new MetricsCollector();
  if (config.llmEnabled && config.llmBaseUrl && config.llmApiKey && config.llmModel) {
    setAdapter(makeOpenAIAdapter({
      baseUrl: config.llmBaseUrl, apiKey: config.llmApiKey, model: config.llmModel,
      onDiagnostic: metrics.onLlmDiagnostic,
      allowInsecure: config.llmAllowInsecure,
    }));
  } else if (!config.llmEnabled) {
    resetAdapter();
  }

  const root = path.resolve(config.root);
  fs.mkdirSync(config.outDir, { recursive: true });

  const omit = buildOmitMatcher({
    root,
    patterns: config.omitPatterns,
    omitFile: config.omitFile,
    protectSkillMd: false,
    ignoreDirNames: ["node_modules"],
  });
  const skillPaths = findFiles(root, "**/*", { omit, protectSkillMd: false })
    .filter((p) => isSkillArtifactPath(p));

  const assistCfg = {
    ...DEFAULT_ASSIST_CONFIG,
    enabled: config.llmEnabled,
    cursorSkillDescription: true,
    proseFields: ["description", "activation_signals"] as AssistConfig["proseFields"],
  };

  const files: SkillsFileResult[] = [];
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
