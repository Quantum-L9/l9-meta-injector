// corpus_scale.test.ts — the scan at the size the contract asks it to survive.
//
// Ten thousand artifacts, a hundred archives, ten of them holding another
// archive, a hundred duplicate clusters and twenty candidate projects, split
// across three roots — a working drive, a backup of it, and a folder of zips,
// which is the shape a real archive corpus has. The point is not the wall
// clock: it is that identity, clustering, candidate generation and the cache all
// keep working when the corpus stops fitting in a person's head, and that a
// second pass over an unchanged corpus of that size recomputes nothing.
//
// The fixture is generated rather than committed, so what it contains is stated
// by the generator and its size is a parameter rather than a property of a
// checked-in tree.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryCorpusCache } from "../src/corpus_cache";
import { runCorpusScan } from "../src/corpus_scan";
import { renderCorpusSnapshot } from "../src/corpus_snapshot";
import { writeScaleCorpus } from "./helpers/multi_root_fixtures";
import { writeRawZip } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-scale-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * The archive budget this corpus needs.
 *
 * The default ceiling is 64 archives expanded in one run, and it is there on
 * purpose: an unbounded archive expansion is how a scan turns into a zip bomb.
 * A corpus of a hundred ZIPs is exactly the case where an operator raises it
 * deliberately, so the qualification raises it deliberately too, rather than
 * quietly measuring a corpus half of which was never opened.
 */
const ARCHIVE_POLICY = { maxNestedArchiveCount: 512 };

const SPEC = {
  artifacts: 10000,
  archives: 100,
  nestedArchives: 10,
  duplicateClusters: 100,
  candidateProjects: 20,
};

