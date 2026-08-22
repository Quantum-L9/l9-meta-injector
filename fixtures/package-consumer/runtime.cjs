"use strict";
const assert=require("assert");
const root=require("l9-meta-injector");
const inventory=require("l9-meta-injector/inventory");
const schema=require("l9-meta-injector/schema");
const advanced=require("l9-meta-injector/advanced");
const llm=require("l9-meta-injector/advanced/llm");
const repositoryModel=require("l9-meta-injector/repository-model");
const expected={
  root:["assertAuthorityForOperation","buildCarrierOperationPlan","CANONICAL_METADATA_WRITER","inlinePlanDrift","isAuthorityConfig","isPromptMeta","isSupportedAuthoritySchema","LEGACY_OPERATION_ALIASES","META_AUTHORITY_SCHEMA","META_V3_PLANES","META_V3_SCHEMA_VERSION","metadataIndexDrift","OPERATION_MODES","operationRequiresAuthority","planCarrierOperationAsync","PRIMITIVE_TAXONOMY","resolveOperationMode","runApplyAsync","runCheckAsync","runPipelineAsync","runSkillsPipelineAsync","UNKNOWN"],
  inventory:["buildDuplicateClusters","buildRecord","classifyInventory","inventoryTree","loadMetaSchema"],
  schema:["asRecord","assertAuthorityForOperation","buildMetaV3","coerceNormalizedMeta","hasAllPlanes","isAuthorityConfig","isPromptMeta","isSupportedAuthoritySchema","LEGACY_OPERATION_ALIASES","META_AUTHORITY_SCHEMA","META_V3_PLANES","META_V3_SCHEMA_VERSION","normalizeMetaRecord","OPERATION_MODES","operationRequiresAuthority","PRIMITIVE_TAXONOMY","resolveOperationMode","UNKNOWN"],
  advanced:["acquireLocalSource","applyCommentInjection","applySchema","ARCHIVE_MEMBER_SEPARATOR","assertCarrierDecisionCoverage","assistField","buildCarrierOperationPlan","buildDedupEntries","buildDedupReport","buildLocalSourceManifest","buildMeta","buildOmitMatcher","buildPrimitiveLibraryIndex","buildPromptLibraryIndex","BUILTIN_NOISE_PATTERNS","BUILTIN_SKILL_PROTECT_PATTERNS","canonicalBlockReason","canonicalMemberPath","CARRIER_PRECEDENCE","CLASS_PLACEMENT_HINTS","classify","classifyArtifact","classifyWithSemantics","compileMetadataIndex","compilePlacementPlan","compilePlacementPlans","contentHash","dedupReportToMarkdown","DEFAULT_ASSIST_CONFIG","DEFAULT_LOCAL_ARCHIVE_POLICY","diffsToLogYaml","ENCODING_CHUNK_BYTES","estimateTokens","executeFileTransaction","extract","extractInjectedYaml","FILE_TRANSACTION_SCHEMA","findFiles","FRONTMATTER_EXTS","FRONTMATTER_PATCH_SCHEMA","frontMatterInner","GENERATED_ARTIFACT_OMIT_PATTERNS","GRAMMAR_ORIGIN_FIELDS","hashFileStreaming","hasInjectedBlock","hasLegacyExtractionOwnership","hasUseWhenSignal","injectFile","injectFileAsync","INLINE_MANAGED_ARTIFACT_TYPES","inlinePlanDrift","inspectFrontMatterDocument","isDecodableText","isGoodValue","isLegacyGeneratedExtraction","isProbablyBinary","isSemanticArtifactClass","isSkillArtifactPath","isSkillMdBasename","L9_METAIGNORE_FILENAME","LEGACY_EXTRACTION_OWNER_FILE","LEGACY_EXTRACTION_SUFFIX","LOCAL_ARCHIVE_POLICY_VERSION","LOCAL_SOURCE_MANIFEST_SCHEMA","memberCollisionKey","METADATA_INDEX_RELATIVE_PATH","METADATA_INDEX_SCHEMA","metadataIndexDrift","normalizeFilename","normalizeFilenames","normalizeFilenameWithLog","observeLocalSourceModel","parseCanonicalYaml","parseMetadataIndex","patchManagedFrontMatter","physicalManifestDigest","placementHintFor","planCarrierOperationAsync","preflightArchive","probeBufferEncoding","probeFileEncoding","PROSE_ORIGIN_FIELDS","QUARANTINE_DIRECTORY","readUtf8Strict","reconcileFields","reconcileFieldsAsync","recoverPendingTransactions","resolveCarrierDecision","resolveCarrierDecisions","resolveLocalArchivePolicy","resolveNamespace","resolveStrategy","scanFiles","SCRATCH_OWNER_FILE","SCRATCH_OWNER_ID","SEMANTIC_ARTIFACT_CLASSES","serializeMetadataIndex","serializeToYamlFrontMatter","sidecarPathFor","splitContent","stripExistingFrontMatter","stripInjectedBlock","targetIncludes","toMetaSchema","toRepositoryModelLocalSource","toSnakeCase","toSnakeStem","TRANSACTION_DIRECTORY","verify","withLocalSourceModel","writeLocalSourceManifest","writeMetadataIndex","yamlScalar","yamlToBlock"],
  llm:["getAdapter","localAdapter","makeOpenAIAdapter","resetAdapter","setAdapter"],
  repositoryModel:["buildRepositoryModelPacket","emitRepositoryModelBundle","observeRepositoryModel","REPOSITORY_MODEL_PACKET_TYPE","REPOSITORY_MODEL_PACKET_VERSION","REPOSITORY_MODEL_PRODUCER_NAME","validateRepositoryModelPacket"],
};
for(const [name,value] of Object.entries({root,inventory,schema,advanced,llm,repositoryModel})) assert.deepStrictEqual(Object.keys(value).sort((a,b)=>a.localeCompare(b)),expected[name].sort((a,b)=>a.localeCompare(b)),`${name} runtime export inventory`);
assert.strictEqual(root.UNKNOWN,"Unknown");
assert.strictEqual(typeof root.runPipelineAsync,"function");
assert.strictEqual(typeof root.runSkillsPipelineAsync,"function");
assert.strictEqual(typeof inventory.inventoryTree,"function");
assert.strictEqual(typeof schema.buildMetaV3,"function");
assert.strictEqual(typeof advanced.compilePlacementPlans,"function");
assert.strictEqual(typeof llm.resetAdapter,"function");
assert.strictEqual(typeof repositoryModel.observeRepositoryModel,"function");
assert.strictEqual(repositoryModel.REPOSITORY_MODEL_PACKET_TYPE,"l9.repository-model");
// The local-source acquisition surface must be reachable from an installed tarball,
// not merely present in the repository (ADR-036).
assert.strictEqual(typeof advanced.acquireLocalSource,"function");
assert.strictEqual(typeof advanced.observeLocalSourceModel,"function");
assert.strictEqual(typeof advanced.probeFileEncoding,"function");
assert.strictEqual(advanced.ARCHIVE_MEMBER_SEPARATOR,"!/");
assert.strictEqual(advanced.DEFAULT_LOCAL_ARCHIVE_POLICY.version,"1");
console.log("packed-runtime: OK (6 supported entrypoints)");
