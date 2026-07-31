import * as root from "../src/index";
import * as inventory from "../src/public/inventory";
import * as schema from "../src/public/schema";
import * as advanced from "../src/public/advanced";
import * as llm from "../src/public/llm";
const expected={
 root:["META_V3_PLANES","META_V3_SCHEMA_VERSION","PRIMITIVE_TAXONOMY","UNKNOWN","isPromptMeta","runPipelineAsync","runSkillsPipelineAsync"],
 inventory:["buildDuplicateClusters","buildRecord","classifyInventory","inventoryTree","loadMetaSchema"],
 schema:["META_V3_PLANES","META_V3_SCHEMA_VERSION","PRIMITIVE_TAXONOMY","UNKNOWN","asRecord","buildMetaV3","coerceNormalizedMeta","hasAllPlanes","isPromptMeta","normalizeMetaRecord"],
 advanced:["BUILTIN_NOISE_PATTERNS","BUILTIN_SKILL_PROTECT_PATTERNS","CLASS_PLACEMENT_HINTS","DEFAULT_ASSIST_CONFIG","FRONTMATTER_EXTS","GRAMMAR_ORIGIN_FIELDS","L9_METAIGNORE_FILENAME","PROSE_ORIGIN_FIELDS","QUARANTINE_DIRECTORY","SEMANTIC_ARTIFACT_CLASSES","applyCommentInjection","applySchema","assistField","buildDedupEntries","buildDedupReport","buildMeta","buildOmitMatcher","buildPrimitiveLibraryIndex","buildPromptLibraryIndex","classify","classifyArtifact","classifyWithSemantics","compilePlacementPlan","compilePlacementPlans","contentHash","dedupReportToMarkdown","diffsToLogYaml","estimateTokens","extract","extractInjectedYaml","findFiles","frontMatterInner","hasInjectedBlock","hasUseWhenSignal","injectFile","injectFileAsync","isGoodValue","isProbablyBinary","isSemanticArtifactClass","isSkillArtifactPath","isSkillMdBasename","normalizeFilename","normalizeFilenameWithLog","normalizeFilenames","parseCanonicalYaml","placementHintFor","reconcileFields","reconcileFieldsAsync","resolveNamespace","resolveStrategy","scanFiles","serializeToYamlFrontMatter","sidecarPathFor","splitContent","stripExistingFrontMatter","stripInjectedBlock","targetIncludes","toMetaSchema","toSnakeCase","toSnakeStem","verify","yamlScalar","yamlToBlock"],
 llm:["getAdapter","localAdapter","makeOpenAIAdapter","resetAdapter","setAdapter"]
};
describe("public runtime API",()=>{
 for(const [name,value] of Object.entries({root,inventory,schema,advanced,llm})) test(`${name} exact runtime inventory`,()=>expect(Object.keys(value).sort()).toEqual(expected[name as keyof typeof expected].sort()));
 test("root excludes process-global and low-level controls",()=>{ for(const name of ["setAdapter","injectFile","parseCanonicalYaml","buildDedupReport"]) expect(name in root).toBe(false); });
});
