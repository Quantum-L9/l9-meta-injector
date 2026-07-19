import { MetaV3, NormalizedMeta, ArtifactClassification } from "./schema";
import { PlacementPlan } from "./placement_policy";
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
export declare function buildMetaV3(input: BuildMetaV3Input): MetaV3;
/**
 * Structural validator: true iff `value` carries all nine canonical planes.
 * Enables the "skip if a v3 record is already present" idempotency check that
 * contracts.md promises but nothing previously enforced.
 */
export declare function hasAllPlanes(value: unknown): value is MetaV3;
