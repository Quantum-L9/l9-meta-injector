import { SemanticArtifactClass, ArtifactClassification } from "./schema";
/** The 17 semantic classes, in canonical order. */
export declare const SEMANTIC_ARTIFACT_CLASSES: readonly SemanticArtifactClass[];
/**
 * Classify a file into one of 17 semantic classes. Deterministic: depends only
 * on the path, extension, and filename. The optional `body` argument is
 * currently ignored (reserved for future content-based rules). Never throws.
 */
export declare function classifyArtifact(filePath: string, body?: string): ArtifactClassification;
/** True if the value is one of the 17 known semantic classes. */
export declare function isSemanticArtifactClass(value: string): value is SemanticArtifactClass;
export interface PlacementHint {
    /** Canonical target directory (repo-relative, POSIX separators). */
    directory: string;
    /** Logical layer the class belongs to. */
    layer: string;
}
/** Directory into which low-confidence / unknown artifacts are quarantined. */
export declare const QUARANTINE_DIRECTORY = "99_CONFLICTS_AND_UNKNOWN";
/** Canonical placement hint for every one of the 17 semantic classes. */
export declare const CLASS_PLACEMENT_HINTS: Record<SemanticArtifactClass, PlacementHint>;
/** Placement hint for a semantic class (falls back to the quarantine hint). */
export declare function placementHintFor(cls: SemanticArtifactClass): PlacementHint;
