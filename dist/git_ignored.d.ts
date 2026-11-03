/** Untracked, ignored paths relative to the observed root, as git reports them. */
export interface GitIgnoredPaths {
    /** Ignored untracked files. */
    readonly files: ReadonlySet<string>;
    /** Ignored untracked directories (git collapses them), without a trailing slash. */
    readonly directories: readonly string[];
}
/**
 * The untracked, ignored paths under `root`, or `undefined` when `root` is not inside a
 * git work tree or no git executable is available (a non-git target has no ignore
 * semantics to honour). Inside a work tree a failing listing throws: guessing would
 * make the packet depend on the machine.
 */
export declare function listGitIgnoredUntracked(root: string): GitIgnoredPaths | undefined;
/** True when `relPath` is, or lies under, a path git reports as ignored and untracked. */
export declare function isGitIgnored(ignored: GitIgnoredPaths, relPath: string): boolean;
