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
  /** Size and mtime, for the next run's scheduling hint. Never an identity. */
  stat_precheck?: { size_bytes: number; mtime_ms: number };
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

export interface CorpusSnapshot {
  schema: string;
  corpus_snapshot_id: string;
  corpus_profile_hash: string;
  roots: CorpusRootIdentity[];
  artifacts: CorpusSnapshotArtifact[];
  archives: CorpusSnapshotArchive[];
  counts: {
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
