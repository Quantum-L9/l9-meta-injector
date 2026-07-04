"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRIMITIVE_TAXONOMY = exports.UNKNOWN = void 0;
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
//# sourceMappingURL=schema.js.map