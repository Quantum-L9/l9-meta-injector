// corpus_diff.test.ts — classification between two snapshots, and what it invalidates.
//
// The diff is built from two snapshot documents rather than from two scans, so
// every category can be exercised against exactly the shape it is meant to
// handle — including the ones a filesystem makes awkward to arrange, like a
// content hash with two departures and one arrival.
import { describe, expect, it } from "vitest";
import {
  CONTENT_KEYED_LAYERS,
  CORPUS_ANALYSIS_DIFF_CATEGORIES,
  CROSS_ROOT_MOVE_STATEMENT,
  CORPUS_DIFF_CATEGORIES,
  CORPUS_ROOT_DIFF_CATEGORIES,
  CORPUS_SCOPED_LAYERS,
  RENAMED_CANDIDATE_STATEMENT,
  buildCorpusDiff,
} from "../src/corpus_diff";
import {
  CORPUS_SNAPSHOT_SCHEMA,
  CorpusSnapshot,
  CorpusSnapshotArchive,
  CorpusSnapshotArtifact,
  renderCorpusSnapshot,
} from "../src/corpus_snapshot";

function artifact(
  corpusPath: string,
  contentHash: string | null,
  overrides: Partial<CorpusSnapshotArtifact> = {},
): CorpusSnapshotArtifact {
  const [, relative] = corpusPath.split("::");
  return {
    virtual_source_id: `vsrc:${corpusPath}`,
    corpus_path: corpusPath,
    root_id: "root:a",
    root_relative_path: relative,
    content_hash: contentHash,
    size_bytes: 10,
    is_archive_member: false,
    artifact_type: "documentation",
    ...overrides,
  };
}

function archive(corpusPath: string, contentHash: string): CorpusSnapshotArchive {
  return {
    archive_id: `vsrc:${corpusPath}`,
    corpus_path: corpusPath,
    root_id: "root:a",
    content_hash: contentHash,
    size_bytes: 100,
    member_count: 2,
    expanded: true,
  };
}

function snapshot(
  id: string,
  artifacts: CorpusSnapshotArtifact[],
  archives: CorpusSnapshotArchive[] = [],
  profileHash = "profile:one",
): CorpusSnapshot {
  return {
    schema: CORPUS_SNAPSHOT_SCHEMA,
    corpus_id: "test-corpus",
    corpus_source_snapshot_id: id,
    analysis: {
      corpus_analysis_id: `corpus-analysis:${id}:${profileHash}`,
      corpus_profile: profileHash,
      document_decoder_profiles: ["utf8-text-decoder@1.0.0"],
      interpretation_profile: "interp:one",
      semantic_candidate_profile: "cand:one",
      embedding_profile: null,
      readiness_profile: "ready:one",
    },
    corpus_status: "complete",
    missing_root_ids: [],
    roots: [
      {
        root_id: "root:a",
        root_key: "A",
        root_label: "A",
        root_snapshot_id: `root-snapshot:${id}`,
        source_kind: "directory",
        source_revision: `fs:${id}`,
        physical_snapshot_hash: `sha256:${id}`,
        rmp_packet_id: `packet:${id}`,
        rmp_semantic_hash: `sha256:${id}`,
        bundle_ref: "roots/A/bundle",
        observation_status: "observed",
        failure_reason: null,
      },
    ],
    artifacts,
    archives,
    counts: {
      root_count_requested: 1,
      root_count_observed: 1,
      root_count_failed: 0,
      root_count: 1,
      artifact_count: artifacts.length,
      archive_count: archives.length,
      archive_member_count: 0,
      total_bytes: artifacts.length * 10,
    },
  };
}

