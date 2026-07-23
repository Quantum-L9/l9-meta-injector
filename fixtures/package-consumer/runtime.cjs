"use strict";
const assert=require("assert");
const root=require("l9-meta-injector");
const inventory=require("l9-meta-injector/inventory");
const schema=require("l9-meta-injector/schema");
const advanced=require("l9-meta-injector/advanced");
const llm=require("l9-meta-injector/advanced/llm");
const expected={
  root:["META_V3_PLANES","META_V3_SCHEMA_VERSION","PRIMITIVE_TAXONOMY","UNKNOWN","isPromptMeta","runPipelineAsync"],
  inventory:["buildDuplicateClusters","buildRecord","classifyInventory","inventoryTree","loadMetaSchema"],
  schema:["META_V3_PLANES","META_V3_SCHEMA_VERSION","PRIMITIVE_TAXONOMY","UNKNOWN","asRecord","buildMetaV3","coerceNormalizedMeta","hasAllPlanes","isPromptMeta","normalizeMetaRecord"],
  advanced:["CLASS_PLACEMENT_HINTS","DEFAULT_ASSIST_CONFIG","FRONTMATTER_EXTS","GRAMMAR_ORIGIN_FIELDS","PROSE_ORIGIN_FIELDS","QUARANTINE_DIRECTORY","SEMANTIC_ARTIFACT_CLASSES","applyCommentInjection","applySchema","assistField","buildDedupEntries","buildDedupReport","buildMeta","buildPrimitiveLibraryIndex","buildPromptLibraryIndex","classify","classifyArtifact","classifyWithSemantics","compilePlacementPlan","compilePlacementPlans","contentHash","dedupReportToMarkdown","diffsToLogYaml","estimateTokens","extract","extractInjectedYaml","findFiles","frontMatterInner","hasInjectedBlock","injectFile","injectFileAsync","isGoodValue","isProbablyBinary","isSemanticArtifactClass","normalizeFilename","normalizeFilenameWithLog","normalizeFilenames","parseCanonicalYaml","placementHintFor","reconcileFields","reconcileFieldsAsync","resolveNamespace","resolveStrategy","scanFiles","serializeToYamlFrontMatter","sidecarPathFor","splitContent","stripExistingFrontMatter","stripInjectedBlock","targetIncludes","toMetaSchema","toSnakeCase","toSnakeStem","verify","yamlScalar","yamlToBlock"],
  llm:["getAdapter","localAdapter","makeOpenAIAdapter","resetAdapter","setAdapter"],
};
for(const [name,value] of Object.entries({root,inventory,schema,advanced,llm})) assert.deepStrictEqual(Object.keys(value).sort((a,b)=>a.localeCompare(b)),expected[name].sort((a,b)=>a.localeCompare(b)),`${name} runtime export inventory`);
assert.strictEqual(root.UNKNOWN,"Unknown");
assert.strictEqual(typeof root.runPipelineAsync,"function");
assert.strictEqual(typeof inventory.inventoryTree,"function");
assert.strictEqual(typeof schema.buildMetaV3,"function");
assert.strictEqual(typeof advanced.compilePlacementPlans,"function");
assert.strictEqual(typeof llm.resetAdapter,"function");
console.log("packed-runtime: OK (5 supported entrypoints)");
