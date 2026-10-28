export declare function yamlScalar(v: unknown, forbidden?: readonly string[]): string;
export interface SerializeYamlOptions {
    /** Wrap the body in `---` fences (default: true). */
    fences?: boolean;
    /** Append a trailing newline after the closing fence (default: false). */
    trailingNewline?: boolean;
    /**
     * Sequences the destination carrier cannot contain (see comment.carrierForbiddenSequences).
     * Values holding one are escaped; a key holding one is refused. Default: none,
     * which leaves the output byte-identical for every other caller.
     */
    forbidden?: readonly string[];
}
export declare function serializeYamlObject(obj: Record<string, unknown>, opts?: SerializeYamlOptions): string;
