/** Where a declaration was read from. Stable identifiers: they appear in assertions. */
export type NativeMetadataCarrier = "legacy-hash" | "legacy-hash-bare" | "legacy-html" | "legacy-docstring" | "frontmatter" | "managed-frontmatter" | "managed-comment";
/** The state a field is in after reading. Nothing here says the value is true. */
export type NativeMetadataFieldState = "declared" | "unresolved" | "unsupported";
export interface NativeMetadataValue {
    /** The value exactly as written, unquoted but otherwise unchanged. */
    text: string;
    /** 1-based line the value was written on. */
    line: number;
}
export interface NativeMetadataField {
    /** The key exactly as written. */
    key: string;
    state: NativeMetadataFieldState;
    /** Declared values; empty for unresolved and unsupported fields. */
    values: NativeMetadataValue[];
    /** 1-based inclusive span of the key and everything that belongs to it. */
    start_line: number;
    end_line: number;
    /** The key's source line. */
    excerpt: string;
    /** Why an unsupported field was not read. */
    reason?: string;
}
export interface NativeMetadataDeclaration {
    carrier: NativeMetadataCarrier;
    /**
     * `l9_schema:<value as written>`, `managed:l9-meta-injector`, or `none` when a
     * native block names no schema.
     */
    declared_schema: string;
    source_path: string;
    /** 1-based inclusive span of the whole carrier, delimiters included. */
    source_span: {
        start_line: number;
        end_line: number;
    };
    /** The carrier's first line, for evidence. */
    excerpt: string;
    fields: NativeMetadataField[];
    /** Keys this reader could not represent; also present in `fields` as unsupported. */
    unsupported_fields: string[];
    /** Keys whose declared values differ from another declaration in the same file. */
    conflicts: string[];
}
export interface NativeMetadataDiagnostic {
    code: string;
    severity: "info" | "warning";
    message: string;
    line?: number;
}
/**
 * A header region the reader recognized: every carrier it found at the head of
 * the file, whether its declaration was read or rejected. A rejected block is
 * still metadata syntax, so a prose reader must exclude it as well.
 */
export interface NativeMetadataRegion {
    carrier: NativeMetadataCarrier;
    start_line: number;
    end_line: number;
    read: boolean;
}
export interface NativeMetadataParseResult {
    declarations: NativeMetadataDeclaration[];
    diagnostics: NativeMetadataDiagnostic[];
    regions: NativeMetadataRegion[];
}
/** Declared schema of every declaration the managed writer produced. */
export declare const MANAGED_DECLARED_SCHEMA = "managed:l9-meta-injector";
/**
 * Read every native metadata declaration at the head of a file.
 *
 * Pure and deterministic: the same path and text always yield the same result,
 * and the text is never modified.
 */
export declare function parseNativeMetadata(sourcePath: string, content: string): NativeMetadataParseResult;