describe("categories", () => {
  it("cover exactly the vocabulary the schema declares", () => {
    expect([...CORPUS_DIFF_CATEGORIES]).toEqual([
      "added",
      "removed",
      "changed_content",
      "renamed_candidate",
      "unchanged",
      "archive_added",
      "archive_removed",
      "archive_changed",
      "archive_unchanged",
    ]);
    expect([...CORPUS_ROOT_DIFF_CATEGORIES]).toEqual([
      "root_added",
      "root_removed",
      "root_changed",
      "root_unchanged",
    ]);
    expect([...CORPUS_ANALYSIS_DIFF_CATEGORIES]).toEqual([
      "candidate_added",
      "candidate_removed",
      "candidate_changed",
      "readiness_evidence_changed",
    ]);
  });

  it("classify an unchanged file, a rewritten file, an arrival and a departure", () => {
    const previous = snapshot("one", [
      artifact("A::keep.md", "sha256:keep"),
      artifact("A::edit.md", "sha256:before"),
      artifact("A::gone.md", "sha256:gone"),
    ]);
    const current = snapshot("two", [
      artifact("A::keep.md", "sha256:keep"),
      artifact("A::edit.md", "sha256:after"),
      artifact("A::new.md", "sha256:new"),
    ]);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.counts).toEqual({
      added: 1,
      removed: 1,
      changed_content: 1,
      renamed_candidate: 0,
      unchanged: 1,
      archive_added: 0,
      archive_removed: 0,
      archive_changed: 0,
      archive_unchanged: 0,
      root_added: 0,
      root_removed: 0,
      root_changed: 1,
      root_unchanged: 0,
    });
    const changed = diff.entries.find((entry) => entry.category === "changed_content");
    expect(changed?.previous_content_hash).toBe("sha256:before");
    expect(changed?.content_hash).toBe("sha256:after");
    expect(diff.schema).toBe("l9.corpus-diff/v1");
    expect(diff.renamed_candidate_statement).toBe(RENAMED_CANDIDATE_STATEMENT);
  });

  it("pair one departure with one arrival of the same bytes as a rename candidate", () => {
    const previous = snapshot("one", [artifact("A::old/path.md", "sha256:same")]);
    const current = snapshot("two", [artifact("A::new/path.md", "sha256:same")]);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.counts.renamed_candidate).toBe(1);
    expect(diff.counts.added).toBe(0);
    expect(diff.counts.removed).toBe(0);
    const [rename] = diff.entries;
    expect(rename.previous_corpus_path).toBe("A::old/path.md");
    expect(rename.previous_virtual_source_id).toBe("vsrc:A::old/path.md");
    expect(rename.corpus_path).toBe("A::new/path.md");
    // Same bytes, so nothing content-keyed has to be recomputed.
    expect(diff.invalidation.new_content_hashes).toEqual([]);
  });

  it("leave the surplus side of an uneven rename group as an ordinary departure", () => {
    const previous = snapshot("one", [
      artifact("A::a.md", "sha256:same"),
      artifact("A::b.md", "sha256:same"),
    ]);
    const current = snapshot("two", [artifact("A::c.md", "sha256:same")]);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.counts.renamed_candidate).toBe(1);
    expect(diff.counts.removed).toBe(1);
    // The pairing is code-point ordered, so it does not depend on iteration order.
    const rename = diff.entries.find((entry) => entry.category === "renamed_candidate");
    expect(rename?.previous_corpus_path).toBe("A::a.md");
  });

  it("does not call a file that stayed put a rename, even when its twin moved", () => {
    const previous = snapshot("one", [artifact("A::stay.md", "sha256:same")]);
    const current = snapshot("two", [
      artifact("A::stay.md", "sha256:same"),
      artifact("A::copy.md", "sha256:same"),
    ]);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.counts.renamed_candidate).toBe(0);
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.unchanged).toBe(1);
  });

  it("classifies archives by their own path and hash", () => {
    const previous = snapshot("one", [], [archive("A::x.zip", "sha256:x1"), archive("A::y.zip", "sha256:y")]);
    const current = snapshot("two", [], [archive("A::x.zip", "sha256:x2"), archive("A::z.zip", "sha256:z")]);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.counts.archive_changed).toBe(1);
    expect(diff.counts.archive_added).toBe(1);
    expect(diff.counts.archive_removed).toBe(1);
    const changed = diff.entries.find((entry) => entry.category === "archive_changed");
    expect(changed?.previous_content_hash).toBe("sha256:x1");
  });
});

