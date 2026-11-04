import type { ReadTrackedGitSnapshotInput, TrackedGitSnapshot } from "./discovery_contracts";
/**
 * Resolve a commit selector exactly once, then enumerate only immutable tree OIDs.
 * Missing checkout files, ignored/untracked noise, and the index are irrelevant.
 * Missing required commit/tree objects, malformed output, caps and timeouts throw;
 * none is represented as an empty complete census. Blob/gitlink targets are never
 * opened or required locally, and no network, hooks, optional locks or shell run.
 */
export declare function readTrackedGitSnapshot(input: ReadTrackedGitSnapshotInput): TrackedGitSnapshot;
/**
 * Apply-only guard, NOT the content-free census. Git may inspect tracked checkout
 * bytes to compare them to its index; external diff/textconv/fsmonitor are disabled.
 * HEAD is checked before and after the observations. Call again around index CAS:
 * this is a fail-closed concurrency check, not a filesystem lock or atomic proof.
 * Only the root index output is excluded; untracked/ignored noise is not inspected.
 */
export declare function assertTrackedWorktreeCurrent(snapshot: TrackedGitSnapshot, root: string): void;
