export declare const L9_METAIGNORE_FILENAME = ".l9metaignore";
/** Built-in noise: never inventoriable / never injectable in any mode. */
export declare const BUILTIN_NOISE_PATTERNS: readonly string[];
/**
 * Built-in protect for inventory + pipeline: Cursor Agent Skill entrypoints.
 * Matched case-insensitively on basename (in addition to these glob patterns).
 */
export declare const BUILTIN_SKILL_PROTECT_PATTERNS: readonly string[];
export interface OmitOptions {
    /** Scan root (used to load `.l9metaignore` when present). */
    root: string;
    /** Extra gitignore-style patterns (CLI `--omit`). */
    patterns?: string[];
    /** Optional extra omit-file path (CLI `--omit-file`). */
    omitFile?: string;
    /**
     * When true (default), built-in SKILL.md protect patterns apply.
     * Skills mode sets this false so it can mutate skill entrypoints.
     */
    protectSkillMd?: boolean;
    /** Extra directory basenames to treat as ignored (inventory `--ignore` compat). */
    ignoreDirNames?: string[];
}
export interface OmitMatcher {
    /** True if this relative path (posix, no leading `./`) should be skipped. */
    shouldOmit(relPath: string): boolean;
    /** Patterns actually loaded (for diagnostics). */
    patterns: string[];
}
/** True when basename is SKILL.md under any casing. */
export declare function isSkillMdBasename(filePath: string): boolean;
/** True when path looks like a skill artifact skills mode may touch. */
export declare function isSkillArtifactPath(filePath: string): boolean;
/**
 * Build an omit matcher from built-ins + `.l9metaignore` + optional CLI patterns.
 * Last matching rule wins (gitignore semantics), including `!` negation.
 */
export declare function buildOmitMatcher(opts: OmitOptions): OmitMatcher;
