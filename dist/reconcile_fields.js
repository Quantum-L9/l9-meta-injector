"use strict";
// reconcile_fields.ts — Five-way field reconciliation: add/revise/append-union/keep/replace
//
// Materiality rule (spec-exact):
//   Scalar prose fields (description, intent): LLM boolean call if adapter.classify is wired.
//   All others: sync 20%-content-size heuristic.
//   List fields: always union, never overwrite.
//   replace: explicit deprecation marker only (deprecated:true | superseded_by | status:deprecated).
//   Every mutation is recorded in FieldDiff[]. No silent writes.
Object.defineProperty(exports, "__esModule", { value: true });
exports.reconcileFieldsAsync = reconcileFieldsAsync;
exports.reconcileFields = reconcileFields;
exports.diffsToLogYaml = diffsToLogYaml;
const schema_1 = require("./schema");
const assist_1 = require("./assist");
const llm_1 = require("./llm");
// List fields: always union + dedup, never overwrite — covers triggers, anti_triggers, entity_types
const LIST_UNION_FIELDS = new Set([
    "activation_signals", "triggers", "anti_triggers", "entity_types",
    "constraints", "validation_gates", "stop_conditions", "phase_model", "input_variables",
]);
// Prose scalar fields where LLM boolean judgment earns its keep (~20 tokens)
const LLM_MATERIALITY_FIELDS = new Set(["description", "intent"]);
function hasExplicitDeprecation(existing) {
    if (existing["deprecated"] === true || existing["deprecated"] === "true")
        return true;
    if (existing["superseded_by"] && existing["superseded_by"] !== schema_1.UNKNOWN)
        return true;
    if (typeof existing["status"] === "string") {
        const s = existing["status"].toLowerCase();
        if (s === "deprecated" || s === "superseded" || s === "retired")
            return true;
    }
    return false;
}
function unionArrays(a, b) {
    const toArr = (v) => {
        if (v === schema_1.UNKNOWN || v === null || v === undefined)
            return [];
        if (Array.isArray(v))
            return v.map(String).filter((s) => s && s !== schema_1.UNKNOWN);
        if (typeof v === "string")
            return v.split(",").map((s) => s.trim()).filter(Boolean);
        return [];
    };
    const merged = [...new Set([...toArr(a), ...toArr(b)])];
    return merged.length > 0 ? merged : [schema_1.UNKNOWN];
}
// Sync heuristic: new is >20% larger in serialized form and passes good predicate
function isMateriallyBetterSync(old, next) {
    if (!(0, assist_1.isGoodValue)(next))
        return false;
    if (!(0, assist_1.isGoodValue)(old))
        return true;
    return JSON.stringify(next).length > JSON.stringify(old).length * 1.2;
}
// Async LLM boolean: "Is B materially more informative than A?" — ~20 tokens
async function isMateriallyBetterLlm(field, old, next) {
    if (!(0, assist_1.isGoodValue)(next))
        return false;
    if (!(0, assist_1.isGoodValue)(old))
        return true;
    const adapter = (0, llm_1.getAdapter)();
    if (!adapter.classify)
        return isMateriallyBetterSync(old, next); // no LLM — fall back to sync
    const prompt = `Field: ${field}\nA: ${JSON.stringify(old)}\nB: ${JSON.stringify(next)}\nIs B materially more informative than A? Reply only: yes or no`;
    const result = await adapter.classify(prompt);
    return result?.trim().toLowerCase().startsWith("yes") ?? isMateriallyBetterSync(old, next);
}
// Async reconcile: used by pipeline (llmEnabled path) — LLM boolean on prose scalar fields
async function reconcileFieldsAsync(existing, incoming) {
    const merged = { ...existing };
    const diffs = [];
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
            merged[field] = unioned;
            diffs.push({ field, action: "append-union", oldValue: oldVal, newValue: unioned, reason: "list field — union, never overwrite" });
            continue;
        }
        if (deprecated) {
            merged[field] = newVal;
            diffs.push({ field, action: "replace", oldValue: oldVal, newValue: newVal, reason: "explicit deprecation/superseded_by marker present" });
            continue;
        }
        // LLM boolean for prose scalar fields (description, intent); sync heuristic for everything else
        const better = LLM_MATERIALITY_FIELDS.has(field)
            ? await isMateriallyBetterLlm(field, oldVal, newVal)
            : isMateriallyBetterSync(oldVal, newVal);
        if (better) {
            merged[field] = newVal;
            const method = LLM_MATERIALITY_FIELDS.has(field) && (0, llm_1.getAdapter)().classify ? "LLM boolean judgment" : "content-size heuristic (>20%)";
            diffs.push({ field, action: "revise", oldValue: oldVal, newValue: newVal, reason: `new value materially better — ${method}` });
        }
        else {
            diffs.push({ field, action: "keep", oldValue: oldVal, newValue: newVal, reason: "old value passes 'good' predicate; no material improvement" });
        }
    }
    return { merged, diffs };
}
// Sync reconcile: used by non-LLM paths (inject.ts default, CLI without --llm)
function reconcileFields(existing, incoming) {
    const merged = { ...existing };
    const diffs = [];
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
            merged[field] = unioned;
            diffs.push({ field, action: "append-union", oldValue: oldVal, newValue: unioned, reason: "list field — union, never overwrite" });
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
        }
        else {
            diffs.push({ field, action: "keep", oldValue: oldVal, newValue: newVal, reason: "old value passes 'good' predicate; no material improvement" });
        }
    }
    return { merged, diffs };
}
function diffsToLogYaml(filePath, diffs, timestamp) {
    const lines = [`# inject.log`, `file: "${filePath}"`, `timestamp: "${timestamp}"`, `changes:`];
    for (const d of diffs) {
        lines.push(`  - field: ${d.field}`, `    action: ${d.action}`, `    reason: "${d.reason}"`);
        if (d.oldValue !== undefined)
            lines.push(`    old: ${JSON.stringify(d.oldValue)}`);
        lines.push(`    new: ${JSON.stringify(d.newValue)}`);
    }
    if (diffs.length === 0)
        lines.push("  []");
    return lines.join("\n") + "\n";
}
//# sourceMappingURL=reconcile_fields.js.map