describe("invalidation", () => {
  it("names the new content and keeps the rest reusable", () => {
    const previous = snapshot("one", [
      artifact("A::a.md", "sha256:a"),
      artifact("A::b.md", "sha256:b"),
    ]);
    const current = snapshot("two", [
      artifact("A::a.md", "sha256:a"),
      artifact("A::b.md", "sha256:b2"),
    ]);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.invalidation.new_content_hashes).toEqual(["sha256:b2"]);
    expect(diff.invalidation.retired_content_hashes).toEqual(["sha256:b"]);
    expect(diff.invalidation.retained_content_hash_count).toBe(1);
    expect(diff.invalidation.content_keyed_layers).toEqual(CONTENT_KEYED_LAYERS);
    expect(diff.invalidation.corpus_scoped_layers_invalidated).toEqual(CORPUS_SCOPED_LAYERS);
    expect(diff.invalidation.profile_changed).toBe(false);
  });

  it("keeps every cache entry when an artifact leaves the corpus", () => {
    const previous = snapshot("one", [artifact("A::a.md", "sha256:a")]);
    const current = snapshot("two", []);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.counts.removed).toBe(1);
    expect(diff.invalidation.cache_entries_removed).toBe(0);
    expect(diff.invalidation.retired_content_hashes).toEqual(["sha256:a"]);
  });

  it("retires nothing corpus-scope when nothing moved at all", () => {
    const artifacts = [artifact("A::a.md", "sha256:a")];
    const diff = buildCorpusDiff(snapshot("one", artifacts), snapshot("one", artifacts));
    expect(diff.invalidation.corpus_scoped_layers_invalidated).toEqual([]);
  });

  it("retires everything corpus-scope when the analysis rules change", () => {
    const artifacts = [artifact("A::a.md", "sha256:a")];
    const diff = buildCorpusDiff(
      snapshot("one", artifacts, [], "profile:one"),
      snapshot("one", artifacts, [], "profile:two"),
    );
    expect(diff.invalidation.profile_changed).toBe(true);
    expect(diff.invalidation.corpus_scoped_layers_invalidated).toEqual(CORPUS_SCOPED_LAYERS);
  });
});

