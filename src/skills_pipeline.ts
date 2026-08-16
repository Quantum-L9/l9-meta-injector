// skills_pipeline.ts — Cursor-native skills mode (ADR-017).
// Only skill artifacts are considered. Inventory/pipeline never mutate SKILL.md;
// this mode may patch Cursor frontmatter under materiality rules:
//   - Primary: description (what + "Use when …")
//   - Optional: activation_signals as L9 metadata when missing/empty
//   - Never invent a Cursor `triggers:` key or stamp L9 identity headers
// Write only when there is at least one material field diff.

import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { findFiles } from "./retrieval";
import { inspectFrontMatterDocument, patchManagedFrontMatter } from "./frontmatter_patch";
import { MetaRecord, UNKNOWN, FieldDiff } from "./schema";
import { assistField, isGoodValue, hasUseWhenSignal, DEFAULT_ASSIST_CONFIG } from "./assist";
import type { AssistConfig } from "./assist";
import { buildMaterialityPrompt, parseMaterialityReply } from "./materiality";
import { getAdapter, makeOpenAIAdapter, setAdapter, resetAdapter } from "./llm";
import { isSkillArtifactPath, buildOmitMatcher } from "./omit";
import { MetricsCollector, MetricsSnapshot } from "./metrics";
import { inspectRepositoryAuthority } from "./authority_scan";
import { CANONICAL_METADATA_WRITER } from "./carrier_operation";
import {
  executeFileTransaction,
  recoverPendingTransactions,
  type FileMutationIntent,
} from "./file_transaction";
import type { AuthorityConflict } from "./operation_contracts";

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface SkillsPipelineConfig {
  root: string;
  /** Caller-supplied writer-intent identifier (CLI/action parity with check/apply). */
  authority: string;
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
  /** True only when repository authority loaded and no writer conflicts were found. */
  authorityResolved: boolean;
  /** True only when the governed transaction committed at least one changed path. */
  repositoryMutated: boolean;
  /** Authority-scan conflicts; non-empty when the run failed closed. */
  authorityConflicts: AuthorityConflict[];
}

/**
 * Postcondition for the governed skills transaction: each committed SKILL.md must
 * match its planned bytes exactly. A mismatch throws inside the transaction's backup
 * window and rolls the whole run back. Mirrors apply's validateCommittedPlan.
 */
