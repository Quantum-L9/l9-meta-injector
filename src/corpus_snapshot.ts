// corpus_snapshot.ts — what the corpus was, written down so the next run can tell.
//
// A snapshot is the minimum a later run needs in order to say "these bytes did not
// move": every artifact's corpus identity, its content hash, and the roots those
// identities were computed under. It carries no absolute path, no timestamp and no
// analysis, because none of those are needed to answer that question and each of
// them would make two equal corpora look unequal.
//
// The one thing here that is not identity is `stat_precheck`. It is the size and
// mtime a file had, recorded so the next run can say in advance which files it
// expects to be unchanged and then check itself against the hashes. It decides
// nothing. A run that reads a snapshot still hashes every byte it observes.
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";
import { CorpusRootIdentity } from "./corpus_roots";

export const CORPUS_SNAPSHOT_SCHEMA = "l9.corpus-snapshot/v1";

export interface CorpusSnapshotArtifact {
  virtual_source_id: string;
  corpus_path: string;
  root_id: string;
  root_relative_path: string;
  content_hash: string | null;
  size_bytes: number | null;
  is_archive_member: boolean;
  artifact_type: string;
  /**
   * Size and mtime as this run saw them. Never an identity, and never content
   * truth: it is what `--incremental` revalidates against on the next run.
   */
  stat_precheck?: { size_bytes: number; mtime_ms: number; mtime_ns?: string };
}

export interface CorpusSnapshotArchive {
  archive_id: string;
  corpus_path: string;
  root_id: string;
  content_hash: string;
  size_bytes: number;
  member_count: number;
  expanded: boolean;
}

/** How a root observed. `observed` is the only status a complete corpus allows. */
export const CORPUS_OBSERVATION_STATUSES = ["observed", "failed", "missing"] as const;
export type CorpusObservationStatus = (typeof CORPUS_OBSERVATION_STATUSES)[number];

/**
 * How this run established the hashes it reports.
 *
 * `fully_verified` means every byte was read on this run. `cached_unchanged_assumption`
 * means at least one hash was carried over from a previous run because size and
 * mtime had not moved — a revalidation signal, not content truth. The two are
 * separate words because collapsing them would let a stat-assisted scan be read
 * as a byte-verified one, which is the one claim this whole layer exists to keep
 * honest.
 */
export const VERIFICATION_CLASSES = ["fully_verified", "cached_unchanged_assumption"] as const;
export type VerificationClass = (typeof VERIFICATION_CLASSES)[number];

/** What the operator asked for, as distinct from what was achieved. */
export const VERIFICATION_MODES = ["full", "incremental"] as const;
export type VerificationMode = (typeof VERIFICATION_MODES)[number];

export interface CorpusVerification {
  mode: VerificationMode;
  /** True when `--verify-content` forced a full read regardless of mode. */
  verify_content_requested: boolean;
  verification_class: VerificationClass;
  fully_rehashed_artifact_count: number;
  cached_hash_reuse_count: number;
  unhashed_artifact_count: number;
  statement: string;
}

export const FULLY_VERIFIED_STATEMENT =
  "Every regular file under every root was read in full on this run, so each content hash "
  + "describes bytes this run observed.";

export const CACHED_ASSUMPTION_STATEMENT =
  "Some content hashes were carried over from a previous run because the file's size and "
  + "mtime had not moved. Filesystem metadata is a revalidation signal, not content truth: "
  + "this run did not read those bytes, and this snapshot is not byte-verified. Run with "
  + "--verify-content to establish one that is.";

/** How a corpus as a whole observed. */
export const CORPUS_STATUSES = ["complete", "partial", "failed"] as const;
export type CorpusStatus = (typeof CORPUS_STATUSES)[number];

/**
 * A root inside a snapshot: its identity, plus its own Repository Model Packet.
 *
 * The packet id is here because it is what makes the corpus source identity
 * checkable. A corpus that recorded only the roots' content hashes would say two
 * runs saw the same bytes; recording the packet each root produced says they also
 * modelled them the same way, which is the claim a consumer actually depends on.
 */
export interface CorpusSnapshotRoot extends CorpusRootIdentity {
  /** Packet id of this root's own RMP. Empty when the root did not observe. */
  rmp_packet_id: string;
  rmp_semantic_hash: string;
  /** Output-relative location of the root's bundle. Never absolute. */
  bundle_ref: string | null;
  observation_status: CorpusObservationStatus;
  /** Why the root did not observe. Null whenever it did. */
  failure_reason: string | null;
}

