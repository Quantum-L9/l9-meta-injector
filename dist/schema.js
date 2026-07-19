"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.META_V3_PLANES = exports.META_V3_SCHEMA_VERSION = exports.PRIMITIVE_TAXONOMY = exports.UNKNOWN = void 0;
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