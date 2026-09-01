// archive_execution.ts — one shared admission context for every archive path.
//
// Both archive paths in this package — the read-only observation path
// (`local_source.ts`) and the legacy mutating local-files materialization path
// (`archives.ts`) — used to resolve the archive policy and the session budget
// independently, and the materialization path preflighted every archive at depth
// 0 even when it was a nested member. Two independent resolutions is exactly the
// divergence this module exists to remove: every archive is judged against one
// policy, one budget, and the archive's real depth.
//
// `resolveArchiveExecution` is the single resolution point both paths share.
// `ArchiveExecutionContext` wraps it for the materialization path with the
// archive's own facts: the central directory is read once, preflighted once at
// the real depth, and the verdict is carried with the resolved policy and
// budget. The context never writes; materialization happens in `archives.ts`
// against the candidate the context describes.
import * as fs from "node:fs";
import { ArchivePreflightResult, PreflightMember, preflightArchive } from "./archive_preflight";
import {
  ArchiveSessionBudget,
  LocalArchivePolicy,
  resolveLocalArchivePolicy,
} from "./local_archive_policy";
import { ZipDirectory, readZipCentralDirectory } from "./zip_reader";

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
export function resolveArchiveExecution(
  overrides?: Partial<LocalArchivePolicy>,
  nowMs?: () => number,
): ArchiveExecutionResolution {
  const policy = resolveLocalArchivePolicy(overrides);
  const now = nowMs ?? (() => Date.now());
  return { policy, budget: new ArchiveSessionBudget(policy, now(), now) };
}

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
export class ArchiveExecutionContext {
  readonly zipPath: string;
  readonly extractDir: string;
  readonly depth: number;
  readonly policy: LocalArchivePolicy;
  readonly budget: ArchiveSessionBudget;
  readonly archiveCompressedBytes: number;
  readonly centralDirectory: ZipDirectory;
  readonly preflight: ArchivePreflightResult;
  private readonly nowMs: () => number;

  constructor(input: ArchiveExecutionContextInput) {
    this.zipPath = input.zipPath;
    this.extractDir = input.extractDir;
    this.depth = input.depth;
    this.nowMs = input.nowMs ?? (() => Date.now());
    const resolution = resolveArchiveExecution(input.policy, this.nowMs);
    this.policy = resolution.policy;
    this.budget = resolution.budget;
    this.archiveCompressedBytes = fs.statSync(this.zipPath).size;
    this.centralDirectory = readZipCentralDirectory(this.zipPath);
    this.preflight = preflightArchive({
      directory: this.centralDirectory,
      policy: this.policy,
      depth: this.depth,
      archiveCompressedBytes: this.archiveCompressedBytes,
    });
  }

  /** File members eligible for materialization, narrowed to `allowedMembers`. */
  planMembers(allowedMembers?: string[]): PreflightMember[] {
    return allowedMembers
      ? this.preflight.members.filter((member) => allowedMembers.includes(member.canonicalPath))
      : this.preflight.members;
  }

  /** The single refusal sentence every path reports, or null when accepted. */
  holdReasons(): string | null {
    if (this.preflight.accepted) return null;
    return this.preflight.holds
      .map((hold) => (hold.memberPath ? `${hold.code} (${hold.memberPath})` : hold.code))
      .join(", ");
  }
}