/** The analysis policies a snapshot's derived layers were computed under. */
export interface CorpusAnalysisIdentity {
  corpus_analysis_id: string;
  corpus_profile: string;
  document_decoder_profiles: string[];
  interpretation_profile: string;
  semantic_candidate_profile: string;
  embedding_profile: string | null;
  readiness_profile: string;
}

export interface CorpusSnapshot {
  schema: string;
  /** Operator's name for this corpus. A label: it enters no identity. */
  corpus_id: string;
  /** Identity of what the disks held. Excludes every analysis profile. */
  corpus_source_snapshot_id: string;
  /** Identity of what was concluded from them, and under which rules. */
  analysis: CorpusAnalysisIdentity;
  corpus_status: CorpusStatus;
  /** How the hashes in this snapshot were established. */
  verification: CorpusVerification;
  /** Roots the operator asked for but that did not observe. */
  missing_root_ids: string[];
  roots: CorpusSnapshotRoot[];
  artifacts: CorpusSnapshotArtifact[];
  archives: CorpusSnapshotArchive[];
  counts: {
    root_count_requested: number;
    root_count_observed: number;
    root_count_failed: number;
    root_count: number;
    artifact_count: number;
    archive_count: number;
    archive_member_count: number;
    total_bytes: number;
  };
}

/** Order a snapshot's contents so two equal corpora render identically. */
export function orderCorpusSnapshot(snapshot: CorpusSnapshot): CorpusSnapshot {
  return {
    ...snapshot,
    missing_root_ids: [...snapshot.missing_root_ids].sort(compareCodePoints),
    analysis: {
      ...snapshot.analysis,
      document_decoder_profiles: [...snapshot.analysis.document_decoder_profiles].sort(compareCodePoints),
    },
    roots: [...snapshot.roots].sort((a, b) => compareCodePoints(a.root_id, b.root_id)),
    artifacts: [...snapshot.artifacts].sort(
      (a, b) => compareCodePoints(a.corpus_path, b.corpus_path)
        || compareCodePoints(a.virtual_source_id, b.virtual_source_id),
    ),
    archives: [...snapshot.archives].sort((a, b) => compareCodePoints(a.corpus_path, b.corpus_path)),
  };
}

/** Canonical bytes of a snapshot. */
export function renderCorpusSnapshot(snapshot: CorpusSnapshot): string {
  return `${canonicalCorpusJson(orderCorpusSnapshot(snapshot))}\n`;
}

/** Read a snapshot written by an earlier run, refusing anything else. */
export function readCorpusSnapshot(snapshotPath: string): CorpusSnapshot {
  const absolute = path.resolve(snapshotPath);
  const parsed = JSON.parse(fs.readFileSync(absolute, "utf8")) as Partial<CorpusSnapshot>;
  if (parsed.schema !== CORPUS_SNAPSHOT_SCHEMA) {
    throw new Error(
      `corpus: ${absolute} declares schema '${String(parsed.schema)}'; expected '${CORPUS_SNAPSHOT_SCHEMA}'`,
    );
  }
  if (!Array.isArray(parsed.artifacts) || !Array.isArray(parsed.archives) || !Array.isArray(parsed.roots)) {
    throw new Error(`corpus: ${absolute} is not a complete corpus snapshot`);
  }
  // A snapshot written before source identity and analysis identity were split
  // carries the same schema string and a conflated `corpus_snapshot_id`. Diffing
  // against it would compare a source identity with a profile-bound one and call
  // every unchanged corpus changed, so it is refused by shape rather than trusted
  // by version.
  if (typeof parsed.corpus_source_snapshot_id !== "string" || parsed.analysis === undefined) {
    throw new Error(
      `corpus: ${absolute} predates the split between source identity and analysis `
      + "identity and cannot be diffed against; run a full scan to write a current snapshot",
    );
  }
  return parsed as CorpusSnapshot;
}

/** The stat prechecks in a snapshot, keyed by virtual source id. */
export function snapshotPrechecks(
  snapshot: CorpusSnapshot,
): Map<string, { size_bytes: number; mtime_ms: number }> {
  const out = new Map<string, { size_bytes: number; mtime_ms: number }>();
  for (const artifact of snapshot.artifacts) {
    if (artifact.stat_precheck !== undefined) out.set(artifact.virtual_source_id, artifact.stat_precheck);
  }
  return out;
}
