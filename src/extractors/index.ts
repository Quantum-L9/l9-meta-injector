// extractors/index.ts — the versioned extractor registry.
//
// Adding, removing, or re-versioning an extractor changes what the repository is
// observed to declare, so the registry participates in the interpretation
// profile hash. Callers pass this set explicitly rather than the orchestrator
// reaching for it, which keeps the contract independent of its implementation.
import { Extractor } from "../interpretation";
import {
  contractInvariantsExtractor,
  manifestExtractor,
  serviceSpecExtractor,
} from "./structured";
import {
  declaredAuthorityExtractor,
  pythonRouteObservationExtractor,
  repositoryStatusExtractor,
} from "./prose";

export {
  contractInvariantsExtractor,
  manifestExtractor,
  serviceSpecExtractor,
} from "./structured";
export {
  declaredAuthorityExtractor,
  pythonRouteObservationExtractor,
  repositoryStatusExtractor,
} from "./prose";

/** Every extractor in the current interpretation profile. */
export function defaultExtractors(): Extractor[] {
  return [
    contractInvariantsExtractor,
    declaredAuthorityExtractor,
    manifestExtractor,
    pythonRouteObservationExtractor,
    repositoryStatusExtractor,
    serviceSpecExtractor,
  ];
}
