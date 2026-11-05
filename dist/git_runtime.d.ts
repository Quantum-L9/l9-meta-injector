/** Resolve once from absolute PATH entries; never invoke a shell or relative git. */
export declare function gitExecutable(): string | null;
export interface GitReadLimits {
    readonly maxOutputBytes?: number;
    readonly timeoutMs?: number;
}
/** Decode without replacement or BOM stripping. */
export declare function strictGitUtf8(bytes: Uint8Array): string;
/**
 * A single observation has one cumulative output budget and deadline. This runner
 * reads Git metadata only. Callers choose a narrow command vocabulary, not a shell.
 */
export declare function readOnlyGitRunner(root: string, limits?: GitReadLimits): (args: readonly string[]) => Buffer;
