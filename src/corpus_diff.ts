// corpus_diff.ts — what changed between two observations of one corpus.
//
// The diff exists so a second run can be cheap without being a guess. Its two
// jobs are to classify every artifact against the previous snapshot, and to say
// exactly which cached work that classification invalidates.
//
// The classification is decided by content hashes and corpus identities, never by
// a clock. A file whose bytes are unchanged is `unchanged` even if every
// timestamp on it moved; a file whose bytes changed is `changed_content` even if
// nothing else did.
//
// `renamed_candidate` is the one category that is a candidate, and its rule is
// narrow on purpose: the same exact content hash, absent at an old corpus path,
// present at a new one. That is a deterministic observation about two paths and
// one hash. It is not a claim that a person moved the file, that the move was
// intentional, or that the two paths mean the same thing — a copy deleted here
// and an unrelated copy created there is indistinguishable from a move, and this
// layer does not pretend otherwise.
//
// Nothing here removes a cache entry. An artifact that left the corpus may be
// back on the next disk the operator plugs in, and the work already done on those
// bytes is still correct.
import { canonicalCorpusJson } from "./corpus_analysis";
import { CorpusSnapshot, CorpusSnapshotArchive, CorpusSnapshotArtifact } from "./corpus_snapshot";
import { compareCodePoints } from "./ordering";

export const CORPUS_DIFF_SCHEMA = "l9.corpus-diff/v1";

export const CORPUS_DIFF_CATEGORIES = [
  "added",
  "removed",
  "changed_content",
  "renamed_candidate",
  "unchanged",
  "archive_added",
  "archive_removed",
  "archive_changed",
] as const;

export type CorpusDiffCategory = (typeof CORPUS_DIFF_CATEGORIES)[number];

/** Per-document cache layers keyed on a content hash. */
export const CONTENT_KEYED_LAYERS: readonly string[] = [
  "normalized_document",
  "interpretation",
  "lexical_features",
];

/** Cache layers keyed on the whole corpus, so any membership change retires them. */
export const CORPUS_SCOPED_LAYERS: readonly string[] = ["candidate_analysis"];

export interface CorpusDiffEntry {
  category: CorpusDiffCategory;
  virtual_source_id: string;
  corpus_path: string;
  root_id: string;
  content_hash: string | null;
  previous_content_hash?: string;
  /** Present on `renamed_candidate` only: where the same bytes used to be. */
  previous_corpus_path?: string;
  previous_virtual_source_id?: string;
  size_bytes?: number | null;
}

export interface CorpusDiffInvalidation {
  /** True when the analysis rules changed, which retires every derived layer. */
  profile_changed: boolean;
  /** Content hashes in the corpus now that were not in it before. */
  new_content_hashes: string[];
  /** Content hashes that left the corpus. Their cache entries are kept. */
  retired_content_hashes: string[];
  /** Hashes present in both snapshots: every content-keyed layer is reusable. */
  retained_content_hash_count: number;
  /** Layers that must be recomputed for each new content hash. */
  content_keyed_layers: readonly string[];
  /** Corpus-scope layers retired by this diff, empty when nothing moved. */
  corpus_scoped_layers_invalidated: readonly string[];
  /** Always zero. A departed artifact never causes a cache entry to be deleted. */
  cache_entries_removed: number;
}

export interface CorpusDiffCounts {
  added: number;
  removed: number;
  changed_content: number;
  renamed_candidate: number;
  unchanged: number;
  archive_added: number;
  archive_removed: number;
  archive_changed: number;
}

export interface CorpusDiff {
  schema: string;
  previous_corpus_snapshot_id: string;
  current_corpus_snapshot_id: string;
  previous_root_ids: string[];
  current_root_ids: string[];
  counts: CorpusDiffCounts;
  entries: CorpusDiffEntry[];
  invalidation: CorpusDiffInvalidation;
  /** Restated in the document so a consumer reading only JSON sees the limit. */
  renamed_candidate_statement: string;
}

export const RENAMED_CANDIDATE_STATEMENT =
  "A renamed candidate is one content hash absent at an old corpus path and present at a "
  + "new one. It is not evidence that a file was moved, that a move was intentional, or "
  + "that the two paths mean the same thing.";

function emptyCounts(): CorpusDiffCounts {
  return {
    added: 0,
    removed: 0,
    changed_content: 0,
    renamed_candidate: 0,
    unchanged: 0,
    archive_added: 0,
    archive_removed: 0,
    archive_changed: 0,
  };
}

function byId(artifacts: readonly CorpusSnapshotArtifact[]): Map<string, CorpusSnapshotArtifact> {
  return new Map(artifacts.map((artifact) => [artifact.virtual_source_id, artifact]));
}

