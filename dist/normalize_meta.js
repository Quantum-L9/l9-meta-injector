"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.yamlScalar = void 0;
exports.serializeToYamlFrontMatter = serializeToYamlFrontMatter;
exports.buildMeta = buildMeta;
// normalize_meta.ts — Build NormalizedMeta header (pure, no IO)
const path = __importStar(require("path"));
const schema_1 = require("./schema");
const extract_1 = require("./extract");
const namespace_1 = require("./namespace");
const yaml_serialize_1 = require("./yaml_serialize");
Object.defineProperty(exports, "yamlScalar", { enumerable: true, get: function () { return yaml_serialize_1.yamlScalar; } });
function slugTitle(fp) {
    return path.basename(fp, path.extname(fp)).replace(/[-_.]/g, " ").replace(/^Prompt /i, "").trim();
}
function serializeToYamlFrontMatter(meta) {
    return (0, yaml_serialize_1.serializeYamlObject)(meta);
}
function buildMeta(filePath, originalBody, ef, cr, nsCfg, authority, now) {
    const tax = schema_1.PRIMITIVE_TAXONOMY[cr.artifactType] ?? schema_1.PRIMITIVE_TAXONOMY["unknown"];
    const { namespace, sharingScope, idStem } = (0, namespace_1.resolveNamespace)(filePath, nsCfg, cr.artifactType);
    const base = {
        id: idStem, title: slugTitle(filePath), artifact_type: cr.artifactType,
        mcp_primitive: tax.mcpPrimitive, callable: tax.callable,
        retrievable: tax.injectable, injectable: tax.injectable,
        namespace, sharing_scope: sharingScope,
        source_path: filePath, content_hash: (0, extract_1.contentHash)(originalBody),
        token_cost_estimate: (0, extract_1.estimateTokens)(originalBody), authority,
        created_or_detected_at: now,
    };
    if (cr.artifactType === "doctrine")
        return { ...base, governs: schema_1.UNKNOWN, decision_drivers: schema_1.UNKNOWN, applies_to_domains: schema_1.UNKNOWN };
    if (cr.artifactType === "test" || cr.artifactType === "script" || cr.artifactType === "source")
        return { ...base, owner: schema_1.UNKNOWN };
    const exec = {
        ...base, family: cr.family, description: schema_1.UNKNOWN,
        activation_signals: cr.signals.length > 0 ? cr.signals : schema_1.UNKNOWN,
        input_contract: schema_1.UNKNOWN, output_contract: schema_1.UNKNOWN,
        validation_gates: ef.validationGates, stop_conditions: ef.stopConditions,
    };
    if (cr.artifactType === "prompt") {
        return { ...exec, role: ef.role, objective: ef.objective, input_variables: ef.inputVariables,
            output_format: ef.outputFormat, model_target: ef.modelTarget, constraints: ef.constraints, phase_model: ef.phaseModel };
    }
    return exec;
}
//# sourceMappingURL=normalize_meta.js.map