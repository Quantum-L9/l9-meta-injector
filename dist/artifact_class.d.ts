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
