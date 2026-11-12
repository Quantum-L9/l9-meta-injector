import { Extractor } from "../interpretation";
export { nativeMetadataExtractor } from "./native_metadata";
export { declaredAuthorityExtractor, pythonRouteObservationExtractor, repositoryStatusExtractor, } from "./prose";
export { staticImportExtractor } from "./static_imports";
export { contractInvariantsExtractor, contractReferenceExtractor, manifestExtractor, serviceSpecExtractor, } from "./structured";
export { documentStructureExtractor, WORK_KIND_VOCABULARY, WORK_PREDICATES, WORK_STATUS_VOCABULARY, workIntelligenceExtractor, } from "./work_intelligence";
export { workflowStructureExtractor } from "./workflows";
/** Every extractor in the current interpretation profile. */
export declare function defaultExtractors(): Extractor[];
