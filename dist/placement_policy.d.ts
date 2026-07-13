import { SemanticArtifactClass, ClassConfidence } from "./schema";
export interface PlacementOptions {
    /** Namespace stamped onto the plan. Default: "l9". */
    namespace?: string;
    /** Optional root prefixed onto every target path (repo-relative). */
    rootDir?: string;
    /**
     * Confidence at or below which an artifact is routed to the quarantine
     * directory instead of its class directory. Default: "low".
     */
    quarantineAtOrBelow?: ClassConfidence;
}
export interface PlacementPlan {
    sourcePath: string;
    artifactClass: SemanticArtifactClass;
    confidence: ClassConfidence;
    layer: string;
    namespace: string;
    targetDirectory: string;
    targetPath: string;
    quarantined: boolean;
    /** Always false: this compiler emits plans, it never writes. */
    writesRequired: false;
    rationale: string[];
}
/**
 * Compile a single {@link PlacementPlan}. Pure: depends only on its arguments,
 * writes nothing, never throws on well-formed input.
 */
export declare function compilePlacementPlan(sourcePath: string, body?: string, opts?: PlacementOptions): PlacementPlan;
/**
 * Compile plans for a batch of artifacts. Order-preserving and pure; a
 * convenience wrapper over {@link compilePlacementPlan}.
 */
export declare function compilePlacementPlans(inputs: Array<{
    sourcePath: string;
    body?: string;
}>, opts?: PlacementOptions): PlacementPlan[];
