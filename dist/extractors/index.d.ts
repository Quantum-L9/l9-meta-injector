import { Extractor } from "../interpretation";
export { contractInvariantsExtractor, manifestExtractor, serviceSpecExtractor, } from "./structured";
export { declaredAuthorityExtractor, pythonRouteObservationExtractor, repositoryStatusExtractor, } from "./prose";
export { documentStructureExtractor, workIntelligenceExtractor, WORK_INTELLIGENCE_PREDICATES, WORK_KIND_VOCABULARY, WORK_STATUS_VOCABULARY, } from "./work_intelligence";
/** Every extractor in the current interpretation profile. */
export declare function defaultExtractors(): Extractor[];
