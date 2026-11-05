import { Extractor } from "../interpretation";
export { contractInvariantsExtractor, contractReferenceExtractor, manifestExtractor, serviceSpecExtractor, } from "./structured";
export { nativeMetadataExtractor } from "./native_metadata";
export { staticImportExtractor } from "./static_imports";
export { workflowStructureExtractor } from "./workflows";
export { declaredAuthorityExtractor, pythonRouteObservationExtractor, repositoryStatusExtractor, } from "./prose";
export { WORK_KIND_VOCABULARY, WORK_PREDICATES, WORK_STATUS_VOCABULARY, documentStructureExtractor, workIntelligenceExtractor, } from "./work_intelligence";
/** Every extractor in the current interpretation profile. */
export declare function defaultExtractors(): Extractor[];
