import { ArtifactType, ClassifyResult, ExtractedFields, NormalizedMeta, McpPrimitive } from "./schema";
import { NamespaceConfig } from "./namespace";
import type { HeaderIdentityResolution } from "./operation_contracts";
export { yamlScalar } from "./yaml_serialize";
/** Taxonomy fields that must stay a single derived unit. */
export interface TaxonomyProjection {
    artifact_type: ArtifactType;
    mcp_primitive: McpPrimitive;
    callable: boolean;
    retrievable: boolean;
    injectable: boolean;
}
/**
 * Project the four MCP/capability fields from one artifact type.
 * `retrievable` follows `injectable`, matching the historical `buildMeta` rule.
 */
export declare function projectPrimitiveTaxonomy(artifactType: ArtifactType): TaxonomyProjection;
export declare function serializeToYamlFrontMatter(meta: NormalizedMeta): string;
export declare function buildMeta(filePath: string, originalBody: string, ef: ExtractedFields, cr: ClassifyResult, nsCfg: NamespaceConfig, authority: string, detectedAt: string, sourceRoot?: string, identity?: HeaderIdentityResolution): NormalizedMeta;
