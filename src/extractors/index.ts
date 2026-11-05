// extractors/index.ts — the versioned extractor registry.
//
// Adding, removing, or re-versioning an extractor changes what the repository is
// observed to declare, so the registry participates in the interpretation
// profile hash. Callers pass this set explicitly rather than the orchestrator
// reaching for it, which keeps the contract independent of its implementation.
import { Extractor } from "../interpretation";
import {
  contractInvariantsExtractor,
  contractReferenceExtractor,
  manifestExtractor,
  serviceSpecExtractor,
} from "./structured";
import { nativeMetadataExtractor } from "./native_metadata";
import { staticImportExtractor } from "./static_imports";
import { workflowStructureExtractor } from "./workflows";
import {
  declaredAuthorityExtractor,
  pythonRouteObservationExtractor,
  repositoryStatusExtractor,
} from "./prose";
import {
  documentStructureExtractor,
  workIntelligenceExtractor,
} from "./work_intelligence";

export {
  contractInvariantsExtractor,
  contractReferenceExtractor,
  manifestExtractor,
  serviceSpecExtractor,
} from "./structured";
export { nativeMetadataExtractor } from "./native_metadata";
export { staticImportExtractor } from "./static_imports";
export { workflowStructureExtractor } from "./workflows";
export {
  declaredAuthorityExtractor,
  pythonRouteObservationExtractor,
  repositoryStatusExtractor,
} from "./prose";
export {
  WORK_KIND_VOCABULARY,
  WORK_PREDICATES,
  WORK_STATUS_VOCABULARY,
  documentStructureExtractor,
  workIntelligenceExtractor,
} from "./work_intelligence";

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
