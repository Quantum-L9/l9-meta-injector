export declare const L9_METAIGNORE_FILENAME = ".l9metaignore";
/** Built-in noise: never inventoriable / never injectable in any mode. */
export declare const BUILTIN_NOISE_PATTERNS: readonly string[];
/**
 * Built-in protect for inventory + pipeline: Cursor Agent Skill entrypoints.
 * Matched case-insensitively on basename in addition to these glob patterns.
 */
export declare const BUILTIN_SKILL_PROTECT_PATTERNS: readonly string[];
export interface OmitOptions {
    /** Scan root used to load `.l9metaignore` when present. */
    root: string;
    /** Extra gitignore-style patterns from CLI `--omit`. */
    patterns?: string[];
    /** Optional extra omit-file path from CLI `--omit-file`. */
    omitFile?: string;
    /**
     * When true, built-in SKILL.md protect patterns apply.
     * Skills mode sets this false so it can mutate skill entrypoints.
     */
    protectSkillMd?: boolean;
    /** Extra directory basenames to treat as ignored. */
    ignoreDirNames?: string[];
}
export interface OmitMatcher {
    /** True if this relative path should be skipped. */
    shouldOmit(relPath: string): boolean;
    /** Patterns actually loaded, in precedence order. */
    patterns: string[];
    /** Repository-relative or explicit omit sources that were loaded. */
    sources?: string[];
}
/** True when basename is SKILL.md under any casing. */
export declare function isSkillMdBasename(filePath: string): boolean;
/** True only for the canonical skill entrypoint basename, SKILL.md (case-insensitive). */
export declare function isSkillArtifactPath(filePath: string): boolean;
/**
 * Build an omit matcher from built-ins, `.l9metaignore`, and optional CLI
 * patterns. Last matching rule wins. Declared omit files fail closed.
 */
export declare function buildOmitMatcher(opts: OmitOptions): OmitMatcher;
