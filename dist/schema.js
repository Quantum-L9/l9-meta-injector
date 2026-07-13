"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.META_V3_PLANES = exports.META_V3_SCHEMA_VERSION = exports.PRIMITIVE_TAXONOMY = exports.UNKNOWN = void 0;
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
//
// v3 re-expresses the flat v1/v2 header (BaseHeader and its extensions) as nine
// orthogonal metadata planes. Each plane isolates one concern of the L9
// metadata compilation engine (identity, placement, routing, provenance, ...),
// so that downstream compilers can reason about a single plane without
// materializing the whole header. v3 is additive: it does not replace v1/v2 and
// changes no existing behavior.
// ---------------------------------------------------------------------------
exports.META_V3_SCHEMA_VERSION = 3;
/**
 * The nine plane names, in canonical order. Exported as a runtime tuple so that
 * validators and tests can enumerate the planes without reflection.
 */
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
//# sourceMappingURL=schema.js.map