/**
 * One glob dialect for every path scope the injector honors.
 *
 * The discovery scope (`--glob`, the `glob` action input, `PipelineConfig.glob`) and the
 * repository authority's `inline_allow` patterns answer the same question — "does this
 * repository-relative path belong to the set the operator named?" — so they compile
 * through one function. Before this module the discovery scope honored only a trailing
 * `*.ext` and silently ignored any path prefix, so `docs/**` followed by `/*.md` planned
 * and mutated `other/b.md`, while the authority matched the same pattern precisely
 * (ADR-047).
 *
 * Dialect: `**` followed by `/` matches zero or more directories, `**` elsewhere matches
 * across separators, `*` matches within one segment, `?` matches one non-separator
 * character, every other character is literal. Brace alternation, character classes and
 * negation are not part of the dialect: the authority treats them as literals
 * (fail-closed, a pattern that never matches grants nothing), and the discovery scope
 * refuses them explicitly, because a scope that silently matched nothing — or
 * everything — would make a governed run report success over the wrong file set.
 */
export declare function globToRegExpSource(pattern: string): string;
/** Case-sensitive matcher used by the repository authority (`inline_allow`). */
export declare function globToRegExp(pattern: string): RegExp;
/**
 * Validate a discovery-scope glob. The scope names the files a governed run may plan
 * and mutate, so it is judged before any directory is read: absolute, parent-relative,
 * backslash, doubled-separator, control-character and unsupported-syntax patterns are
 * refused with the reason, never narrowed or widened silently.
 */
export declare function assertDiscoveryGlob(pattern: string): string;
export interface DiscoveryGlob {
    pattern: string;
    /** Whole-path matcher, case-insensitive so `*.MD` keeps matching `.md` as the former extension filter did. */
    matches: (relativePath: string) => boolean;
    /** `.ext` when the final segment is exactly `*.ext`; the legacy extension-filter shape. */
    extensionFilter: string | null;
}
/** Compile a validated discovery-scope glob into a whole-path matcher. */
export declare function compileDiscoveryGlob(pattern: string): DiscoveryGlob;
