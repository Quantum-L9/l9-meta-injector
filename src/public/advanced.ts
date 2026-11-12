export type {
  ArchiveHold,
  ArchiveHoldCode,
  ArchivePreflightInput,
  ArchivePreflightResult,
  PreflightMember,
} from "../archive_preflight";
export { canonicalMemberPath, memberCollisionKey, preflightArchive } from "../archive_preflight";
export type { PlacementHint } from "../artifact_class";
export {
  CLASS_PLACEMENT_HINTS,
  classifyArtifact,
  isSemanticArtifactClass,
  placementHintFor,
  QUARANTINE_DIRECTORY,
  SEMANTIC_ARTIFACT_CLASSES,
} from "../artifact_class";
export type { AssistConfig } from "../assist";
export {
  assistField,
  DEFAULT_ASSIST_CONFIG,
  GRAMMAR_ORIGIN_FIELDS,
  hasUseWhenSignal,
  isGoodValue,
  PROSE_ORIGIN_FIELDS,
} from "../assist";
export type {
  CarrierOperationPlan,
  GovernedCarrierMode,
  PlanCarrierOperationInput,
  TrackedApplyResult,
  TrackedCheckResult,
} from "../carrier_operation";
// Explicit versioned tracked domain; legacy discovery/annotation remains unchanged.
export {
  buildCarrierOperationPlan,
  inlinePlanDrift,
  metadataIndexDrift,
  planCarrierOperationAsync,
  runTrackedApplyAsync,
  runTrackedCheckAsync,
  runTrackedCoverage,
} from "../carrier_operation";
export type { ClassifyResultWithClass } from "../classify";
export { classify, classifyWithSemantics } from "../classify";
export type { InjectionStrategy, StrategySpec } from "../comment";
export {
  applyCommentInjection,
  extractInjectedYaml,
  FRONTMATTER_EXTS,
  frontMatterInner,
  hasInjectedBlock,
  isProbablyBinary,
  resolveStrategy,
  sidecarPathFor,
  stripInjectedBlock,
  yamlToBlock,
} from "../comment";
export type { NearDuplicate } from "../compiler";
export {
  buildDedupEntries,
  buildDedupReport,
  buildPrimitiveLibraryIndex,
  buildPromptLibraryIndex,
  dedupReportToMarkdown,
} from "../compiler";
export type { TrackedGitEntry, TrackedGitSnapshot } from "../discovery_contracts";
export type { EncodingProbe, EncodingStatus } from "../encoding";
export {
  ENCODING_CHUNK_BYTES,
  isDecodableText,
  probeBufferEncoding,
  probeFileEncoding,
  readUtf8Strict,
} from "../encoding";
export {
  contentHash,
  estimateTokens,
  extract,
  splitContent,
  stripExistingFrontMatter,
} from "../extract";
export type {
  ExecuteFileTransactionOptions,
  FileMutationIntent,
  FileTransactionResult,
  RecoveryResult,
  TransactionFaultContext,
  TransactionFaultStage,
} from "../file_transaction";
export {
  executeFileTransaction,
  FILE_TRANSACTION_SCHEMA,
  recoverPendingTransactions,
  TRANSACTION_DIRECTORY,
} from "../file_transaction";
export type {
  FrontMatterField,
  FrontMatterInspection,
  FrontMatterIssue,
  FrontMatterIssueCode,
  FrontMatterPatchResult,
} from "../frontmatter_patch";
export {
  FRONTMATTER_PATCH_SCHEMA,
  inspectFrontMatterDocument,
  patchManagedFrontMatter,
} from "../frontmatter_patch";
export type { InjectOptions } from "../inject";
export { injectFile, injectFileAsync } from "../inject";
export type { LocalArchivePolicy } from "../local_archive_policy";
export {
  DEFAULT_LOCAL_ARCHIVE_POLICY,
  LOCAL_ARCHIVE_POLICY_VERSION,
  resolveLocalArchivePolicy,
} from "../local_archive_policy";
export type {
  LocalArchiveMemberObservation,
  LocalArchiveObservation,
  LocalEntryKind,
  LocalSourceAcquireInput,
  LocalSourceDiagnostic,
  LocalSourceDiagnosticSeverity,
  LocalSourceKind,
  LocalSourceObservation,
  PhysicalManifestEntry,
  RequestedSourceKind,
} from "../local_source";
export {
  ARCHIVE_MEMBER_SEPARATOR,
  acquireLocalSource,
  GENERATED_ARTIFACT_OMIT_PATTERNS,
  hashFileStreaming,
  hasLegacyExtractionOwnership,
  isLegacyGeneratedExtraction,
  LEGACY_EXTRACTION_OWNER_FILE,
  LEGACY_EXTRACTION_SUFFIX,
  physicalManifestDigest,
  SCRATCH_OWNER_FILE,
  SCRATCH_OWNER_ID,
} from "../local_source";
export type {
  BuildLocalSourceManifestOptions,
  LocalSourceManifest,
  LocalSourceModelInput,
  LocalSourceModelResult,
} from "../local_source_model";
export {
  buildLocalSourceManifest,
  canonicalBlockReason,
  LOCAL_SOURCE_MANIFEST_SCHEMA,
  observeLocalSourceModel,
  toRepositoryModelLocalSource,
  withLocalSourceModel,
  writeLocalSourceManifest,
} from "../local_source_model";
export type { AppliedMeta, MetaFieldDef, MetaSchema } from "../meta_schema";
export { applySchema, parseCanonicalYaml, targetIncludes, toMetaSchema } from "../meta_schema";
export type {
  CompileMetadataIndexInput,
  ManagedMetadataSubject,
  MetadataIndexCompilation,
  MetadataIndexHeaderV2,
  MetadataIndexRecord,
  MetadataIndexRecordV2,
  TrackedCoverageReceipt,
  TrackedMetadataCompilation,
  VersionedMetadataIndex,
  WriteMetadataIndexOptions,
  WriteMetadataIndexResult,
} from "../metadata_index";
export {
  compileMetadataIndex,
  METADATA_INDEX_RELATIVE_PATH,
  METADATA_INDEX_SCHEMA,
  parseMetadataIndex,
  readVersionedMetadataIndex,
  serializeMetadataIndex,
  writeMetadataIndex,
} from "../metadata_index";
export type {
  CarrierInjectionStrategy,
  CarrierPolicyInput,
  CarrierSubject,
} from "../mutation_policy";
export {
  assertCarrierDecisionCoverage,
  CARRIER_PRECEDENCE,
  INLINE_MANAGED_ARTIFACT_TYPES,
  resolveCarrierDecision,
  resolveCarrierDecisions,
} from "../mutation_policy";
export type {
  NamespaceConfig,
  NamespaceInput,
  NamespaceResolution,
  SharingScope,
} from "../namespace";
export { resolveNamespace, toSnakeStem } from "../namespace";
export type { NormalizeFilenameOptions, NormalizeFilenameResult } from "../normalize_filename";
export {
  normalizeFilename,
  normalizeFilenames,
  normalizeFilenameWithLog,
  toSnakeCase,
} from "../normalize_filename";
export { buildMeta, serializeToYamlFrontMatter, yamlScalar } from "../normalize_meta";
export type { OmitMatcher, OmitOptions } from "../omit";
export {
  BUILTIN_NOISE_PATTERNS,
  BUILTIN_SKILL_PROTECT_PATTERNS,
  buildOmitMatcher,
  isSkillArtifactPath,
  isSkillMdBasename,
  L9_METAIGNORE_FILENAME,
} from "../omit";
export type {
  TrackedApplyInput,
  TrackedCheckInput,
  TrackedCoverageInput,
} from "../operation_contracts";
export type { PlacementOptions, PlacementPlan } from "../placement_policy";
export { compilePlacementPlan, compilePlacementPlans } from "../placement_policy";
export type { FieldDiff, ReconcileAction, ReconcileResult } from "../reconcile_fields";
export { diffsToLogYaml, reconcileFields, reconcileFieldsAsync } from "../reconcile_fields";
export type { FindFilesOptions } from "../retrieval";
export { findFiles, scanFiles } from "../retrieval";
export { verify } from "../verify";
