// reconcile_fields.ts — Five-way field reconciliation: add/revise/append-union/keep/replace
//
// Materiality rule (spec-exact):
//   Scalar prose fields (description): LLM boolean call if adapter.classify is wired.
//   All others: sync 20%-content-size heuristic.
//   List fields: always union, never overwrite.
//   replace: explicit deprecation marker only (deprecated:true | superseded_by | status:deprecated).
//   Every mutation is recorded in FieldDiff[]. No silent writes.

import { UNKNOWN, FieldDiff, MetaRecord } from "./schema";
import { isGoodValue } from "./assist";
import { getAdapter } from "./llm";
import { buildMaterialityPrompt, parseMaterialityReply } from "./materiality";
import { MetricsCollector, DecisionPath, decisionPathLabel } from "./metrics";

// FieldDiff and ReconcileAction are single-sourced in schema.ts (finding ICC-001 /
// ACA-004). Re-export the type so existing `import { FieldDiff } from "./reconcile_fields"`
// call sites keep working without a second definition to drift.
export type { FieldDiff, ReconcileAction } from "./schema";

export interface ReconcileResult {
  merged: MetaRecord;
  diffs: FieldDiff[];
}

// List fields: always union + dedup, never overwrite — covers triggers, anti_triggers, entity_types
const LIST_UNION_FIELDS = new Set([
  "activation_signals", "triggers", "anti_triggers", "entity_types",
  "constraints", "validation_gates", "stop_conditions", "phase_model", "input_variables",
]);

// Prose scalar fields where LLM boolean judgment earns its keep (~20 tokens).
// "intent" was removed (DWL-007): it is not a field in the schema vocabulary
// (schema.ts emits description/activation_signals/input_contract/output_contract,
// never intent), so the entry was dead and could never match a reconciled field.
const LLM_MATERIALITY_FIELDS = new Set(["description"]);

function hasExplicitDeprecation(existing: MetaRecord): boolean {
  if (existing["deprecated"] === true || existing["deprecated"] === "true") return true;
  if (existing["superseded_by"] && existing["superseded_by"] !== UNKNOWN) return true;
  if (typeof existing["status"] === "string") {
    const s = (existing["status"] as string).toLowerCase();
    if (s === "deprecated" || s === "superseded" || s === "retired") return true;
  }
  return false;
}

function unionArrays(a: unknown, b: unknown): unknown {
  const toArr = (v: unknown): string[] => {
    if (v === UNKNOWN || v === null || v === undefined) return [];
    if (Array.isArray(v)) return v.map(String).filter((s) => s && s !== UNKNOWN);
    if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
    return [];
  };
  const merged = [...new Set([...toArr(a), ...toArr(b)])];
  // Empty union → scalar UNKNOWN (as buildMeta first emits it), NOT [UNKNOWN]. Returning
  // a one-element list here flips scalar `field: Unknown` into a `- Unknown` list on the
  // next run, breaking idempotency. Scalar-in / scalar-out keeps re-injection byte-stable.
  return merged.length > 0 ? merged : UNKNOWN;
}

// Sync heuristic: new is >20% larger in serialized form and passes good predicate
function isMateriallyBetterSync(old: unknown, next: unknown): boolean {
  if (!isGoodValue(next)) return false;
  if (!isGoodValue(old)) return true;
  return JSON.stringify(next).length > JSON.stringify(old).length * 1.2;
}

// The materiality verdict plus the path that produced it, so the caller records the
// TRUE decision path (OBS-009) rather than re-deriving it from adapter presence.
interface MaterialityDecision { better: boolean; path: DecisionPath; }

// Async LLM boolean: "Is B materially more informative than A?" — ~20 tokens.
// Reports which path decided so a null/absent LLM never masquerades as an LLM call.
async function isMateriallyBetterLlm(field: string, old: unknown, next: unknown): Promise<MaterialityDecision> {
  // Trivial guards decide without consulting the LLM or the size heuristic.
  if (!isGoodValue(next)) return { better: false, path: "heuristic" };
  if (!isGoodValue(old)) return { better: true, path: "heuristic" };
  const adapter = getAdapter();
  if (!adapter.classify) return { better: isMateriallyBetterSync(old, next), path: "no_adapter" };
  const result = await adapter.classify(buildMaterialityPrompt(field, old, next));
  if (result === null || result === undefined) {
    // LLM was consulted but yielded nothing usable — the heuristic decided.
    return { better: isMateriallyBetterSync(old, next), path: "llm_failed_fallback" };
  }
  return { better: parseMaterialityReply(result), path: "llm_ok" };
}