describe("the snapshot document", () => {
  it("renders deterministically, in code-point order, with no wall clock", () => {
    const unordered = snapshot("one", [
      artifact("A::z.md", "sha256:z"),
      artifact("A::a.md", "sha256:a"),
    ]);
    const rendered = renderCorpusSnapshot(unordered);
    expect(rendered.indexOf("A::a.md")).toBeLessThan(rendered.indexOf("A::z.md"));
    expect(renderCorpusSnapshot(unordered)).toBe(rendered);
    expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});

describe("roots", () => {
  /** A snapshot whose roots are given explicitly, so a root can be added or lost. */
  function withRoots(
    id: string,
    roots: { root_id: string; root_key: string; revision?: string; packet?: string }[],
  ): CorpusSnapshot {
    const base = snapshot(id, []);
    return {
      ...base,
      roots: roots.map((root) => ({
        root_id: root.root_id,
        root_key: root.root_key,
        root_label: root.root_key,
        root_snapshot_id: `root-snapshot:${root.root_id}`,
        source_kind: "directory",
        source_revision: root.revision ?? `fs:${root.root_id}`,
        physical_snapshot_hash: `sha256:${root.root_id}`,
        rmp_packet_id: root.packet ?? `packet:${root.root_id}`,
        rmp_semantic_hash: `sha256:${root.root_id}`,
        bundle_ref: `roots/${root.root_key}/bundle`,
        observation_status: "observed" as const,
        failure_reason: null,
      })),
    };
  }

  it("classifies a root that arrived, one that left, one that moved and one that did not", () => {
    const previous = withRoots("one", [
      { root_id: "root:a", root_key: "A" },
      { root_id: "root:b", root_key: "B" },
      { root_id: "root:c", root_key: "C" },
    ]);
    const current = withRoots("two", [
      { root_id: "root:a", root_key: "A" },
      { root_id: "root:b", root_key: "B", revision: "fs:changed", packet: "packet:changed" },
      { root_id: "root:d", root_key: "D" },
    ]);

    const diff = buildCorpusDiff(previous, current);
    expect(diff.counts).toMatchObject({
      root_added: 1,
      root_removed: 1,
      root_changed: 1,
      root_unchanged: 1,
    });
    const byRoot = new Map(diff.roots.map((entry) => [entry.root_id, entry]));
    expect(byRoot.get("root:a")?.category).toBe("root_unchanged");
    expect(byRoot.get("root:b")?.category).toBe("root_changed");
    expect(byRoot.get("root:c")?.category).toBe("root_removed");
    expect(byRoot.get("root:d")?.category).toBe("root_added");
    // A removed root has a previous revision and no current one, and vice versa.
    expect(byRoot.get("root:c")?.current_source_revision).toBeNull();
    expect(byRoot.get("root:d")?.previous_rmp_packet_id).toBeNull();
  });

  it("is not confused by the order the roots were listed in", () => {
    const forward = withRoots("one", [
      { root_id: "root:a", root_key: "A" },
      { root_id: "root:b", root_key: "B" },
    ]);
    const reversed = withRoots("one", [
      { root_id: "root:b", root_key: "B" },
      { root_id: "root:a", root_key: "A" },
    ]);
    const diff = buildCorpusDiff(forward, reversed);
    expect(diff.counts.root_unchanged).toBe(2);
    expect(diff.counts.root_added + diff.counts.root_removed + diff.counts.root_changed).toBe(0);
  });
});

describe("a file that appears in another root", () => {
  it("is a candidate, and the diff says why it is only that", () => {
    const previous = snapshot("one", [
      artifact("A::notes/monday.md", "sha256:same", { root_id: "root:a" }),
    ]);
    const current = {
      ...snapshot("two", [
        artifact("B::archive/monday.md", "sha256:same", { root_id: "root:b" }),
      ]),
    };
    const diff = buildCorpusDiff(previous, current);
    expect(diff.cross_root_move_candidates).toEqual([{
      content_hash: "sha256:same",
      from_root_id: "root:a",
      from_corpus_path: "A::notes/monday.md",
      to_root_id: "root:b",
      to_corpus_path: "B::archive/monday.md",
    }]);
    // The wording is the guardrail: a copy whose original was deleted, and two
    // unrelated identical files, produce this exact evidence.
    expect(diff.cross_root_move_statement).toBe(CROSS_ROOT_MOVE_STATEMENT);
  });

  it("is not reported when the bytes merely moved within one root", () => {
    const previous = snapshot("one", [artifact("A::a.md", "sha256:same", { root_id: "root:a" })]);
    const current = snapshot("two", [artifact("A::b.md", "sha256:same", { root_id: "root:a" })]);
    const diff = buildCorpusDiff(previous, current);
    // That is a rename candidate, which the diff already had a category for.
    expect(diff.cross_root_move_candidates).toEqual([]);
    expect(diff.counts.renamed_candidate).toBe(1);
  });
});

describe("a change to the rules rather than the disks", () => {
  it("is reported as a profile change, not a source change", () => {
    const previous = snapshot("one", [artifact("A::a.md", "sha256:a")], [], "profile:one");
    const current = snapshot("one", [artifact("A::a.md", "sha256:a")], [], "profile:two");
    const diff = buildCorpusDiff(previous, current);

    expect(diff.source_changed).toBe(false);
    expect(diff.invalidation.profile_changed).toBe(true);
    expect(diff.counts.unchanged).toBe(1);
    expect(diff.counts.changed_content).toBe(0);
    // The conclusions are not comparable across a profile change, and the diff
    // says so rather than reporting a zero that would read as "nothing changed".
    expect(diff.analysis.comparable).toBe(false);
  });

  it("is reported as a source change when the bytes really moved", () => {
    const previous = snapshot("one", [artifact("A::a.md", "sha256:before")]);
    const current = snapshot("two", [artifact("A::a.md", "sha256:after")]);
    const diff = buildCorpusDiff(previous, current);
    expect(diff.source_changed).toBe(true);
    expect(diff.invalidation.profile_changed).toBe(false);
    expect(diff.analysis.readiness_evidence_changed).toBe(true);
  });
});