describe("a ten-thousand-artifact corpus", () => {
  it("scans, clusters and resumes without recomputing unchanged work", async () => {
    const base = tmp();
    const corpus = writeScaleCorpus(base, SPEC);
    const roots = corpus.roots.map((root) => ({ path: root }));
    const cache = new MemoryCorpusCache("scale");

    const cold = await runCorpusScan({
      roots,
      producerVersion: "scale",
      cache,
      // Topic candidates over ten thousand documents are a corpus-wide quadratic
      // in the worst case; the qualification they belong to is the candidate
      // suite, and running them here would measure the fixture rather than the
      // scan. Every other analysis is on.
      topics: { enabled: false },
      archivePolicy: ARCHIVE_POLICY,
    });

    expect(cold.snapshot.counts.artifact_count).toBeGreaterThanOrEqual(SPEC.artifacts);
    // Every top-level archive, every nested one, and every archive found inside a
    // nested one: nesting is observed at depth rather than stopped at the surface.
    expect(cold.snapshot.counts.archive_count)
      .toBe(SPEC.archives + SPEC.nestedArchives * 2);
    expect(cold.snapshot.counts.archive_member_count)
      .toBe(corpus.archiveMembers + corpus.nestedArchiveMembers);
    expect(cold.coverage.exact_hash_coverage.ratio).toBe(1);
    expect(cold.snapshot.counts.root_count).toBe(3);
    expect(cold.snapshot.corpus_status).toBe("complete");
    expect(cold.snapshot.verification.verification_class).toBe("fully_verified");
    // Three roots, three independent packets. None is a view of a merged tree.
    expect(new Set(cold.rootPackets.map((entry) => entry.packet.packet_id)).size).toBe(3);

    // The duplicate payloads were written into both roots, so each of their
    // clusters spans the boundary. The archives add one more: every archive holds
    // the same `notes/shared.md`.
    expect(cold.candidates.summary.exact_duplicate_cluster_count)
      .toBeGreaterThanOrEqual(SPEC.duplicateClusters + 1);
    expect(cold.candidates.summary.cross_root_duplicate_cluster_count)
      .toBeGreaterThanOrEqual(SPEC.duplicateClusters + 1);

    // Every project declares a name in its manifest, so every one of them is a
    // declared-identifier body of work rather than a directory-name guess.
    const declared = cold.candidates.project_candidates.filter((c) => c.identifier_is_declared);
    expect(declared).toHaveLength(SPEC.candidateProjects);
    expect(cold.coverage.semantics.project_candidate_count).toBe(SPEC.candidateProjects);
    expect(cold.coverage.reasoning_handoff.reasoning_eligible_candidate_count).toBe(SPEC.candidateProjects);
    expect(cold.readiness.bodies_of_work).toHaveLength(SPEC.candidateProjects);
    for (const body of cold.readiness.bodies_of_work) {
      expect(body.origin).toBe("explicit_project_identifier");
      expect(body.metrics.implementation.manifest_count).toBe(1);
      expect(body.metrics.validation.structural_test_artifact_count).toBe(1);
      expect(body.metrics.knowledge.plan_count).toBe(1);
    }

    const warm = await runCorpusScan({
      roots,
      producerVersion: "scale",
      cache,
      topics: { enabled: false },
      archivePolicy: ARCHIVE_POLICY,
      previousSnapshot: cold.snapshot,
    });
    expect(renderCorpusSnapshot(warm.snapshot)).toBe(renderCorpusSnapshot(cold.snapshot));
    expect(warm.cacheStats.misses).toBe(0);
    expect(warm.cacheStats.hit_ratio).toBe(1);
    expect(warm.diff?.counts.changed_content).toBe(0);
    expect(warm.diff?.counts.added).toBe(0);
    expect(warm.diff?.counts.removed).toBe(0);
    expect(warm.diff?.counts.unchanged).toBe(cold.snapshot.counts.artifact_count);

    // Every unchanged file's stat still matched, and every one of those matches
    // was confirmed by the hash rather than believed on its own.
    expect(warm.precheck.contradicted).toBe(0);
    expect(warm.precheck.confirmed_unchanged).toBe(warm.precheck.predicted_unchanged);
    expect(warm.precheck.predicted_unchanged).toBeGreaterThan(SPEC.artifacts / 2);

    // One document changes: exactly its own layers are recomputed.
    const target = path.join(corpus.roots[0], "shared", "doc-0000.md");
    fs.writeFileSync(target, "# Shared 0\n\nRewritten, so this cluster loses a member.\n", "utf8");
    const incremental = await runCorpusScan({
      roots,
      producerVersion: "scale",
      cache,
      topics: { enabled: false },
      archivePolicy: ARCHIVE_POLICY,
      previousSnapshot: warm.snapshot,
    });
    expect(incremental.diff?.counts.changed_content).toBe(1);
    expect(incremental.diff?.invalidation.new_content_hashes).toHaveLength(1);
    const misses = Object.fromEntries(
      incremental.cacheStats.layers.map((layer) => [layer.layer, layer.misses]),
    );
    expect(misses.raw_identity).toBe(1);
    expect(misses.normalized_document).toBe(1);
    expect(misses.lexical_features).toBe(1);
    expect(misses.embedding).toBe(0);
    expect(incremental.cacheStats.hits).toBeGreaterThan(10000);
    expect(incremental.candidates.summary.exact_duplicate_cluster_count)
      .toBe(cold.candidates.summary.exact_duplicate_cluster_count - 1);
  }, 600_000);

  it("reuses hashes in incremental mode and never calls the result verified", async () => {
    const base = tmp();
    const corpus = writeScaleCorpus(base, SPEC);
    const roots = corpus.roots.map((root) => ({ path: root }));
    const cache = new MemoryCorpusCache("scale-incremental");
    const options = {
      roots,
      producerVersion: "scale",
      cache,
      topics: { enabled: false },
      archivePolicy: ARCHIVE_POLICY,
    };

    // Run 1 — cold, full. The baseline every later run is measured against.
    const cold = await runCorpusScan(options);
    expect(cold.snapshot.verification.cached_hash_reuse_count).toBe(0);

    // Run 3 — warm cache, incremental, nothing changed. No byte should be read.
    const unchanged = await runCorpusScan({
      ...options,
      verification: "incremental",
      previousSnapshot: cold.snapshot,
    });
    expect(unchanged.snapshot.verification.verification_class)
      .toBe("cached_unchanged_assumption");
    expect(unchanged.snapshot.verification.fully_rehashed_artifact_count).toBe(0);
    expect(unchanged.snapshot.verification.cached_hash_reuse_count)
      .toBe(cold.snapshot.verification.fully_rehashed_artifact_count);
    // Reuse is only worth having if it lands on the same answer.
    expect(unchanged.snapshot.corpus_source_snapshot_id)
      .toBe(cold.snapshot.corpus_source_snapshot_id);
    expect(unchanged.cacheStats.misses).toBe(0);

    // Run 4 — incremental with one document and one archive changed. Everything
    // unaffected is carried; exactly what depends on the changed bytes is redone.
    const document = path.join(corpus.roots[0] as string, "shared", "doc-0001.md");
    fs.writeFileSync(document, "# Shared 1\n\nRewritten between the two scans.\n", "utf8");
    const archive = path.join(corpus.roots[2] as string, "zips", "bundle-000.zip");
    writeRawZip(archive, [
      { name: "notes/inner.md", content: "# Inner 0\n\nRepacked with a different body.\n" },
      { name: "notes/shared.md", content: "# Shared member\n\nIdentical in every archive in this corpus.\n" },
    ]);

    const changed = await runCorpusScan({
      ...options,
      verification: "incremental",
      previousSnapshot: unchanged.snapshot,
    });
    expect(changed.snapshot.verification.fully_rehashed_artifact_count).toBe(2);
    expect(changed.snapshot.verification.cached_hash_reuse_count)
      .toBe(cold.snapshot.verification.fully_rehashed_artifact_count - 2);
    expect(changed.diff?.counts.changed_content).toBeGreaterThanOrEqual(1);
    expect(changed.diff?.counts.archive_changed).toBe(1);
    expect(changed.diff?.source_changed).toBe(true);

    // Run 5 — --verify-content, restoring a byte-verified snapshot of the corpus
    // as it now stands.
    const verified = await runCorpusScan({
      ...options,
      verification: "incremental",
      verifyContent: true,
      previousSnapshot: changed.snapshot,
    });
    expect(verified.snapshot.verification.verification_class).toBe("fully_verified");
    expect(verified.snapshot.verification.cached_hash_reuse_count).toBe(0);
    expect(verified.snapshot.corpus_source_snapshot_id)
      .toBe(changed.snapshot.corpus_source_snapshot_id);
  }, 900_000);
});
