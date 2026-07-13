import { ClassifyResult, HeaderConvention, ArtifactClassification } from "./schema";
export declare function classify(filePath: string, body: string, _hc: HeaderConvention): ClassifyResult;
/** A ClassifyResult augmented with the 17-class semantic classification. */
export interface ClassifyResultWithClass extends ClassifyResult {
    semantic: ArtifactClassification;
}
/**
 * Additive companion to {@link classify}: returns the exact same coarse
 * classification plus the fine-grained 17-class semantic classification.
 * `classify()` itself is left unchanged.
 */
export declare function classifyWithSemantics(filePath: string, body: string, hc: HeaderConvention): ClassifyResultWithClass;
