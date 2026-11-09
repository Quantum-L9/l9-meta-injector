// extractors/index.ts — the versioned extractor registry.
//
// Adding, removing, or re-versioning an extractor changes what the repository is
// observed to declare, so the registry participates in the interpretation
// profile hash. Callers pass this set explicitly rather than the orchestrator
// reaching for it, which keeps the contract independent of its implementation.
import { Extractor } from "../interpretation";
import { nativeMetadataExtractor } from "./native_metadata";
import {
  declaredAuthorityExtractor,
  pythonRouteObservationExtractor,
  repositoryStatusExtractor,
} from "./prose";
import { staticImportExtractor } from "./static_imports";
import {
  contractInvariantsExtractor,
  contractReferenceExtractor,
  manifestExtractor,
  serviceSpecExtractor,
} from "./structured";
import { documentStructureExtractor, workIntelligenceExtractor } from "./work_intelligence";
import { workflowStructureExtractor } from "./workflows";

export { nativeMetadataExtractor } from "./native_metadata";
export {
  declaredAuthorityExtractor,
  pythonRouteObservationExtractor,
  repositoryStatusExtractor,
} from "./prose";
export { staticImportExtractor } from "./static_imports";
export {
  contractInvariantsExtractor,
  contractReferenceExtractor,
  manifestExtractor,
  serviceSpecExtractor,
} from "./structured";
export {
  documentStructureExtractor,
  WORK_KIND_VOCABULARY,
  WORK_PREDICATES,
  WORK_STATUS_VOCABULARY,
  workIntelligenceExtractor,
} from "./work_intelligence";
export { workflowStructureExtractor } from "./workflows";

/** Every extractor in the current interpretation profile. */
export function defaultExtractors(): Extractor[] {
  return [
    contractInvariantsExtractor,
    contractReferenceExtractor,
    declaredAuthorityExtractor,
    documentStructureExtractor,
    manifestExtractor,
    nativeMetadataExtractor,
    pythonRouteObservationExtractor,
    repositoryStatusExtractor,
    serviceSpecExtractor,
    staticImportExtractor,
    workflowStructureExtractor,
    workIntelligenceExtractor,
  ];
}
