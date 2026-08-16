import { Extractor } from "../interpretation";
export { contractInvariantsExtractor, manifestExtractor, serviceSpecExtractor, } from "./structured";
export { declaredAuthorityExtractor, pythonRouteObservationExtractor, repositoryStatusExtractor, } from "./prose";
/** Every extractor in the current interpretation profile. */
export declare function defaultExtractors(): Extractor[];
