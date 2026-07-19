export declare function yamlScalar(v: unknown): string;
export interface SerializeYamlOptions {
    /** Wrap the body in `---` fences (default: true). */
    fences?: boolean;
    /** Append a trailing newline after the closing fence (default: false). */
    trailingNewline?: boolean;
}
export declare function serializeYamlObject(obj: Record<string, unknown>, opts?: SerializeYamlOptions): string;
