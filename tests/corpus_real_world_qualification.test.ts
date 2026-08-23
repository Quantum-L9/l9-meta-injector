// corpus_real_world_qualification.test.ts — the engine measured, not asserted.
//
// `corpus_qualification.test.ts` proves properties on corpora written from
// constants. `corpus_scale.test.ts` proves the properties still hold at ten
// thousand artifacts. Neither of them answers the question an operator asks
// before pointing this at a disk they care about, which is not "is it correct"
// but "what does it actually see".
//
// So this file runs the real engine, twice, over a mixed read-only two-root
// corpus with five archives in it, and turns the two results into a report. The
// assertions here are deliberately about the *shape and honesty* of that report
// rather than about exact totals: a test that pinned `bytes_scanned` to a literal
// would have to be edited every time the fixture gained a document, which would
// make it a test of the fixture instead of a test of the measurement.
//
// The numbers that are pinned are the ones the contract is actually about:
// cold and warm say the same thing, the second run comes out of the cache, and
// the corpus is byte-for-byte and mode-for-mode unchanged afterwards.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileCorpusCache, MemoryCorpusCache } from "../src/corpus_cache";
import {
  CORPUS_QUALIFICATION_SCHEMA,
  buildCorpusQualificationReport,
  renderCorpusQualificationReport,
} from "../src/corpus_qualification";
import { FORBIDDEN_READINESS_METRICS } from "../src/corpus_readiness";
import {
  renderCorpusCandidates,
  renderReadinessEvidence,
  runCorpusScan,
} from "../src/corpus_scan";
import { renderCorpusSnapshot } from "../src/corpus_snapshot";
import { renderCorpusCoverage } from "../src/corpus_coverage";
import {
  lockReadOnly,
  mutatedPaths,
  readOnlyEnforced,
  treeDigest,
  unlockReadOnly,
  writeRealWorldCorpus,
} from "./helpers/real_world_corpus";

const PRODUCER_VERSION = "real-world-qualification";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-corpus-real-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) {
    try {
      unlockReadOnly(dir);
    } catch {
      // The tree may already be gone, or never locked; teardown proceeds either way.
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** The projections a warm run must reproduce byte-for-byte. */
function semanticOutput(result: Awaited<ReturnType<typeof runCorpusScan>>): string {
  return [
    renderCorpusSnapshot({
      ...result.snapshot,
      artifacts: result.snapshot.artifacts.map(({ stat_precheck: _hint, ...rest }) => rest),
    }),
    renderCorpusCandidates(result.candidates),
    renderReadinessEvidence(result.readiness),
  ].join("\n");
}

/**
 * Build the corpus, lock it, scan it cold and then warm, and report.
 *
 * The cache lives in its own directory outside both roots, which is the only
 * place it is allowed to live. `scratchParent` is set for the same reason:
 * archive members are staged somewhere, and that somewhere is never the disk
 * being read.
 */
async function qualify(cacheKind: "file" | "memory") {
  const parent = tmp();
  const corpus = writeRealWorldCorpus(parent);
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "l9-corpus-work-"));
  scratch.push(workspace);

  lockReadOnly(corpus.driveRoot);
  lockReadOnly(corpus.backupRoot);

  const before = {
    drive: treeDigest(corpus.driveRoot),
    backup: treeDigest(corpus.backupRoot),
  };

  const cacheDir = path.join(workspace, "cache");
  const cache = cacheKind === "file"
    // `observedRootPaths` is passed rather than omitted so the cache refuses, on
    // this run, to sit inside either disk it is caching.
    ? new FileCorpusCache({
      root: cacheDir,
      producerVersion: PRODUCER_VERSION,
      observedRootPaths: [corpus.driveRoot, corpus.backupRoot],
    })
    : new MemoryCorpusCache(PRODUCER_VERSION);
  const scratchParent = path.join(workspace, "scratch");
  fs.mkdirSync(scratchParent, { recursive: true });

  const roots = corpus.roots.map((root) => ({ path: root.path, name: root.name }));
  const run = async (useCache: boolean) => runCorpusScan({
    roots,
    producerVersion: PRODUCER_VERSION,
    scratchParent,
    ...(useCache ? { cache } : {}),
  });

  // Cold: nothing may be read from the cache, so the first run is given none.
  const cold = await run(false);
  // Warming fills the cache; the run measured as "warm" is the one after it, so
  // that its ratio describes a cache that was already complete when it started.
  await run(true);
  const warm = await run(true);

  const after = {
    drive: treeDigest(corpus.driveRoot),
    backup: treeDigest(corpus.backupRoot),
  };

  const mutated = [
    ...mutatedPaths(before.drive.entries, after.drive.entries).map((p) => `old-ssd/${p}`),
    ...mutatedPaths(before.backup.entries, after.backup.entries).map((p) => `backup/${p}`),
  ];

  const report = buildCorpusQualificationReport({
    cold,
    warm,
    producerVersion: PRODUCER_VERSION,
    semanticOutputIdentical: semanticOutput(warm) === semanticOutput(cold),
    sourceMutation: {
      tree_digest_before: `${before.drive.digest}+${before.backup.digest}`,
      tree_digest_after: `${after.drive.digest}+${after.backup.digest}`,
      mutated_path_count: mutated.length,
      read_only_mode_applied: true,
      // Ordering here is load-bearing. `readOnlyEnforced` finds out whether the
      // mode bits hold by trying a write, so it must run *after* the `after`
      // digests above: moving it earlier would put a probe file into the very
      // measurement it is reporting alongside.
      read_only_enforced_for_process:
        readOnlyEnforced(corpus.driveRoot) && readOnlyEnforced(corpus.backupRoot),
    },
  });

  return { corpus, cold, warm, report, mutated, cacheDir };
}

