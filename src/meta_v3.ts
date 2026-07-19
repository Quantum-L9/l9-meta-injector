// meta_v3.ts — the live producer for the v3 nine-plane metadata model.
//
// Before this module the MetaV3 types in schema.ts had no builder, serializer, or
// validator: nothing produced a v3 record and nothing consumed one (audit finding
// DWL-003 / RAA-001 — "dead contract"). buildMetaV3 re-expresses a v1/v2
// NormalizedMeta as the nine orthogonal planes, drawing the placement plane from
// the placement compiler (DWL-002) and the semantic class from the 17-class
// classifier (DWL-001). It is additive: it reads existing metadata and changes
// no v1/v2 behavior.

import {
  MetaV3, NormalizedMeta, ArtifactClassification, UNKNOWN, Unknown,
  META_V3_SCHEMA_VERSION, META_V3_PLANES, ArtifactFamily, asRecord,
} from "./schema";
import { PlacementPlan } from "./placement_policy";

// NormalizedMeta is a union; these fields exist only on some members. Read them
// defensively so the builder works for every artifact type without narrowing.
function opt<T>(meta: NormalizedMeta, key: string): T | Unknown {
  const v = asRecord(meta)[key];
  return v === undefined ? UNKNOWN : (v as T);
}

export interface BuildMetaV3Input {
  meta: NormalizedMeta;
  /** 17-class semantic classification (DWL-001) — recorded on the emitted record. */
  semantic: ArtifactClassification;
  /** Placement plan for this artifact (DWL-002) — drives the placement/routing planes. */
  placement?: PlacementPlan;
  sizeBytes?: number;
  generatedBy?: string;
}

/** A v3 record plus the semantic classification that informed it. */
export interface MetaV3Record {
  sourcePath: string;
  semanticClass: ArtifactClassification["artifactClass"];
  semanticConfidence: ArtifactClassification["confidence"];
  metaV3: MetaV3;
}

/** Compose a complete nine-plane {@link MetaV3} from existing metadata. Pure. */
export function buildMetaV3(input: BuildMetaV3Input): MetaV3 {
  const { meta, placement } = input;
  const family = (opt<ArtifactFamily>(meta, "family") as ArtifactFamily) || "Unknown";

  return {
    identity: {
      id: meta.id,
      title: meta.title,
      artifact_type: meta.artifact_type,
      content_hash: meta.content_hash,
      version: UNKNOWN,
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
      output_path: placement ? placement.targetPath : UNKNOWN,
      layer: placement ? placement.layer : UNKNOWN,
      sharing_scope: meta.sharing_scope,
    },
    routing: {
      advisory: true,
      activation_signals: opt<string[]>(meta, "activation_signals"),
      input_contract: opt<string>(meta, "input_contract"),
      output_contract: opt<string>(meta, "output_contract"),
      targets: placement ? [placement.targetDirectory] : UNKNOWN,
    },
    provenance: {
      created_or_detected_at: meta.created_or_detected_at,
      generated_by: input.generatedBy ?? "l9-meta-injector",
      upstream: UNKNOWN,
      snapshot_hash: meta.content_hash,
    },
    governance: {
      authority: meta.authority,
      status: "active",
      owner: opt<string>(meta, "owner"),
      decision_drivers: opt<string[]>(meta, "decision_drivers"),
    },
    economics: {
      token_cost_estimate: meta.token_cost_estimate,
      size_bytes: input.sizeBytes ?? UNKNOWN,
    },
    assurance: {
      validation_gates: opt<string[]>(meta, "validation_gates"),
      stop_conditions: opt<string[]>(meta, "stop_conditions"),
    },
    lineage: {
      schema_version: META_V3_SCHEMA_VERSION,
      supersedes: UNKNOWN,
      chain: UNKNOWN,
    },
  };
}

/**
 * Structural validator: true iff `value` carries all nine canonical planes.
 * Enables the "skip if a v3 record is already present" idempotency check that
 * contracts.md promises but nothing previously enforced.
 */
export function hasAllPlanes(value: unknown): value is MetaV3 {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return META_V3_PLANES.every(
    (plane) => typeof obj[plane] === "object" && obj[plane] !== null
  );
}
