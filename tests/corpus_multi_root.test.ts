// corpus_multi_root.test.ts — several disks read as one corpus.
//
// The properties here are the ones that only exist once more than one root is in
// play: identity that survives a remount, a path namespace that keeps two roots'
// identical filenames apart, and analysis that reaches across the boundary rather
// than stopping at it.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_ROOTS_SCHEMA,
  bindCorpusRoots,
  corpusPath,
  corpusRootId,
  corpusRootSnapshotId,
  corpusAnalysisId,
  corpusSourceSnapshotId,
  defaultRootKey,
  parseRootArgument,
  readRootManifest,
  splitCorpusPath,
  virtualSourceId,
} from "../src/corpus_roots";
import { runCorpusScan } from "../src/corpus_scan";
import { writeMultiRootCorpus } from "./helpers/multi_root_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-multiroot-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

describe("root identity", () => {
  it("separates which root this is from what it held", () => {
    const rootId = corpusRootId("OldSSD");
    expect(corpusRootId("OldSSD")).toBe(rootId);
    expect(corpusRootId("Backup")).not.toBe(rootId);
    // The snapshot id moves with the bytes; the root id does not.
    expect(corpusRootSnapshotId("sha256:a")).not.toBe(corpusRootSnapshotId("sha256:b"));
  });

  it("keys a root by its own final segment, never by where it is mounted", () => {
    expect(defaultRootKey("/Volumes/OldSSD")).toBe("OldSSD");
    expect(defaultRootKey("/mnt/recovered/OldSSD")).toBe("OldSSD");
    expect(defaultRootKey("/Volumes/OldSSD/")).toBe("OldSSD");
  });

  it("hashes the source snapshot over the sorted roots and nothing else", () => {
    const root = (id: string, revision: string, packet: string) => ({
      root_id: id,
      source_revision: revision,
      rmp_packet_id: packet,
    });
    const forward = corpusSourceSnapshotId([root("a", "r1", "p1"), root("b", "r2", "p2")]);
    // The order the operator typed the roots in is not a fact about the corpus.
    expect(corpusSourceSnapshotId([root("b", "r2", "p2"), root("a", "r1", "p1")])).toBe(forward);
    expect(corpusSourceSnapshotId([root("a", "r9", "p1"), root("b", "r2", "p2")])).not.toBe(forward);
    // Two runs that read the same bytes but modelled them differently are not the
    // same observation, so the packet id participates.
    expect(corpusSourceSnapshotId([root("a", "r1", "p9"), root("b", "r2", "p2")])).not.toBe(forward);
    expect(corpusSourceSnapshotId([root("z", "r1", "p1"), root("b", "r2", "p2")])).not.toBe(forward);
  });

  it("keeps analysis policy out of the source identity and in the analysis identity", () => {
    const roots = [{ root_id: "a", source_revision: "r1", rmp_packet_id: "p1" }];
    const source = corpusSourceSnapshotId(roots);
    const profiles = {
      corpus_profile: "corpus",
      document_decoder_profiles: ["utf8@1.0.0"],
      interpretation_profile: "interp",
      semantic_candidate_profile: "cand",
      readiness_profile: "ready",
    };
    const base = corpusAnalysisId({ corpusSourceSnapshotId: source, profiles });

    // Every profile change moves the analysis identity...
    for (const changed of [
      { ...profiles, corpus_profile: "other" },
      { ...profiles, document_decoder_profiles: ["utf8@2.0.0"] },
      { ...profiles, interpretation_profile: "other" },
      { ...profiles, semantic_candidate_profile: "other" },
      { ...profiles, readiness_profile: "other" },
      { ...profiles, embedding_profile: "text-embedding-3" },
    ]) {
      expect(corpusAnalysisId({ corpusSourceSnapshotId: source, profiles: changed })).not.toBe(base);
    }

    // ...and none of them moves the source identity. Swapping an embedding model
    // must not report that the disks were rewritten.
    expect(corpusSourceSnapshotId(roots)).toBe(source);

    // The decoder list is a set, not a sequence.
    expect(
      corpusAnalysisId({
        corpusSourceSnapshotId: source,
        profiles: { ...profiles, document_decoder_profiles: ["b@1", "a@1"] },
      }),
    ).toBe(
      corpusAnalysisId({
        corpusSourceSnapshotId: source,
        profiles: { ...profiles, document_decoder_profiles: ["a@1", "b@1"] },
      }),
    );
  });
});

