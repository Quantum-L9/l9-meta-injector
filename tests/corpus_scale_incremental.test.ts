// corpus_scale_incremental.test.ts — the incremental half of the scale qualification.
//
// Runs 3, 4 and 5 of the five the contract names: incremental with nothing
// changed, incremental with a document and an archive rewritten, then
// `--verify-content`. Each is a claim about the run before it, so they share one
// fixture and one chain; the cold run at the head of the chain is the baseline
// the rest are measured against.
//
// Separate from `corpus_scale.test.ts` because a single test file that runs long
// enough trips vitest's worker RPC timeout, and two chains that do not depend on
// each other are two files rather than one long one.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryCorpusCache } from "../src/corpus_cache";
import { runCorpusScan } from "../src/corpus_scan";
import { writeScaleCorpus } from "./helpers/multi_root_fixtures";
import { writeRawZip } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-incremental-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** The ceiling an operator raises deliberately for a corpus that is mostly ZIPs. */
const ARCHIVE_POLICY = { maxNestedArchiveCount: 512 };

const SPEC = {
  artifacts: 10000,
  archives: 100,
  nestedArchives: 10,
  duplicateClusters: 100,
  candidateProjects: 20,
  mixedDocumentsPerFormat: 10,
};

describe("a ten-thousand-artifact corpus, rescanned", () => {
  it("reuses hashes, redoes only what moved, and never calls the result verified", async () => {
    const base = tmp();
    const corpus = writeScaleCorpus(base, SPEC);
    const roots = corpus.roots.map((root) => ({ path: root }));
    const cache = new MemoryCorpusCache("scale-incremental");
    const options = {
      roots,
      producerVersion: "scale",
      cache,
      // Off here, and on in `corpus_scale.test.ts`, which is the file that
      // qualifies semantic discovery at ten thousand documents. This file is
      // about verification modes: which hashes were reused, which were redone,
      // and what the run is willing to call verified. None of that is a function
      // of the topic pass, and running it here would add a minute to a test that
      // measures something else.
      topics: { enabled: false },
      archivePolicy: ARCHIVE_POLICY,
    };

    const cold = await runCorpusScan(options);
    expect(cold.snapshot.verification.cached_hash_reuse_count).toBe(0);

    // ── 3. incremental, nothing changed ───────────────────────────────────
    const unchanged = await runCorpusScan({
      ...options,
      verification: "incremental" as const,
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

    // ── 4. incremental, one document and one archive rewritten ────────────
    const document = path.join(corpus.roots[0] as string, "shared", "doc-0000.md");
    fs.writeFileSync(document, "# Shared 0\n\nRewritten, so this cluster loses a member.\n", "utf8");
    const archive = path.join(corpus.roots[2] as string, "zips", "bundle-000.zip");
    writeRawZip(archive, [
      { name: "notes/inner.md", content: "# Inner 0\n\nRepacked with a different body.\n" },
      { name: "notes/shared.md", content: "# Shared member\n\nIdentical in every archive in this corpus.\n" },
    ]);

    const changed = await runCorpusScan({
      ...options,
      verification: "incremental" as const,
      previousSnapshot: unchanged.snapshot,
    });
    // Exactly the two files whose bytes moved were read again; everything else
    // was carried.
    expect(changed.snapshot.verification.fully_rehashed_artifact_count).toBe(2);
    expect(changed.snapshot.verification.cached_hash_reuse_count)
      .toBe(cold.snapshot.verification.fully_rehashed_artifact_count - 2);
    expect(changed.diff?.source_changed).toBe(true);
    expect(changed.diff?.counts.archive_changed).toBe(1);
    expect(changed.diff?.counts.changed_content).toBeGreaterThanOrEqual(1);

    // And exactly the cache layers that depend on the changed document missed.
    const misses = Object.fromEntries(
      changed.cacheStats.layers.map((layer) => [layer.layer, layer.misses]),
    );
    expect(misses.embedding).toBe(0);
    expect(changed.cacheStats.hits).toBeGreaterThan(10000);
    expect(changed.candidates.summary.exact_duplicate_cluster_count)
      .toBe(cold.candidates.summary.exact_duplicate_cluster_count - 1);

    // ── 5. --verify-content ───────────────────────────────────────────────
    const verified = await runCorpusScan({
      ...options,
      verification: "incremental" as const,
      verifyContent: true,
      previousSnapshot: changed.snapshot,
    });
    expect(verified.snapshot.verification.verification_class).toBe("fully_verified");
    expect(verified.snapshot.verification.cached_hash_reuse_count).toBe(0);
    // The corpus as it now stands, byte-verified: the stat-assisted run before it
    // had reached the same answer.
    expect(verified.snapshot.corpus_source_snapshot_id)
      .toBe(changed.snapshot.corpus_source_snapshot_id);
  }, 900_000);
});
