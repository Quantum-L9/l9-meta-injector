"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.META_V3_PLANES = exports.META_V3_SCHEMA_VERSION = exports.PRIMITIVE_TAXONOMY = exports.UNKNOWN = void 0;
exports.asRecord = asRecord;
exports.coerceNormalizedMeta = coerceNormalizedMeta;
exports.isPromptMeta = isPromptMeta;
exports.UNKNOWN = "Unknown";
exports.PRIMITIVE_TAXONOMY = {
    skill: { type: "skill", meaning: "atomic capability", callable: true, mcpPrimitive: "tool", injectable: true },
    playbook: { type: "playbook", meaning: "multi-step orchestration", callable: true, mcpPrimitive: "tool", injectable: true },
    kernel: { type: "kernel", meaning: "sandboxed execution or rule set", callable: true, mcpPrimitive: "tool", injectable: true },
    context: { type: "context", meaning: "retrievable knowledge", callable: true, mcpPrimitive: "resource", injectable: true },
    prompt: { type: "prompt", meaning: "parameterized prompt contract", callable: true, mcpPrimitive: "prompt", injectable: true },
    doctrine: { type: "doctrine", meaning: "governance artifact", callable: false, mcpPrimitive: "none", injectable: true },
    test: { type: "test", meaning: "test artifact", callable: false, mcpPrimitive: "none", injectable: false },
    script: { type: "script", meaning: "script artifact", callable: false, mcpPrimitive: "none", injectable: false },
    source: { type: "source", meaning: "source or config file", callable: false, mcpPrimitive: "resource", injectable: true },
    unknown: { type: "unknown", meaning: "unclassified", callable: false, mcpPrimitive: "none", injectable: false },
};
// The identity block every NormalizedMeta variant shares, with the runtime type
// each field must carry. Single-sourced here so coerceNormalizedMeta and the
// interfaces above cannot drift apart.
const BASE_HEADER_TYPES = [
    ["id", "string"], ["title", "string"], ["artifact_type", "string"],
    ["mcp_primitive", "string"], ["callable", "boolean"], ["retrievable", "boolean"],
    ["injectable", "boolean"], ["namespace", "string"], ["sharing_scope", "string"],
    ["source_path", "string"], ["content_hash", "string"],
    ["token_cost_estimate", "number"], ["authority", "string"],
    ["created_or_detected_at", "string"],
];
/**
 * Widen a known object type to a generic key/value bag. Centralizes the one
 * `as unknown as Record` escape hatch so read-paths that only need to index a
 * field by name don't each hand-roll a double-cast (finding QTE-005 / CWE-704).
 */
function asRecord(value) {
    return value;
}
/**
 * Narrow a generic key/value bag into a NormalizedMeta, validating the shared
 * BaseHeader identity block FIRST. Replaces the blind `bag as unknown as
 * NormalizedMeta` double-casts (finding QTE-005 / CWE-704): a bag whose identity
 * fields have drifted (missing, or the wrong runtime type) throws here at the
 * boundary instead of silently compiling and surfacing as a malformed header
 * downstream. Extra keys (schema-specific / inventory-specific) ride along
 * untouched — the injector serializes meta as a generic bag.
 *
 * Use this only where the bag is meant to be a full artifact header. The
 * schema-driven inventory path deliberately emits operator-defined field sets
 * that need not include the identity block, so it keeps its own documented
 * boundary adapter rather than routing through this guard.
 */
function coerceNormalizedMeta(bag) {
    for (const [key, expected] of BASE_HEADER_TYPES) {
        const actual = typeof bag[key];
        if (actual !== expected) {
            throw new Error(`coerceNormalizedMeta: identity field '${key}' must be ${expected}, got ${bag[key] === undefined ? "undefined" : actual}`);
        }
    }
    return bag;
}
// ---------------------------------------------------------------------------
// Metadata v3 — nine-plane schema
// ---------------------------------------------------------------------------
exports.META_V3_SCHEMA_VERSION = 3;
exports.META_V3_PLANES = [
    "identity",
    "taxonomy",
    "placement",
    "routing",
    "provenance",
    "governance",
    "economics",
    "assurance",
    "lineage",
];
// ---------------------------------------------------------------------------
// Canonical type guard — single authoritative isPromptMeta.
// Import this wherever artifact_type === "prompt" must be narrowed;
// do NOT redefine locally in compiler.ts, pipeline.ts, or verify.ts.
// ---------------------------------------------------------------------------
function isPromptMeta(m) {
    return typeof m === "object" && m !== null &&
        m.artifact_type === "prompt";
}
//# sourceMappingURL=schema.js.map