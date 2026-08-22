import { Extractor } from "../interpretation";
export { contractInvariantsExtractor, manifestExtractor, serviceSpecExtractor, } from "./structured";
export { declaredAuthorityExtractor, pythonRouteObservationExtractor, repositoryStatusExtractor, } from "./prose";
export { WORK_KIND_VOCABULARY, WORK_PREDICATES, WORK_STATUS_VOCABULARY, documentStructureExtractor, workIntelligenceExtractor, } from "./work_intelligence";
/** Every extractor in the current interpretation profile. */
export declare function defaultExtractors(): Extractor[];
