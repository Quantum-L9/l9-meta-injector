// corpus_scale.test.ts — the scan at the size the contract asks it to survive.
//
// Ten thousand artifacts, a hundred archives, a hundred duplicate clusters and
// twenty candidate projects, split across two roots. The point is not the wall
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

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-scale-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const SPEC = {
  artifacts: 10000,
  archives: 100,
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
    });

    expect(cold.snapshot.counts.artifact_count).toBeGreaterThanOrEqual(SPEC.artifacts);
    expect(cold.snapshot.counts.archive_count).toBe(SPEC.archives);
    expect(cold.snapshot.counts.archive_member_count).toBe(corpus.archiveMembers);
    expect(cold.coverage.exact_hash_coverage.ratio).toBe(1);
    expect(cold.snapshot.counts.root_count).toBe(2);

    // The duplicate payloads were written into both roots, so each of their
    // clusters spans the boundary. The archives add one more: every archive holds
    // the same `notes/shared.md`.
    expect(cold.candidates.summary.exact_duplicate_cluster_count).toBe(SPEC.duplicateClusters + 1);
    expect(cold.candidates.summary.cross_root_duplicate_cluster_count).toBe(SPEC.duplicateClusters + 1);

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
    expect(incremental.candidates.summary.exact_duplicate_cluster_count).toBe(SPEC.duplicateClusters);
  }, 600_000);
});