describe("the path namespace", () => {
  it("qualifies a relative path with its root and round-trips", () => {
    expect(corpusPath("OldSSD", "notes/monday.md")).toBe("OldSSD::notes/monday.md");
    expect(splitCorpusPath("OldSSD::notes/monday.md")).toEqual({
      rootLabel: "OldSSD",
      rootRelativePath: "notes/monday.md",
    });
    // An archive locator keeps its own separator intact.
    expect(splitCorpusPath("OldSSD::bundle.zip!/a.md").rootRelativePath).toBe("bundle.zip!/a.md");
    expect(() => splitCorpusPath("no-separator")).toThrow(/is not a corpus path/);
  });

  it("gives the same relative path in two roots two identities", () => {
    const a = virtualSourceId(corpusRootId("OldSSD"), "notes/monday.md");
    const b = virtualSourceId(corpusRootId("Backup"), "notes/monday.md");
    expect(a).not.toBe(b);
    expect(virtualSourceId(corpusRootId("OldSSD"), "notes/monday.md")).toBe(a);
  });
});

describe("root arguments and manifests", () => {
  it("parse a bare path and a path with a declared name", () => {
    expect(parseRootArgument("/Volumes/OldSSD")).toEqual({ path: "/Volumes/OldSSD" });
    expect(parseRootArgument("/Volumes/OldSSD=archive-2019")).toEqual({
      path: "/Volumes/OldSSD",
      name: "archive-2019",
    });
    expect(parseRootArgument("/Volumes/OldSSD=")).toEqual({ path: "/Volumes/OldSSD" });
  });

  it("read a JSON manifest, resolving relative paths against the manifest", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "roots.json"),
      JSON.stringify({
        schema: CORPUS_ROOTS_SCHEMA,
        roots: [{ path: "disks/one", name: "One" }, "disks/two"],
      }),
      "utf8",
    );
    expect(readRootManifest(path.join(dir, "roots.json"))).toEqual([
      { path: path.join(dir, "disks/one"), name: "One" },
      { path: path.join(dir, "disks/two") },
    ]);
  });

  it("read a plain list of paths with comments", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "roots.txt"),
      ["# the disks", "disks/one=One", "", "disks/two"].join("\n"),
      "utf8",
    );
    expect(readRootManifest(path.join(dir, "roots.txt"))).toEqual([
      { path: path.join(dir, "disks/one"), name: "One" },
      { path: path.join(dir, "disks/two") },
    ]);
  });

  it("refuse a JSON manifest that declares another schema", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "roots.json"), JSON.stringify({ schema: "other/v1", roots: [] }), "utf8");
    expect(() => readRootManifest(path.join(dir, "roots.json"))).toThrow(/expected 'l9.corpus-roots\/v1'/);
  });
});

describe("binding", () => {
  function binding(key: string, hash: string, absolute: string) {
    return {
      root_id: corpusRootId(key),
      root_key: key,
      root_label: key,
      root_snapshot_id: corpusRootSnapshotId(hash),
      source_kind: "directory",
      source_revision: `fs:${hash}`,
      physical_snapshot_hash: hash,
      absolute_path: absolute,
      key_declared: false,
    };
  }

  it("orders roots by identity, so the order they were typed in does not matter", () => {
    const forward = bindCorpusRoots([binding("B", "sha256:b", "/b"), binding("A", "sha256:a", "/a")]);
    const backward = bindCorpusRoots([binding("A", "sha256:a", "/a"), binding("B", "sha256:b", "/b")]);
    expect(forward.roots.map((r) => r.root_key)).toEqual(backward.roots.map((r) => r.root_key));
  });

  it("folds one root mounted twice", () => {
    const bound = bindCorpusRoots([
      binding("A", "sha256:a", "/mnt/one"),
      binding("A", "sha256:a", "/mnt/two"),
    ]);
    expect(bound.roots).toHaveLength(1);
    expect(bound.folded).toHaveLength(1);
    expect(bound.folded[0].kept_absolute_path).toBe("/mnt/one");
  });

  it("refuses two different roots that claim one key", () => {
    expect(() =>
      bindCorpusRoots([binding("A", "sha256:a", "/mnt/one"), binding("A", "sha256:b", "/mnt/two")]),
    ).toThrow(/declare the key 'A' but hold different content/);
  });
});