function archivesByPath(
  archives: readonly CorpusSnapshotArchive[],
): Map<string, CorpusSnapshotArchive> {
  return new Map(archives.map((archive) => [archive.corpus_path, archive]));
}

function contentHashSet(artifacts: readonly CorpusSnapshotArtifact[]): Set<string> {
  const out = new Set<string>();
  for (const artifact of artifacts) if (artifact.content_hash !== null) out.add(artifact.content_hash);
  return out;
}

function compareEntries(a: CorpusDiffEntry, b: CorpusDiffEntry): number {
  return (
    compareCodePoints(a.category, b.category)
    || compareCodePoints(a.corpus_path, b.corpus_path)
    || compareCodePoints(a.virtual_source_id, b.virtual_source_id)
  );
}

/**
 * Pair departures against arrivals that carry the same bytes.
 *
 * Pairing is deterministic rather than clever: within one content hash, the
 * departed paths and the arrived paths are each sorted and zipped. A hash with
 * two departures and one arrival yields one rename candidate and one removal, and
 * which departure was chosen is a function of code-point order alone.
 */
function pairRenames(
  removed: readonly CorpusSnapshotArtifact[],
  added: readonly CorpusSnapshotArtifact[],
): {
  renames: { from: CorpusSnapshotArtifact; to: CorpusSnapshotArtifact }[];
  unpairedRemoved: CorpusSnapshotArtifact[];
  unpairedAdded: CorpusSnapshotArtifact[];
} {
  const group = (artifacts: readonly CorpusSnapshotArtifact[]): Map<string, CorpusSnapshotArtifact[]> => {
    const out = new Map<string, CorpusSnapshotArtifact[]>();
    for (const artifact of artifacts) {
      if (artifact.content_hash === null) continue;
      const bucket = out.get(artifact.content_hash);
      if (bucket === undefined) out.set(artifact.content_hash, [artifact]);
      else bucket.push(artifact);
    }
    for (const bucket of out.values()) {
      bucket.sort((a, b) => compareCodePoints(a.corpus_path, b.corpus_path));
    }
    return out;
  };

  const removedByHash = group(removed);
  const addedByHash = group(added);
  const renames: { from: CorpusSnapshotArtifact; to: CorpusSnapshotArtifact }[] = [];
  const pairedRemoved = new Set<string>();
  const pairedAdded = new Set<string>();

  for (const hash of [...removedByHash.keys()].sort(compareCodePoints)) {
    const departures = removedByHash.get(hash) as CorpusSnapshotArtifact[];
    const arrivals = addedByHash.get(hash) ?? [];
    const pairs = Math.min(departures.length, arrivals.length);
    for (let index = 0; index < pairs; index++) {
      renames.push({ from: departures[index], to: arrivals[index] });
      pairedRemoved.add(departures[index].virtual_source_id);
      pairedAdded.add(arrivals[index].virtual_source_id);
    }
  }

  return {
    renames,
    unpairedRemoved: removed.filter((artifact) => !pairedRemoved.has(artifact.virtual_source_id)),
    unpairedAdded: added.filter((artifact) => !pairedAdded.has(artifact.virtual_source_id)),
  };
}

