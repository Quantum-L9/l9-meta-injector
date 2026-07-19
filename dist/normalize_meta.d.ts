import { ClassifyResult, ExtractedFields, NormalizedMeta } from "./schema";
import { NamespaceConfig } from "./namespace";
import { yamlScalar } from "./yaml_serialize";
export { yamlScalar };
export declare function serializeToYamlFrontMatter(meta: NormalizedMeta): string;
export declare function buildMeta(filePath: string, originalBody: string, ef: ExtractedFields, cr: ClassifyResult, nsCfg: NamespaceConfig, authority: string, now: string): NormalizedMeta;
