export interface MetaFieldDef {
    name: string;
    source?: string;
    default?: unknown;
    required?: boolean;
}
export interface MetaSchema {
    schema_id: string;
    version: string;
    description?: string;
    target: string[];
    fields: MetaFieldDef[];
}
export interface AppliedMeta {
    fields: Record<string, unknown>;
    missingRequired: string[];
}
/**
 * Parse the constrained canonical YAML subset into a plain object.
 * Supports: top-level `key: scalar`, `key: [inline,list]`, and `key:` followed by a
 * list of scalars or a list of maps (2-space indented). Not a general YAML parser.
 */
export declare function parseCanonicalYaml(text: string): Record<string, unknown>;
/** Validate parsed object into a MetaSchema; throws on structural error. */
export declare function toMetaSchema(obj: Record<string, unknown>): MetaSchema;
/** Resolve a schema against one source record into the concrete meta fields. */
export declare function applySchema(record: Record<string, unknown>, schema: MetaSchema): AppliedMeta;
export declare function targetIncludes(schema: MetaSchema | undefined, t: "file_header" | "sidecar" | "manifest"): boolean;