/** Classify a current snapshot against a previous one. */
export function buildCorpusDiff(previous: CorpusSnapshot, current: CorpusSnapshot): CorpusDiff {
  const previousById = byId(previous.artifacts);
  const currentById = byId(current.artifacts);
  const entries: CorpusDiffEntry[] = [];
  const counts = emptyCounts();

  const departed: CorpusSnapshotArtifact[] = [];
  const arrived: CorpusSnapshotArtifact[] = [];

  for (const artifact of current.artifacts) {
    const before = previousById.get(artifact.virtual_source_id);
    if (before === undefined) {
      arrived.push(artifact);
      continue;
    }
    if (before.content_hash === artifact.content_hash) {
      counts.unchanged += 1;
      entries.push({
        category: "unchanged",
        virtual_source_id: artifact.virtual_source_id,
        corpus_path: artifact.corpus_path,
        root_id: artifact.root_id,
        content_hash: artifact.content_hash,
        size_bytes: artifact.size_bytes,
      });
      continue;
    }
    counts.changed_content += 1;
    entries.push({
      category: "changed_content",
      virtual_source_id: artifact.virtual_source_id,
      corpus_path: artifact.corpus_path,
      root_id: artifact.root_id,
      content_hash: artifact.content_hash,
      ...(before.content_hash !== null ? { previous_content_hash: before.content_hash } : {}),
      size_bytes: artifact.size_bytes,
    });
  }

  for (const artifact of previous.artifacts) {
    if (!currentById.has(artifact.virtual_source_id)) departed.push(artifact);
  }

  const { renames, unpairedRemoved, unpairedAdded } = pairRenames(departed, arrived);
  for (const rename of renames) {
    counts.renamed_candidate += 1;
    entries.push({
      category: "renamed_candidate",
      virtual_source_id: rename.to.virtual_source_id,
      corpus_path: rename.to.corpus_path,
      root_id: rename.to.root_id,
      content_hash: rename.to.content_hash,
      previous_corpus_path: rename.from.corpus_path,
      previous_virtual_source_id: rename.from.virtual_source_id,
      ...(rename.from.content_hash !== null ? { previous_content_hash: rename.from.content_hash } : {}),
      size_bytes: rename.to.size_bytes,
    });
  }
  for (const artifact of unpairedAdded) {
    counts.added += 1;
    entries.push({
      category: "added",
      virtual_source_id: artifact.virtual_source_id,
      corpus_path: artifact.corpus_path,
      root_id: artifact.root_id,
      content_hash: artifact.content_hash,
      size_bytes: artifact.size_bytes,
    });
  }
  for (const artifact of unpairedRemoved) {
    counts.removed += 1;
    entries.push({
      category: "removed",
      virtual_source_id: artifact.virtual_source_id,
      corpus_path: artifact.corpus_path,
      root_id: artifact.root_id,
      content_hash: artifact.content_hash,
      size_bytes: artifact.size_bytes,
    });
  }

  const previousArchives = archivesByPath(previous.archives);
  const currentArchives = archivesByPath(current.archives);
  for (const [corpusPath, archive] of [...currentArchives].sort(([a], [b]) => compareCodePoints(a, b))) {
    const before = previousArchives.get(corpusPath);
    if (before === undefined) {
      counts.archive_added += 1;
      entries.push({
        category: "archive_added",
        virtual_source_id: archive.archive_id,
        corpus_path: archive.corpus_path,
        root_id: archive.root_id,
        content_hash: archive.content_hash,
        size_bytes: archive.size_bytes,
      });
      continue;
    }
    if (before.content_hash !== archive.content_hash) {
      counts.archive_changed += 1;
      entries.push({
        category: "archive_changed",
        virtual_source_id: archive.archive_id,
        corpus_path: archive.corpus_path,
        root_id: archive.root_id,
        content_hash: archive.content_hash,
        previous_content_hash: before.content_hash,
        size_bytes: archive.size_bytes,
      });
    }
  }
  for (const [corpusPath, archive] of [...previousArchives].sort(([a], [b]) => compareCodePoints(a, b))) {
    if (currentArchives.has(corpusPath)) continue;
    counts.archive_removed += 1;
    entries.push({
      category: "archive_removed",
      virtual_source_id: archive.archive_id,
      corpus_path: archive.corpus_path,
      root_id: archive.root_id,
      content_hash: archive.content_hash,
      size_bytes: archive.size_bytes,
    });
  }

  const previousHashes = contentHashSet(previous.artifacts);
  const currentHashes = contentHashSet(current.artifacts);
  const newHashes = [...currentHashes].filter((hash) => !previousHashes.has(hash)).sort(compareCodePoints);
  const retiredHashes = [...previousHashes].filter((hash) => !currentHashes.has(hash)).sort(compareCodePoints);
  const retained = [...currentHashes].filter((hash) => previousHashes.has(hash)).length;
  const profileChanged = previous.corpus_profile_hash !== current.corpus_profile_hash;
  const membershipChanged = newHashes.length > 0
    || retiredHashes.length > 0
    || previous.artifacts.length !== current.artifacts.length;

  return {
    schema: CORPUS_DIFF_SCHEMA,
    previous_corpus_snapshot_id: previous.corpus_snapshot_id,
    current_corpus_snapshot_id: current.corpus_snapshot_id,
    previous_root_ids: previous.roots.map((root) => root.root_id).sort(compareCodePoints),
    current_root_ids: current.roots.map((root) => root.root_id).sort(compareCodePoints),
    counts,
    entries: entries.sort(compareEntries),
    invalidation: {
      profile_changed: profileChanged,
      new_content_hashes: newHashes,
      retired_content_hashes: retiredHashes,
      retained_content_hash_count: retained,
      content_keyed_layers: CONTENT_KEYED_LAYERS,
      corpus_scoped_layers_invalidated:
        profileChanged || membershipChanged ? CORPUS_SCOPED_LAYERS : [],
      cache_entries_removed: 0,
    },
    renamed_candidate_statement: RENAMED_CANDIDATE_STATEMENT,
  };
}

/** Canonical bytes of a diff. */
export function renderCorpusDiff(diff: CorpusDiff): string {
  return `${canonicalCorpusJson(diff)}\n`;
}