/**
 * Write the report out when the harness asked for it.
 *
 * `scripts/corpus-qualification.js` sets the variable and then runs this file, so
 * the qualification and the evidence it produces are the same execution rather
 * than two that might disagree. Under an ordinary `npm test` the variable is
 * unset and nothing is written.
 */
function emitReport(rendered: string): void {
  const target = process.env.L9_QUALIFICATION_REPORT;
  if (target === undefined || target.length === 0) return;
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.writeFileSync(path.resolve(target), rendered, "utf8");
}

describe("a real mixed corpus on two read-only roots", () => {
  it("is measured end to end, and every contract field is reported", async () => {
    const { report, cold, mutated } = await qualify("file");

    expect(report.schema).toBe(CORPUS_QUALIFICATION_SCHEMA);
    expect(report.producer_version).toBe(PRODUCER_VERSION);

    // Nontrivial, as the contract requires: two roots, five archives, mixed
    // documents. Asserted as floors rather than equalities so the fixture can
    // grow without this becoming a test of the fixture.
    expect(report.corpus.root_count).toBe(2);
    expect(report.corpus.archive_count).toBeGreaterThanOrEqual(5);
    expect(report.corpus.archive_member_count).toBeGreaterThanOrEqual(9);
    expect(report.corpus.distinct_extension_count).toBeGreaterThanOrEqual(15);
    expect(report.roots).toHaveLength(2);
    expect(report.roots.map((root) => root.root_label).sort()).toEqual(["backup", "old-ssd"]);

    // 1. bytes_scanned / 2. files_scanned
    expect(report.files_scanned).toBeGreaterThan(40);
    expect(report.bytes_scanned).toBeGreaterThan(20_000);
    expect(report.files_scanned).toBe(cold.scanned.files);
    expect(report.bytes_scanned).toBe(cold.scanned.bytes);

    // 3. cache_hit_ratio_second_run — a complete cache is all hits.
    expect(report.cache_hit_ratio_second_run.enabled).toBe(true);
    expect(report.cache_hit_ratio_second_run.hit_ratio).toBe(1);
    expect(report.cache_hit_ratio_second_run.misses).toBe(0);
    expect(report.cache_hit_ratio_second_run.hits).toBeGreaterThan(0);
    expect(report.cache_hit_ratio_second_run.corrupt).toBe(0);
    expect(report.cache_hit_ratio_second_run.layers.length).toBeGreaterThan(0);

    // 4. decoder_coverage
    expect(report.decoder_coverage.text_decoder_id).toBe("utf8-text-decoder");
    expect(report.decoder_coverage.normalized_document.covered).toBeGreaterThan(0);
    expect(report.decoder_coverage.interpretation.covered).toBeGreaterThan(0);
    expect(report.decoder_coverage.lexical_analysis.covered).toBeGreaterThan(0);
    // Two separate gaps, and the report keeps them apart.
    //
    // The first is eligibility: a .pdf or a .png is not a decode failure, it is a
    // document no decoder claims, so it never enters the ratio at all. That gap
    // is reported in `unsupported_counts` below, and shows up here as an eligible
    // set much smaller than the corpus.
    //
    // The second is refusal: a file named `secrets.yaml` *is* eligible and is
    // deliberately not opened. That gap is inside the ratio, and it accounts for
    // the whole of the shortfall — which is the exact claim worth pinning, since
    // any decode that silently failed would break this equality.
    expect(report.decoder_coverage.normalized_document.eligible)
      .toBeLessThan(report.corpus.artifact_count);
    expect(
      report.decoder_coverage.normalized_document.eligible
      - report.decoder_coverage.normalized_document.covered,
    ).toBe(report.unsupported_counts.secret_skipped_count);
    // Embeddings are not enabled in this release, and the report says so rather
    // than reporting a coverage of zero that would read as a failure.
    expect(report.decoder_coverage.embedding_enabled).toBe(false);
    expect(report.decoder_coverage.embedding_when_enabled).toBeNull();

    // 5. duplicate_counts — including the cross-root clusters that are the whole
    // point of scanning two disks as one corpus.
    expect(report.duplicate_counts.exact_duplicate_cluster_count).toBeGreaterThan(0);
    expect(report.duplicate_counts.cross_root_duplicate_cluster_count).toBeGreaterThan(0);
    expect(report.duplicate_counts.recoverable_duplicate_bytes).toBeGreaterThan(0);
    expect(report.duplicate_counts.near_duplicate_candidate_count).toBeGreaterThan(0);
    expect(report.duplicate_counts.unique_content_estimate).toBeGreaterThan(0);
    expect(report.duplicate_counts.unique_content_estimate)
      .toBeLessThan(report.corpus.artifact_count);

    // 6. topic_candidate_counts / 7. project_candidate_counts
    expect(report.topic_candidate_counts.candidate_count).toBeGreaterThanOrEqual(0);
    expect(report.project_candidate_counts.candidate_count).toBeGreaterThanOrEqual(4);

    // 8. reasoning_eligible_count
    expect(report.reasoning_eligible_count).toBeGreaterThan(0);

    // 9. unsupported_counts — the honest half. A .pdf is a document this release
    // does not decode; a .png is one that has no text layer to decode at all.
    const unsupported = report.unsupported_counts;
    expect(unsupported.unsupported_format_total).toBeGreaterThanOrEqual(3);
    expect(unsupported.unsupported_format_bytes).toBeGreaterThan(0);
    expect(unsupported.unsupported_format_counts.map((entry) => entry.extension))
      .toEqual(expect.arrayContaining([".docx", ".pdf"]));
    expect(unsupported.ocr_required_count).toBeGreaterThanOrEqual(5);
    expect(unsupported.secret_skipped_count).toBe(2);

    // The source, after all of it.
    expect(mutated).toEqual([]);
    expect(report.source_mutation.mutated_path_count).toBe(0);
    expect(report.source_mutation.tree_digest_after)
      .toBe(report.source_mutation.tree_digest_before);

    emitReport(renderCorpusQualificationReport(report));
  });

  it("says the same thing warm as it did cold", async () => {
    const { report, cold, warm } = await qualify("memory");

    expect(report.cold_warm_equivalence.semantic_output_identical).toBe(true);
    expect(report.cold_warm_equivalence.corpus_snapshot_id_identical).toBe(true);
    expect(semanticOutput(warm)).toBe(semanticOutput(cold));

    // The warm run still hashes every byte: identity is never taken from the
    // cache, so the file and byte counts are unchanged by a hit.
    expect(report.cold_warm_equivalence.warm_files_scanned)
      .toBe(report.cold_warm_equivalence.cold_files_scanned);
    expect(warm.scanned.bytes).toBe(cold.scanned.bytes);

    // The cold run was given no cache at all, which is what makes it cold.
    expect(report.cold_warm_equivalence.cold_cache_hits).toBe(0);
    expect(report.cold_warm_equivalence.warm_cache_hits).toBeGreaterThan(0);

    // Coverage is a projection of the same run and must agree with the report.
    expect(warm.coverage.cache.hit_ratio).toBe(report.cache_hit_ratio_second_run.hit_ratio);
  });

  it("renders canonically, and invents no ranking while doing it", async () => {
    const { report } = await qualify("memory");
    const rendered = renderCorpusQualificationReport(report);

    expect(rendered.endsWith("\n")).toBe(true);
    expect(JSON.parse(rendered)).toEqual(report);
    // Canonical means stable: rendering the parsed document reproduces the bytes.
    expect(renderCorpusQualificationReport(JSON.parse(rendered))).toBe(rendered);

    // No absolute path may appear: a mount point is not part of what is reported
    // about a corpus, and a report that leaked one would tie a snapshot to a disk.
    expect(rendered).not.toContain(os.tmpdir());
    expect(rendered).not.toMatch(/"\/[^"]*"/);

    for (const metric of FORBIDDEN_READINESS_METRICS) {
      expect(rendered).not.toContain(metric);
    }
    expect(report.no_priority_statement).toContain("no priority");
  });

  it("writes its cache outside every root it read", async () => {
    const { corpus, cacheDir } = await qualify("file");

    expect(fs.existsSync(cacheDir)).toBe(true);
    for (const root of [corpus.driveRoot, corpus.backupRoot]) {
      expect(path.relative(root, cacheDir).startsWith("..")).toBe(true);
    }
  });
});

describe("the coverage projection of the same run", () => {
  it("carries the counts the report quotes, so neither can drift from the other", async () => {
    const { cold, report } = await qualify("memory");
    const coverage = JSON.parse(renderCorpusCoverage(cold.coverage)) as Record<string, unknown>;

    expect(coverage.ocr_required_count).toBe(report.unsupported_counts.ocr_required_count);
    expect(coverage.secret_skipped_count).toBe(report.unsupported_counts.secret_skipped_count);
    expect(coverage.reasoning_eligible_candidate_count).toBe(report.reasoning_eligible_count);
    expect(coverage.archive_count).toBe(report.corpus.archive_count);
  });
});
