// archive_execution.ts — one shared admission context for every archive path.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ArchivePreflightResult, PreflightMember, preflightArchive } from "./archive_preflight";
import {
  ArchiveSessionBudget,
  LocalArchivePolicy,
  localArchivePolicyFingerprint,
  resolveLocalArchivePolicy,
} from "./local_archive_policy";
import { ZipDirectory, readZipCentralDirectory } from "./zip_reader";

/** Version of the canonical ZIP reader whose verdict this context carries. */
export const ARCHIVE_READER_VERSION = "1.0.0";
const STAGE_CHUNK_BYTES = 64 * 1024;

/**
 * Expected refusal caused by archive/resource policy, not a host/tool failure.
 * The local-files orchestrator converts only this class (plus canonical ZIP
 * format/budget errors) into ArchiveRecord.heldReason; filesystem and invariant
 * failures continue to throw so they cannot masquerade as hostile input.
 */
export class ArchiveExecutionHeldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArchiveExecutionHeldError";
  }
}

/** Policy and acquisition-wide budget, resolved once per run. */
export interface ArchiveExecutionResolution {
  policy: LocalArchivePolicy;
  budget: ArchiveSessionBudget;
}

/** Single resolution point shared by observation and materialization paths. */
export function resolveArchiveExecution(
  overrides?: Partial<LocalArchivePolicy>,
  nowMs?: () => number,
): ArchiveExecutionResolution {
  const policy = resolveLocalArchivePolicy(overrides);
  const now = nowMs ?? (() => Date.now());
  return { policy, budget: new ArchiveSessionBudget(policy, now(), now) };
}

export interface ArchiveExecutionContextInput {
  /** Live source path. It is copied once and never read again by admission/extraction. */
  zipPath: string;
  extractDir: string;
  /** Real nesting depth of this archive; the outermost archive is 0. */
  depth: number;
  /** Run-scoped resolution. Every archive in one acquisition must share this object. */
  resolution?: ArchiveExecutionResolution;
  /** Convenience for standalone callers that are not already inside an acquisition. */
  policy?: Partial<LocalArchivePolicy>;
  nowMs?: () => number;
  /** Tool-owned scratch parent. Defaults outside the source tree. */
  stagingParent?: string;
}

/**
 * Admission facts for one archive.
 *
 * Construction stages and hashes the source in one streaming pass, then all ZIP
 * parsing, preflight and materialization read only the staged path. This closes
 * the live-path TOCTOU window: the verdict and the bytes written always describe
 * the same immutable snapshot.
 */
export class ArchiveExecutionContext {
  readonly zipPath: string;
  readonly extractDir: string;
  readonly depth: number;
  readonly policy: LocalArchivePolicy;
  readonly budget: ArchiveSessionBudget;
  readonly archiveCompressedBytes: number;
  readonly archiveSha256: string;
  readonly readerVersion = ARCHIVE_READER_VERSION;
  readonly policyFingerprint: string;
  readonly stagedZipPath: string;
  readonly centralDirectory: ZipDirectory;
  readonly preflight: ArchivePreflightResult;
  private readonly stagingRoot: string;
  private disposed = false;

  constructor(input: ArchiveExecutionContextInput) {
    if (input.resolution !== undefined && input.policy !== undefined) {
      throw new Error("archive execution accepts either a shared resolution or policy overrides, not both");
    }
    this.zipPath = input.zipPath;
    this.extractDir = input.extractDir;
    this.depth = input.depth;
    const resolution = input.resolution ?? resolveArchiveExecution(input.policy, input.nowMs);
    this.policy = resolution.policy;
    this.budget = resolution.budget;
    this.policyFingerprint = localArchivePolicyFingerprint(this.policy);

    const stagingParent = input.stagingParent ?? os.tmpdir();
    this.stagingRoot = fs.mkdtempSync(path.join(stagingParent, "l9-meta-injector-archive-"));
    this.stagedZipPath = path.join(this.stagingRoot, "snapshot.zip");

    const hash = crypto.createHash("sha256");
    let sizeBytes = 0;
    let source: number | null = null;
    let target: number | null = null;
    try {
      source = fs.openSync(this.zipPath, "r");
      target = fs.openSync(this.stagedZipPath, "wx");
      const buffer = Buffer.alloc(STAGE_CHUNK_BYTES);
      for (;;) {
        const deadline = this.budget.processingRefusalReason();
        if (deadline !== null) throw new ArchiveExecutionHeldError(deadline);
        const count = fs.readSync(source, buffer, 0, buffer.length, null);
        if (count === 0) break;
        if (sizeBytes + count > this.policy.maxArchiveCompressedBytes) {
          throw new ArchiveExecutionHeldError(
            `archive exceeds the ${this.policy.maxArchiveCompressedBytes}-byte staging limit`,
          );
        }
        const chunk = buffer.subarray(0, count);
        hash.update(chunk);
        let written = 0;
        while (written < chunk.length) {
          written += fs.writeSync(target, chunk, written, chunk.length - written);
        }
        sizeBytes += count;
      }
    } catch (error) {
      if (source !== null) try { fs.closeSync(source); } catch {}
      if (target !== null) try { fs.closeSync(target); } catch {}
      fs.rmSync(this.stagingRoot, { recursive: true, force: true });
      throw error;
    }
    if (source !== null) fs.closeSync(source);
    if (target !== null) fs.closeSync(target);

    this.archiveCompressedBytes = sizeBytes;
    this.archiveSha256 = `sha256:${hash.digest("hex")}`;
    try {
      this.centralDirectory = readZipCentralDirectory(this.stagedZipPath);
      this.preflight = preflightArchive({
        directory: this.centralDirectory,
        policy: this.policy,
        depth: this.depth,
        archiveCompressedBytes: this.archiveCompressedBytes,
      });
    } catch (error) {
      this.dispose();
      throw error;
    }
  }

  /** File members eligible for materialization, narrowed in O(n) time. */
  planMembers(allowedMembers?: string[]): PreflightMember[] {
    if (allowedMembers === undefined) return this.preflight.members;
    const allowed = new Set(allowedMembers);
    return this.preflight.members.filter((member) => allowed.has(member.canonicalPath));
  }

  /** Run-scoped refusal after archive-local preflight has accepted. */
  sessionRefusalReason(): string | null {
    return this.budget.refuseReason(this.preflight.declaredUncompressedBytes);
  }

  /** Fail closed when wall-clock time expires during staging/member streaming. */
  assertProcessingWithinBudget(): void {
    const refusal = this.budget.processingRefusalReason();
    if (refusal !== null) throw new ArchiveExecutionHeldError(refusal);
  }

  /** Consume acquisition-wide accounting only after a verified archive succeeds. */
  recordSuccess(expandedBytes: number): void {
    this.budget.recordArchive(expandedBytes);
  }

  /** The single archive-local refusal sentence every path reports, or null. */
  holdReasons(): string | null {
    if (this.preflight.accepted) return null;
    return this.preflight.holds
      .map((hold) => (hold.memberPath ? `${hold.code} (${hold.memberPath})` : hold.code))
      .join(", ");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    fs.rmSync(this.stagingRoot, { recursive: true, force: true });
  }
}
