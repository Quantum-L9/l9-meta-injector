import { ArchivePreflightResult, PreflightMember } from "./archive_preflight";
import { ArchiveSessionBudget, LocalArchivePolicy } from "./local_archive_policy";
import { ZipDirectory } from "./zip_reader";
/** Policy and budget, resolved once, shared by every archive path. */
export interface ArchiveExecutionResolution {
    policy: LocalArchivePolicy;
    budget: ArchiveSessionBudget;
}
/**
 * The single resolution point for archive policy and session budget.
 *
 * Both the observation path and the materialization path call this, so a caller
 * override, a default change, or a budget rule can never be applied by one path
 * and missed by the other.
 */
export declare function resolveArchiveExecution(overrides?: Partial<LocalArchivePolicy>, nowMs?: () => number): ArchiveExecutionResolution;
export interface ArchiveExecutionContextInput {
    zipPath: string;
    extractDir: string;
    /** Real nesting depth of this archive; the outermost archive is 0. */
    depth: number;
    policy?: Partial<LocalArchivePolicy>;
    nowMs?: () => number;
}
/**
 * Admission facts for one archive about to be materialized.
 *
 * Reading the central directory and running preflight are both construction
 * concerns: a context that exists is a context whose archive has been read and
 * judged at the depth its caller actually occupies in the tree, never a
 * hard-coded 0.
 */
export declare class ArchiveExecutionContext {
    readonly zipPath: string;
    readonly extractDir: string;
    readonly depth: number;
    readonly policy: LocalArchivePolicy;
    readonly budget: ArchiveSessionBudget;
    readonly archiveCompressedBytes: number;
    readonly centralDirectory: ZipDirectory;
    readonly preflight: ArchivePreflightResult;
    private readonly nowMs;
    constructor(input: ArchiveExecutionContextInput);
    /** File members eligible for materialization, narrowed to `allowedMembers`. */
    planMembers(allowedMembers?: string[]): PreflightMember[];
    /** The single refusal sentence every path reports, or null when accepted. */
    holdReasons(): string | null;
}
