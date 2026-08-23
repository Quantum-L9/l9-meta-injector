// durable_write.ts — staged, synced, renamed, synced.
//
// Several places in this package write a file that a later run will read back and
// trust: a cache entry, a session manifest, an output projection. All of them
// wrote to a sibling and renamed, which is the right shape and only half the
// guarantee.
//
// A rename is atomic, so no reader ever sees a half-written file *while the
// system is running*. It says nothing about what survives the system stopping.
// `writeFileSync` returns once the bytes are in the page cache; the rename
// records a directory entry that is itself only in the page cache. A power cut
// between either of those and the flush can leave, on a real filesystem, a file
// of exactly the right length full of zeros, or a name pointing at contents that
// were never written. Both parse. Both would be read back as complete.
//
// So the full sequence is: write the staging file, fsync it, rename, fsync the
// parent directory. Each step covers a failure the previous one does not.
//
// The directory sync is best-effort by design. Windows will not open a directory
// as a file and some filesystems refuse the sync; both are tolerated rather than
// thrown, because the alternative is a package that cannot write on those
// platforms in exchange for a durability improvement they cannot offer anyway.
// Nothing about the in-system atomicity depends on it.
import * as fs from "node:fs";
import * as path from "node:path";

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
export const nodeFileOps: DurableFileOps = {
  openSync: (target, flags, mode) =>
    (mode === undefined ? fs.openSync(target, flags) : fs.openSync(target, flags, mode)),
  writeSync: (handle, contents) => {
    fs.writeFileSync(handle, contents, "utf8");
  },
  fsyncSync: (handle) => fs.fsyncSync(handle),
  closeSync: (handle) => fs.closeSync(handle),
  renameSync: (from, to) => fs.renameSync(from, to),
};

/**
 * Write bytes and make sure they reached the device before returning.
 *
 * `between` runs while the descriptor is still open, so a caller applying
 * permissions is applying them to the file that is about to be synced rather
 * than to whatever the path names by then.
 */
export function writeFileDurably(
  target: string,
  contents: string,
  options: { mode?: number; between?: () => void; ops?: DurableFileOps } = {},
): void {
  const ops = options.ops ?? nodeFileOps;
  const handle = ops.openSync(target, "w", options.mode);
  try {
    ops.writeSync(handle, contents);
    options.between?.();
    ops.fsyncSync(handle);
  } finally {
    ops.closeSync(handle);
  }
}

/**
 * Flush a directory's own contents, so a rename into it is on the device.
 *
 * Failure is swallowed: see the file header. A caller that needs to know
 * whether the flush happened is asking a question this function deliberately
 * does not answer, because the answer differs per filesystem and no correctness
 * property here depends on it.
 */
export function syncDirectory(directory: string, ops: DurableFileOps = nodeFileOps): void {
  let handle: number | null = null;
  try {
    handle = ops.openSync(directory, "r");
    ops.fsyncSync(handle);
  } catch {
    // Not supported here. In-system atomicity is unaffected.
  } finally {
    if (handle !== null) {
      try {
        ops.closeSync(handle);
      } catch {
        // Nothing useful remains to do with a descriptor that will not close.
      }
    }
  }
}

/**
 * The whole sequence: stage, sync, rename, sync the parent.
 *
 * `staging` must be a sibling of `target`, because a rename across filesystems
 * is a copy and is not atomic. Callers pick the name — the cache disambiguates
 * concurrent writers with a pid and a counter — so this function does not invent
 * one and quietly collide with theirs.
 */
export function commitFileDurably(input: {
  staging: string;
  target: string;
  contents: string;
  mode?: number;
  between?: () => void;
  ops?: DurableFileOps;
}): void {
  const ops = input.ops ?? nodeFileOps;
  const directory = path.dirname(input.target);
  writeFileDurably(input.staging, input.contents, {
    ops,
    ...(input.mode !== undefined ? { mode: input.mode } : {}),
    ...(input.between !== undefined ? { between: input.between } : {}),
  });
  ops.renameSync(input.staging, input.target);
  syncDirectory(directory, ops);
}
