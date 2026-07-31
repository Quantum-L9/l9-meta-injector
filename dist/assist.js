"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRAMMAR_ORIGIN_FIELDS = exports.PROSE_ORIGIN_FIELDS = exports.DEFAULT_ASSIST_CONFIG = void 0;
exports.isGoodValue = isGoodValue;
exports.hasUseWhenSignal = hasUseWhenSignal;
exports.assistField = assistField;
// assist.ts — LLM assist for prose-origin fields only.
// Rule: if a field has structured grammar (YAML frontmatter, heading list), parse it.
// If it lives in prose, seed with regex, let LLM finish — but only when seed fails "good" predicate.
const schema_1 = require("./schema");
const llm_1 = require("./llm");
exports.DEFAULT_ASSIST_CONFIG = {
    enabled: false,
    proseFields: ["description", "activation_signals"],
};
// "good" predicate: value is non-Unknown, non-empty, >=8 meaningful word tokens
function isGoodValue(v) {
    if (v === schema_1.UNKNOWN || v === null || v === undefined)
        return false;
    if (typeof v === "string") {
        const t = v.trim();
        return t !== "" && t !== schema_1.UNKNOWN && t.split(/\s+/).length >= 8;
    }
    if (Array.isArray(v))
        return v.length > 0 && v.every((i) => i !== schema_1.UNKNOWN && String(i).trim() !== "");
    return false;
}
/** Cursor-native descriptions should include explicit "use when" trigger language. */
function hasUseWhenSignal(description) {
    if (typeof description !== "string")
        return false;
    return /\buse when\b/i.test(description);
}
// Fields that live in prose → seed with regex, LLM finishes.
// "intent" dropped (DWL-007): not a schema field, so it was never reachable here.
exports.PROSE_ORIGIN_FIELDS = new Set([
    "description", "activation_signals", "input_contract", "output_contract",
]);
// Fields that live in structured grammar → parse only, never LLM
exports.GRAMMAR_ORIGIN_FIELDS = new Set([
    "role", "objective", "constraints", "validation_gates", "stop_conditions",
    "phase_model", "input_variables", "output_format", "model_target",
    "id", "title", "artifact_type", "mcp_primitive", "callable", "namespace", "sharing_scope",
]);
async function assistField(fieldName, seedValue, body, config, metrics) {
    if (!config.enabled)
        return seedValue;
    // Seed already good → no LLM needed; record the non-LLM path (OBS-009).
    // Cursor skill descriptions that lack "Use when" are treated as weak even if long.
    if (fieldName === "description" && config.cursorSkillDescription) {
        if (isGoodValue(seedValue) && hasUseWhenSignal(seedValue)) {
            metrics?.recordDecision("heuristic");
            return seedValue;
        }
    }
    else if (isGoodValue(seedValue)) {
        metrics?.recordDecision("heuristic");
        return seedValue;
    }
    const adapter = (0, llm_1.getAdapter)();
    if (!adapter.classify) {
        metrics?.recordDecision("no_adapter");
        return seedValue;
    }
    const result = await adapter.classify(buildFieldPrompt(fieldName, body, config));
    if (!result || result.trim() === "" || result.trim() === schema_1.UNKNOWN) {
        metrics?.recordDecision("llm_failed_fallback"); // LLM consulted, no usable answer → keep seed
        return seedValue;
    }
    metrics?.recordDecision("llm_ok");
    return result.trim();
}
function buildFieldPrompt(fieldName, body, config) {
    const b = body.length > 1200 ? body.slice(0, 1200) + "\n[truncated]" : body;
    switch (fieldName) {
        case "description":
            if (config.cursorSkillDescription) {
                return [
                    "Write a Cursor Agent Skill description in third person (≤1024 characters).",
                    "First say what the skill does, then include explicit \"Use when …\" trigger terms",
                    "so an agent can decide when to apply it. Body:",
                    b,
                    "Description:",
                ].join("\n");
            }
            return `Write a single sentence (≤20 words) describing what this artifact does. Body:\n${b}\nDescription:`;
        case "activation_signals": return `List 3-6 short trigger phrases (comma-separated) for this artifact. Body:\n${b}\nSignals:`;
        case "input_contract": return `Describe inputs this artifact expects in ≤15 words. Body:\n${b}\nInput contract:`;
        case "output_contract": return `Describe outputs this artifact produces in ≤15 words. Body:\n${b}\nOutput contract:`;
        default: return `Extract the ${fieldName} from this text in ≤20 words:\n${b}\n${fieldName}:`;
    }
}
//# sourceMappingURL=assist.js.map