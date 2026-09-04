/**
 * The four syscalls this module needs, as one substitutable surface.
 *
 * A seam rather than a spy, because the property being asserted is an *ordering*
 * — bytes synced, then renamed, then the parent synced — and an ordering is not
 * observable from the filesystem afterwards. Any of the three orderings leaves
 * the same bytes at the same path; only the one here survives a power cut at
 * every point, and only a recorded call sequence can show which one ran.
 *
 * `node:fs` is an ES module namespace and cannot be spied on, so the alternative
 * to this is not "spy instead" but "assert nothing".
 */
export interface DurableFileOps {
    openSync(target: string, flags: string, mode?: number): number;
    writeSync(handle: number, contents: string): void;
    fsyncSync(handle: number): void;
    closeSync(handle: number): void;
    renameSync(from: string, to: string): void;
}
/** The real thing, which every caller outside a test uses. */
export declare const nodeFileOps: DurableFileOps;
/**
 * Write bytes and make sure they reached the device before returning.
 *
 * `between` runs while the descriptor is still open, so a caller applying
 * permissions is applying them to the file that is about to be synced rather
 * than to whatever the path names by then.
 */
export declare function writeFileDurably(target: string, contents: string, options?: {
    mode?: number;
    between?: () => void;
    ops?: DurableFileOps;
}): void;
/**
 * Flush a directory's own contents, so a rename into it is on the device.
 *
 * Failure is swallowed: see the file header. A caller that needs to know
 * whether the flush happened is asking a question this function deliberately
 * does not answer, because the answer differs per filesystem and no correctness
 * property here depends on it.
 */
export declare function syncDirectory(directory: string, ops?: DurableFileOps): void;
/**
 * The whole sequence: stage, sync, rename, sync the parent.
 *
 * `staging` must be a sibling of `target`, because a rename across filesystems
 * is a copy and is not atomic. Callers pick the name — the cache disambiguates
 * concurrent writers with a pid and a counter — so this function does not invent
 * one and quietly collide with theirs.
 */
export declare function commitFileDurably(input: {
    staging: string;
    target: string;
    contents: string;
    mode?: number;
    between?: () => void;
    ops?: DurableFileOps;
}): void;
export declare function replaceFileAtomically(target: string, contents: string | Buffer, options?: {
    mode?: number;
    ops?: DurableFileOps;
}): void;
