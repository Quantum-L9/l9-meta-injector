// taxonomy.ts — single authority for the artifact-type vocabularies (finding RAA-003).
//
// The codebase carries four "artifact_type" vocabularies that previously stood
// side by side with no declared relationship:
//   1. ArtifactType            (schema.ts) — 10 coarse values. CANONICAL: it drives
//                                the MCP-primitive taxonomy and the emitted header.
//   2. SemanticArtifactClass   (schema.ts) — 17 fine-grained classes for the v3
//                                nine-plane model.
//   3. InventoryArtifactType   (inventory.ts) — 12 file-oriented classes used by the
//                                standalone inventory tool.
//   4. docs/contracts.md move_map taxonomy (architecture|contract|node_spec|infra|
//                                template|skill|unknown) — belongs to the SECONDARY
//                                Python consolidation engine (tools/consolidation),
//                                which is out of scope for the shipped TS package per
//                                the ACA-001 engine-authority decision. It is NOT
//                                mapped here on purpose: the TS package never reads it.
//
// This module designates ArtifactType canonical and expresses (2) and (3) as total,
// typed mappings onto it — so a coarse artifact_type can always be recovered from a
// finer classification. The maps are declared as Record<Union, ArtifactType>, which
// makes them exhaustive at compile time: adding a class without a mapping fails the
// build. The mappings are advisory and intentionally lossy (many→one).

import { ArtifactType, SemanticArtifactClass } from "./schema";
import { InventoryArtifactType } from "./inventory";

// v3 semantic class → canonical coarse ArtifactType.
const SEMANTIC_CLASS_TO_ARTIFACT_TYPE: Record<SemanticArtifactClass, ArtifactType> = {
  source_module: "source",
  type_definitions: "source",
  test_suite: "test",
  schema: "source",
  configuration: "source",
  documentation: "context",
  contract: "doctrine",
  build_manifest: "source",
  build_artifact: "source",
  fixture: "test",
  script: "script",
  pipeline: "script",
  prompt_template: "prompt",
  skill_definition: "skill",
  governance_doctrine: "doctrine",
  changelog: "context",
  unknown: "unknown",
};

// Inventory file class → canonical coarse ArtifactType.
const INVENTORY_TYPE_TO_ARTIFACT_TYPE: Record<InventoryArtifactType, ArtifactType> = {
  spec: "context",
  code: "source",
  schema: "source",
  prompt: "prompt",
  research_markdown: "context",
  research_pdf: "context",
  config: "source",
  test: "test",
  documentation: "context",
  archive: "unknown",
  folder: "unknown",
  unknown: "unknown",
};

/** Map a v3 SemanticArtifactClass onto the canonical coarse ArtifactType. */
export function semanticClassToArtifactType(cls: SemanticArtifactClass): ArtifactType {
  return SEMANTIC_CLASS_TO_ARTIFACT_TYPE[cls];
}

/** Map an InventoryArtifactType onto the canonical coarse ArtifactType. */
export function inventoryTypeToArtifactType(t: InventoryArtifactType): ArtifactType {
  return INVENTORY_TYPE_TO_ARTIFACT_TYPE[t];
}
