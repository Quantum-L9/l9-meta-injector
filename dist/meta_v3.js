"use strict";
// meta_v3.ts — the live producer for the v3 nine-plane metadata model.
//
// Before this module the MetaV3 types in schema.ts had no builder, serializer, or
// validator: nothing produced a v3 record and nothing consumed one (audit finding
// DWL-003 / RAA-001 — "dead contract"). buildMetaV3 re-expresses a v1/v2
// NormalizedMeta as the nine orthogonal planes, drawing the placement plane from
// the placement compiler (DWL-002) and the semantic class from the 17-class
// classifier (DWL-001). It is additive: it reads existing metadata and changes
// no v1/v2 behavior.
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildMetaV3 = buildMetaV3;
exports.hasAllPlanes = hasAllPlanes;
const schema_1 = require("./schema");
// NormalizedMeta is a union; these fields exist only on some members. Read them
// defensively so the builder works for every artifact type without narrowing.
function opt(meta, key) {
    const v = (0, schema_1.asRecord)(meta)[key];
    return v === undefined ? schema_1.UNKNOWN : v;
}
/** Compose a complete nine-plane {@link MetaV3} from existing metadata. Pure. */
function buildMetaV3(input) {
    const { meta, placement } = input;
    const family = opt(meta, "family") || "Unknown";
    return {
        identity: {
            id: meta.id,
            title: meta.title,
            artifact_type: meta.artifact_type,
            content_hash: meta.content_hash,
            version: schema_1.UNKNOWN,
        },
        taxonomy: {
            family,
            mcp_primitive: meta.mcp_primitive,
            callable: meta.callable,
            retrievable: meta.retrievable,
            injectable: meta.injectable,
        },
        placement: {
            namespace: meta.namespace,
            source_path: meta.source_path,
            output_path: placement ? placement.targetPath : schema_1.UNKNOWN,
            layer: placement ? placement.layer : schema_1.UNKNOWN,
            sharing_scope: meta.sharing_scope,
        },
        routing: {
            advisory: true,
            activation_signals: opt(meta, "activation_signals"),
            input_contract: opt(meta, "input_contract"),
            output_contract: opt(meta, "output_contract"),
            targets: placement ? [placement.targetDirectory] : schema_1.UNKNOWN,
        },
        provenance: {
            created_or_detected_at: meta.created_or_detected_at,
            generated_by: input.generatedBy ?? "l9-meta-injector",
            upstream: schema_1.UNKNOWN,
            snapshot_hash: meta.content_hash,
        },
        governance: {
            authority: meta.authority,
            status: "active",
            owner: opt(meta, "owner"),
            decision_drivers: opt(meta, "decision_drivers"),
        },
        economics: {
            token_cost_estimate: meta.token_cost_estimate,
            size_bytes: input.sizeBytes ?? schema_1.UNKNOWN,
        },
        assurance: {
            validation_gates: opt(meta, "validation_gates"),
            stop_conditions: opt(meta, "stop_conditions"),
        },
        lineage: {
            schema_version: schema_1.META_V3_SCHEMA_VERSION,
            supersedes: schema_1.UNKNOWN,
            chain: schema_1.UNKNOWN,
        },
    };
}
/**
 * Structural validator: true iff `value` carries all nine canonical planes.
 * Enables the "skip if a v3 record is already present" idempotency check that
 * contracts.md promises but nothing previously enforced.
 */
function hasAllPlanes(value) {
    if (typeof value !== "object" || value === null)
        return false;
    const obj = value;
    return schema_1.META_V3_PLANES.every((plane) => typeof obj[plane] === "object" && obj[plane] !== null);
}
//# sourceMappingURL=meta_v3.js.map