// skills_pipeline.ts — Cursor-native skills mode (ADR-017).
// Only skill artifacts are considered. Inventory/pipeline never mutate SKILL.md;
// this mode may patch Cursor frontmatter under materiality rules:
//   - Primary: description (what + "Use when …")
//   - Optional: activation_signals as L9 metadata when missing/empty
//   - Never invent a Cursor `triggers:` key or stamp L9 identity headers
// Write only when there is at least one material field diff.

import * as fs from "fs";
import * as path from "path";
import { findFiles } from "./retrieval";
import { splitContent } from "./extract";
import { parseCanonicalYaml } from "./meta_schema";
import { serializeYamlObject } from "./yaml_serialize";
import { MetaRecord, UNKNOWN } from "./schema";
import { assistField, isGoodValue, hasUseWhenSignal, DEFAULT_ASSIST_CONFIG } from "./assist";
import type { AssistConfig } from "./assist";
import { buildMaterialityPrompt, parseMaterialityReply } from "./materiality";
import { getAdapter, makeOpenAIAdapter, setAdapter, resetAdapter } from "./llm";
import { isSkillArtifactPath, buildOmitMatcher } from "./omit";
import { MetricsCollector, MetricsSnapshot } from "./metrics";
import { FieldDiff } from "./schema";

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

function parseExistingFrontMatter(raw: string): { meta: MetaRecord; body: string; hadFrontMatter: boolean } {
  const { frontMatter, body } = splitContent(raw);
  if (!frontMatter) return { meta: {}, body: raw, hadFrontMatter: false };
  const inner = frontMatter.replace(/^---\r?\n/, "").replace(/\r?\n---\s*$/, "");
  try {
    const obj = parseCanonicalYaml(inner);
    if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
      return { meta: obj as MetaRecord, body, hadFrontMatter: true };
    }
  } catch {
    // Malformed frontmatter: treat as no meta so we do not clobber the file.
  }
  return { meta: {}, body: raw, hadFrontMatter: false };
}

function parseSignalList(v: unknown): string[] {
  if (v === UNKNOWN || v === null || v === undefined) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof v === "string") {
    return v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  }
  return [];
}

function writeFrontMatter(meta: MetaRecord, body: string): string {
  const fm = serializeYamlObject(meta, { fences: true, trailingNewline: false });
  const cleanBody = body.replace(/^\n+/, "");
  return `${fm}\n\n${cleanBody}`;
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
  // llmEnabled with incomplete credentials: keep any pre-set adapter (tests / local wiring).

  const root = path.resolve(config.root);
  fs.mkdirSync(config.outDir, { recursive: true });

  // Discover text files without SKILL.md protect; noise omit still applies.
  const omit = buildOmitMatcher({
    root,
    patterns: config.omitPatterns,
    omitFile: config.omitFile,
    protectSkillMd: false,
    ignoreDirNames: ["node_modules"],
  });
  const all = findFiles(root, "**/*", { omit, protectSkillMd: false });
  const skillPaths = all.filter((p) => isSkillArtifactPath(p));

  const assistCfg = {
    ...DEFAULT_ASSIST_CONFIG,
    enabled: config.llmEnabled,
    cursorSkillDescription: true,
    proseFields: ["description", "activation_signals"] as AssistConfig["proseFields"],
  };

  const files: SkillsFileResult[] = [];
  let changed = 0;

  for (const abs of skillPaths) {
    const rel = path.relative(root, abs).split(path.sep).join("/");
    const raw = fs.readFileSync(abs, "utf8");
    const { meta: existing, body, hadFrontMatter } = parseExistingFrontMatter(raw);

    // Never invent L9 identity stamps. Start from existing Cursor keys only.
    const next: MetaRecord = { ...existing };
    const diffs: FieldDiff[] = [];

    const seedDesc = typeof existing.description === "string" ? existing.description : "";
    const proposedDesc = await assistField("description", seedDesc || UNKNOWN, body, assistCfg, metrics);
    const descStr = typeof proposedDesc === "string" ? proposedDesc : "";

    if (!("description" in existing) || !isGoodValue(existing.description) || !hasUseWhenSignal(existing.description)) {
      if (isGoodValue(descStr) && (hasUseWhenSignal(descStr) || !isGoodValue(existing.description))) {
        const better = !("description" in existing) || !isGoodValue(existing.description)
          || await isMateriallyBetter("description", existing.description, descStr);
        if (better && descStr !== existing.description) {
          next.description = descStr.slice(0, 1024);
          diffs.push({
            field: "description",
            action: ("description" in existing) ? "revise" : "add",
            oldValue: existing.description,
            newValue: next.description,
            reason: "Cursor-native description material improvement",
          });
        }
      }
    } else if (isGoodValue(descStr) && descStr !== existing.description) {
      if (await isMateriallyBetter("description", existing.description, descStr)) {
        next.description = descStr.slice(0, 1024);
        diffs.push({
          field: "description",
          action: "revise",
          oldValue: existing.description,
          newValue: next.description,
          reason: "Cursor-native description material improvement",
        });
      }
    }

    // Optional L9 activation_signals — only when missing/empty.
    const existingSignals = parseSignalList(existing.activation_signals);
    if (existingSignals.length === 0) {
      const proposed = await assistField("activation_signals", UNKNOWN, body, assistCfg, metrics);
      const list = parseSignalList(proposed);
      if (list.length > 0) {
        next.activation_signals = list;
        diffs.push({
          field: "activation_signals",
          action: "add",
          oldValue: existing.activation_signals,
          newValue: list,
          reason: "optional L9 activation_signals filled (missing/empty)",
        });
      }
    }

    // Preserve name; never invent a conflicting rename.
    if (typeof existing.name === "string" && existing.name.trim()) {
      next.name = existing.name;
    }

    const didChange = diffs.some((d) => d.action === "add" || d.action === "revise");
    if (didChange && !config.dryRun) {
      // If the file had no frontmatter and we only add optional signals without a
      // description, still require a description before writing Cursor frontmatter.
      if (!hadFrontMatter && !next.description) {
        files.push({ sourcePath: abs, relativePath: rel, changed: false, diffs: [] });
        continue;
      }
      fs.writeFileSync(abs, writeFrontMatter(next, body), "utf8");
      changed++;
      files.push({ sourcePath: abs, relativePath: rel, changed: true, diffs });
    } else if (didChange && config.dryRun) {
      changed++;
      files.push({ sourcePath: abs, relativePath: rel, changed: true, diffs });
    } else {
      files.push({ sourcePath: abs, relativePath: rel, changed: false, diffs });
    }

    if (config.verbose && didChange) {
      process.stderr.write(`[l9-meta-injector] skills: ${rel} → ${diffs.map((d) => d.field).join(",")}\n`);
    }
  }

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
