/** A blanket wildcard never authorizes a hidden control, even when it matches. */
export declare function explicitHiddenControlPattern(relativePath: string, patterns: readonly string[]): string | undefined;
/** Traverse only the known .github control subtree, never arbitrary dot directories. */
export declare function canTraverseHiddenControl(relativePath: string, patterns: readonly string[]): boolean;
