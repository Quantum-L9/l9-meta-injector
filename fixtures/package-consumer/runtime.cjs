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
  advanced:["applyCommentInjection","applySchema","assertCarrierDecisionCoverage","assistField","buildCarrierOperationPlan","buildDedupEntries","buildDedupReport","buildMeta","buildOmitMatcher","buildPrimitiveLibraryIndex","buildPromptLibraryIndex","BUILTIN_NOISE_PATTERNS","BUILTIN_SKILL_PROTECT_PATTERNS","CARRIER_PRECEDENCE","CLASS_PLACEMENT_HINTS","classify","classifyArtifact","classifyWithSemantics","compileMetadataIndex","compilePlacementPlan","compilePlacementPlans","contentHash","dedupReportToMarkdown","DEFAULT_ASSIST_CONFIG","diffsToLogYaml","estimateTokens","executeFileTransaction","extract","extractInjectedYaml","FILE_TRANSACTION_SCHEMA","findFiles","FRONTMATTER_EXTS","FRONTMATTER_PATCH_SCHEMA","frontMatterInner","GRAMMAR_ORIGIN_FIELDS","hasInjectedBlock","hasUseWhenSignal","injectFile","injectFileAsync","INLINE_MANAGED_ARTIFACT_TYPES","inlinePlanDrift","inspectFrontMatterDocument","isGoodValue","isProbablyBinary","isSemanticArtifactClass","isSkillArtifactPath","isSkillMdBasename","L9_METAIGNORE_FILENAME","METADATA_INDEX_RELATIVE_PATH","METADATA_INDEX_SCHEMA","metadataIndexDrift","normalizeFilename","normalizeFilenames","normalizeFilenameWithLog","parseCanonicalYaml","parseMetadataIndex","patchManagedFrontMatter","placementHintFor","planCarrierOperationAsync","PROSE_ORIGIN_FIELDS","QUARANTINE_DIRECTORY","reconcileFields","reconcileFieldsAsync","recoverPendingTransactions","resolveCarrierDecision","resolveCarrierDecisions","resolveNamespace","resolveStrategy","scanFiles","SEMANTIC_ARTIFACT_CLASSES","serializeMetadataIndex","serializeToYamlFrontMatter","sidecarPathFor","splitContent","stripExistingFrontMatter","stripInjectedBlock","targetIncludes","toMetaSchema","toSnakeCase","toSnakeStem","TRANSACTION_DIRECTORY","verify","writeMetadataIndex","yamlScalar","yamlToBlock"],
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
console.log("packed-runtime: OK (6 supported entrypoints)");