describe("analysis across the root boundary", () => {
  it("clusters duplicates, joins projects, and reports which of each crosses a root", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const result = await runCorpusScan({
      roots: [{ path: corpus.oldSsd }, { path: corpus.backup }, { path: corpus.archives }],
      producerVersion: "test",
    });

    // PLAN.md is byte-identical on both disks and inside the archive.
    const planCluster = result.candidates.exact_duplicate_clusters.find((cluster) =>
      cluster.source_paths.some((sourcePath) => sourcePath.endsWith("widget-api/PLAN.md")),
    );
    expect(planCluster?.count).toBe(3);
    expect(new Set(planCluster?.source_paths.map((p) => p.split("::")[0])).size).toBe(3);
    expect(result.candidates.summary.cross_root_duplicate_cluster_count).toBeGreaterThan(0);

    // The two package.json files declare one name, so their containers join.
    const widget = result.candidates.project_candidates.find(
      (candidate) => candidate.project_key === "project:widget-api",
    );
    expect(widget?.identifier_is_declared).toBe(true);
    expect(widget?.spans_roots).toBe(true);
    expect(widget?.containers).toHaveLength(2);
    expect(result.candidates.summary.cross_root_project_candidate_count).toBe(1);

    // A duplicate relation points every non-representative member at one centre.
    expect(result.candidates.relations.every((relation) => relation.symmetric)).toBe(true);
    expect(result.candidates.relations.every((relation) => relation.type === "DUPLICATE_OF")).toBe(true);
  });

  it("reports coverage of what it could not read, without calling it a failure", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const result = await runCorpusScan({
      roots: [{ path: corpus.oldSsd }],
      producerVersion: "test",
    });
    expect(result.coverage.unsupported_format_counts).toEqual([
      { extension: ".pdf", count: 1, bytes: expect.any(Number) },
    ]);
    expect(result.coverage.documents.ocr_required_count).toBe(1);
    expect(result.coverage.embedding_coverage_when_enabled).toBeNull();
    expect(result.coverage.embeddings.enabled).toBe(false);
    expect(result.coverage.exact_hash_coverage.ratio).toBe(1);
    expect(result.coverage.reasoning_handoff.no_priority_statement).toContain("no priority");
    expect(result.coverage.reasoning_handoff.unique_content_estimate).toBeGreaterThan(0);
    expect(result.coverage.reasoning_handoff.readiness_evidence_refs.file).toBe("readiness-evidence.json");
  });

  it("decodes everything an extractor claims, not only the lexical extensions", async () => {
    // `.py` is claimed by the prose extractor and is not a lexical-analysis
    // extension. If the decoder's own list were the only gate, interpretation
    // coverage would report a gap that the decoder set caused rather than one the
    // corpus has.
    const root = path.join(tmp(), "svc");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.writeFileSync(path.join(root, "pyproject.toml"), '[project]\nname = "svc"\n', "utf8");
    fs.writeFileSync(path.join(root, "src", "main.py"), '"""Entry point."""\n\n\ndef main():\n    return 1\n', "utf8");
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    expect(result.coverage.interpretation_coverage.eligible).toBeGreaterThan(0);
    expect(result.coverage.interpretation_coverage.ratio).toBe(1);
    expect(result.coverage.normalized_document_coverage.ratio).toBe(1);
  });

  it("finds archive members and files on disk in one duplicate cluster", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const result = await runCorpusScan({
      roots: [{ path: corpus.oldSsd }, { path: corpus.archives }],
      producerVersion: "test",
    });
    const cluster = result.candidates.exact_duplicate_clusters.find((c) =>
      c.source_paths.some((p) => p.includes("old-work.zip!/")),
    );
    expect(cluster?.source_paths.some((p) => !p.includes("!/"))).toBe(true);
    expect(result.coverage.corpus.archive_count).toBe(1);
    expect(result.coverage.corpus.archive_member_count).toBe(2);
  });
});
