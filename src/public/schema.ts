export {
  UNKNOWN, PRIMITIVE_TAXONOMY, asRecord, normalizeMetaRecord, coerceNormalizedMeta,
  META_V3_SCHEMA_VERSION, META_V3_PLANES, isPromptMeta,
  LEGACY_OPERATION_ALIASES, META_AUTHORITY_SCHEMA, META_AUTHORITY_SCHEMA_V2, OPERATION_MODES,
  REQUIRED_SEMANTIC_LEDGERS,
  assertAuthorityForOperation, isAuthorityConfig, isProductDeclaration,
  isSemanticFoundationBinding, isSupportedAuthoritySchema,
  operationRequiresAuthority, resolveOperationMode, semanticBindingErrors,
} from "../schema";
export { buildMetaV3, hasAllPlanes } from "../meta_v3";
export type {
  Unknown, ArtifactType, McpPrimitive, ArtifactFamily, SharingScope, PrimitiveTaxonomyEntry,
  ExtractedFields, HeaderConvention, BodyStructure, ScanEntry, ClassifyResult, BaseHeader,
  ExecutableRetrievalMeta, PromptMeta, DoctrineMeta, ArtifactMeta, NormalizedMeta, MetaRecord,
  ReconcileAction, FieldDiff, InjectionRecord, VerifyResult, PipelineConfig, MetaV3SchemaVersion,
  LifecycleStatus, MetaV3Plane, IdentityPlane, TaxonomyPlane, PlacementPlane, RoutingPlane,
  ProvenancePlane, GovernancePlane, EconomicsPlane, AssurancePlane, LineagePlane, MetaV3,
  SemanticArtifactClass, ClassConfidence, ArtifactClassification,
  AuthorityConfig, AuthorityConflict, AuthorityConflictCode, AuthorityLegacyPolicy,
  AuthorityWriter, CarrierDecision, CheckDrift, CheckDriftKind, CheckResult,
  HeaderIdentityRequest, HeaderIdentityResolution, HeaderIdentitySource,
  LegacyOperationMode, MetaAuthoritySchema, MetadataCarrier, OperationMode,
  OperationModeResolution, OperationResult, ApplyResult, ApplyTransactionSummary,
  ProductDeclaration, ProductKindDeclaration, SemanticAdmissionState,
  SemanticFoundationBinding,
} from "../schema";
export type { BuildMetaV3Input, MetaV3Record } from "../meta_v3";