function validateSkillsCommit(root: string, intents: readonly FileMutationIntent[]): void {
  for (const intent of intents) {
    const target = path.join(root, ...intent.path.split("/"));
    if (sha256(fs.readFileSync(target)) !== sha256(intent.bytes)) {
      throw new Error(`SKILLS_POSTCONDITION_FAILED: ${intent.path} committed bytes differ from plan`);
    }
  }
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

interface SkillFilePlan {
  result: SkillsFileResult;
  /** Present only for a real (non-dry-run) protected mutation. */
  intent?: FileMutationIntent;
}

async function processSkillFile(
  abs: string,
  root: string,
  config: SkillsPipelineConfig,
  assistCfg: AssistConfig,
  metrics: MetricsCollector,
): Promise<SkillFilePlan> {
  const rel = path.relative(root, abs).split(path.sep).join("/");
  const rawBuffer = fs.readFileSync(abs);
  const raw = rawBuffer.toString("utf8");
  const parsed = parseExistingFrontMatter(raw);
  if (parsed.issue) {
    if (config.verbose) process.stderr.write(`[l9-meta-injector] skills: ${rel} skipped: ${parsed.issue}\n`);
    return { result: { sourcePath: abs, relativePath: rel, changed: false, diffs: [], skippedReason: parsed.issue } };
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
  if (!didChange) return { result: { sourcePath: abs, relativePath: rel, changed: false, diffs } };

  // dry-run is a read-only preview: report the intended change, plan no mutation.
  if (config.dryRun) {
    if (config.verbose) {
      process.stderr.write(`[l9-meta-injector] skills: ${rel} → ${diffs.map((d) => d.field).join(",")}\n`);
    }
    return { result: { sourcePath: abs, relativePath: rel, changed: true, diffs } };
  }

  if (!hadFrontMatter && !next.description) {
    return { result: { sourcePath: abs, relativePath: rel, changed: false, diffs: [] } };
  }
  const managed: MetaRecord = {};
  for (const diff of diffs) managed[diff.field] = diff.newValue;
  const patched = patchManagedFrontMatter(raw, managed);
  if (!patched.safe) {
    const skippedReason = `${patched.issue?.code ?? "FRONTMATTER_UNSAFE"}: ${patched.issue?.message ?? "unsafe header"}`;
    if (config.verbose) process.stderr.write(`[l9-meta-injector] skills: ${rel} skipped: ${skippedReason}\n`);
    return { result: { sourcePath: abs, relativePath: rel, changed: false, diffs: [], skippedReason } };
  }
  if (config.verbose) {
    process.stderr.write(`[l9-meta-injector] skills: ${rel} → ${diffs.map((d) => d.field).join(",")}\n`);
  }
  // Route the protected write through the governed transaction rather than a direct
  // fs.writeFileSync. CAS fields come from the exact bytes observed at plan time.
  return {
    result: { sourcePath: abs, relativePath: rel, changed: true, diffs },
    intent: {
      path: rel,
      expectedExists: true,
      expectedHash: sha256(rawBuffer),
      bytes: patched.content,
    },
  };
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

  // Repository authority is mandatory before any protected SKILL.md mutation
  // (INV-018 / ADR-033). Recovery precedes inspection so interrupted-transaction
  // artifacts cannot poison the authority scan. dry-run is a read-only preview and
  // keeps its historical semantics: it never mutates, so it is not authority-gated.
  let authorityResolved = true;
  let authorityConflicts: AuthorityConflict[] = [];
  if (!config.dryRun) {
    recoverPendingTransactions(root);
    const inspection = inspectRepositoryAuthority(root, {
      expectedWriter: { repository: CANONICAL_METADATA_WRITER },
    });
    authorityConflicts = inspection.conflicts;
    authorityResolved = inspection.conflicts.length === 0 && inspection.authority !== undefined;
  }

  const omit = buildOmitMatcher({
    root,
    patterns: config.omitPatterns,
    omitFile: config.omitFile,
    protectSkillMd: false,
    ignoreDirNames: ["node_modules"],
  });
  // Fail closed: without resolved authority we neither discover nor mutate skills.
  const skillPaths = authorityResolved
    ? findFiles(root, "**/*", { omit, protectSkillMd: false }).filter((p) => isSkillArtifactPath(p))
    : [];

  const assistCfg = {
    ...DEFAULT_ASSIST_CONFIG,
    enabled: config.llmEnabled,
    cursorSkillDescription: true,
    proseFields: ["description", "activation_signals"] as AssistConfig["proseFields"],
  };

  const files: SkillsFileResult[] = [];
  const intents: FileMutationIntent[] = [];
  for (const abs of skillPaths) {
    const planned = await processSkillFile(abs, root, config, assistCfg, metrics);
    files.push(planned.result);
    if (planned.intent) intents.push(planned.intent);
  }

  let repositoryMutated = false;
  if (!config.dryRun && intents.length > 0) {
    const ordered = [...intents].sort((left, right) => left.path.localeCompare(right.path));
    const transaction = executeFileTransaction(root, ordered, {
      validate: () => validateSkillsCommit(root, ordered),
    });
    repositoryMutated = transaction.changedPaths.length > 0;
  }

  const changed = files.filter((f) => f.changed).length;

  const report = {
    generatedAt: new Date().toISOString(),
    root,
    authorityResolved,
    repositoryMutated,
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
    authorityResolved,
    repositoryMutated,
    authorityConflicts,
  };
}