// Async reconcile: used by pipeline (llmEnabled path) — LLM boolean on prose scalar fields
export async function reconcileFieldsAsync(
  existing: MetaRecord,
  incoming: MetaRecord,
  metrics?: MetricsCollector
): Promise<ReconcileResult> {
  const merged: MetaRecord = { ...existing };
  const diffs: FieldDiff[] = [];
  const deprecated = hasExplicitDeprecation(existing);

  for (const [field, newVal] of Object.entries(incoming)) {
    const oldVal = existing[field];
    const fieldExists = field in existing;

    if (!fieldExists) {
      merged[field] = newVal;
      diffs.push({ field, action: "add", oldValue: undefined, newValue: newVal, reason: "field did not exist" });
      continue;
    }

    if (LIST_UNION_FIELDS.has(field)) {
      const unioned = unionArrays(oldVal, newVal);
      if (JSON.stringify(unioned) === JSON.stringify(oldVal)) {
        // Union produced no change — record as keep, not a mutation. Emitting
        // append-union here would rewrite the .inject.log on every no-op re-run.
        merged[field] = oldVal;
        diffs.push({ field, action: "keep", oldValue: oldVal, newValue: unioned, reason: "list field — union unchanged" });
      } else {
        merged[field] = unioned;
        diffs.push({ field, action: "append-union", oldValue: oldVal, newValue: unioned, reason: "list field — union, never overwrite" });
      }
      continue;
    }

    if (deprecated) {
      merged[field] = newVal;
      diffs.push({ field, action: "replace", oldValue: oldVal, newValue: newVal, reason: "explicit deprecation/superseded_by marker present" });
      continue;
    }

    // LLM boolean for prose scalar fields (description); sync heuristic for everything
    // else. Capture the path actually taken (OBS-009) so the recorded reason and the
    // run-level counter reflect reality, not adapter presence.
    let better: boolean;
    let path: DecisionPath;
    if (LLM_MATERIALITY_FIELDS.has(field)) {
      const decision = await isMateriallyBetterLlm(field, oldVal, newVal);
      better = decision.better;
      path = decision.path;
    } else {
      better = isMateriallyBetterSync(oldVal, newVal);
      path = "heuristic";
    }
    metrics?.recordDecision(path);

    if (better) {
      merged[field] = newVal;
      diffs.push({ field, action: "revise", oldValue: oldVal, newValue: newVal, reason: `new value materially better — ${decisionPathLabel(path)}` });
    } else {
      diffs.push({ field, action: "keep", oldValue: oldVal, newValue: newVal, reason: `old value retained via ${decisionPathLabel(path)}; no material improvement` });
    }
  }

  return { merged, diffs };
}

// Sync reconcile: used by non-LLM paths (inject.ts default, CLI without --llm)
export function reconcileFields(
  existing: MetaRecord,
  incoming: MetaRecord
): ReconcileResult {
  const merged: MetaRecord = { ...existing };
  const diffs: FieldDiff[] = [];
  const deprecated = hasExplicitDeprecation(existing);

  for (const [field, newVal] of Object.entries(incoming)) {
    const oldVal = existing[field];
    const fieldExists = field in existing;

    if (!fieldExists) {
      merged[field] = newVal;
      diffs.push({ field, action: "add", oldValue: undefined, newValue: newVal, reason: "field did not exist" });
      continue;
    }

    if (LIST_UNION_FIELDS.has(field)) {
      const unioned = unionArrays(oldVal, newVal);
      if (JSON.stringify(unioned) === JSON.stringify(oldVal)) {
        // Union produced no change — record as keep, not a mutation. Emitting
        // append-union here would rewrite the .inject.log on every no-op re-run.
        merged[field] = oldVal;
        diffs.push({ field, action: "keep", oldValue: oldVal, newValue: unioned, reason: "list field — union unchanged" });
      } else {
        merged[field] = unioned;
        diffs.push({ field, action: "append-union", oldValue: oldVal, newValue: unioned, reason: "list field — union, never overwrite" });
      }
      continue;
    }

    if (deprecated) {
      merged[field] = newVal;
      diffs.push({ field, action: "replace", oldValue: oldVal, newValue: newVal, reason: "explicit deprecation/superseded_by marker present" });
      continue;
    }

    if (isMateriallyBetterSync(oldVal, newVal)) {
      merged[field] = newVal;
      diffs.push({ field, action: "revise", oldValue: oldVal, newValue: newVal, reason: "new value materially more complete (>20% content)" });
    } else {
      diffs.push({ field, action: "keep", oldValue: oldVal, newValue: newVal, reason: "old value passes 'good' predicate; no material improvement" });
    }
  }

  return { merged, diffs };
}

export function diffsToLogYaml(filePath: string, diffs: FieldDiff[], timestamp: string): string {
  const lines = [`# inject.log`, `file: "${filePath}"`, `timestamp: "${timestamp}"`, `changes:`];
  for (const d of diffs) {
    lines.push(`  - field: ${d.field}`, `    action: ${d.action}`, `    reason: "${d.reason}"`);
    if (d.oldValue !== undefined) lines.push(`    old: ${JSON.stringify(d.oldValue)}`);
    lines.push(`    new: ${JSON.stringify(d.newValue)}`);
  }
  if (diffs.length === 0) lines.push("  []");
  return lines.join("\n") + "\n";
}
