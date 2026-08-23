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
  mixedDocumentsPerFormat: 30,
};

describe("a ten-thousand-artifact corpus", () => {
  // Runs 1 and 2 of the five the qualification asks for: cold full, then warm
  // full over the same bytes. The incremental chain is its own file — each of
  // these runs is a claim about the run before it, so they are kept together in
  // whichever file they belong to, and split only where the chain does.
  it("scans, clusters and reuses everything on a second full pass", async () => {
    const base = tmp();
    const corpus = writeScaleCorpus(base, SPEC);
    const roots = corpus.roots.map((root) => ({ path: root }));
    const cache = new MemoryCorpusCache("scale");
    const options = {
      roots,
      producerVersion: "scale",
      cache,
      // Every analysis is on, topic candidates included. Switching them off here
      // was the shortcut that made this file measure a scan the release does not
      // perform: an operator pointing this at a disk gets topic candidates, so a
      // scale qualification that skips them qualifies something else.
      archivePolicy: ARCHIVE_POLICY,
    };

    // ── 1. cold, full ─────────────────────────────────────────────────────
    const cold = await runCorpusScan(options);

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
    expect(cold.snapshot.verification.cached_hash_reuse_count).toBe(0);
    // Three roots, three independent packets. None is a view of a merged tree.
    expect(new Set(cold.rootPackets.map((entry) => entry.packet.packet_id)).size).toBe(3);

    // The duplicate payloads were written into more than one root, so each of
    // their clusters spans a boundary. The archives add more: every archive holds
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
    expect(cold.coverage.reasoning_handoff.reasoning_eligible_candidate_count)
      .toBe(SPEC.candidateProjects);
    expect(cold.readiness.bodies_of_work).toHaveLength(SPEC.candidateProjects);
    for (const body of cold.readiness.bodies_of_work) {
      expect(body.origin).toBe("explicit_project_identifier");
      expect(body.metrics.implementation.manifest_count).toBe(1);
      expect(body.metrics.validation.structural_test_artifact_count).toBe(1);
      expect(body.metrics.knowledge.plan_count).toBe(1);
    }

    // Topic candidates ran, over ten thousand documents, and the pass reports
    // what it cost. Fifty million pairs is what comparing everything would have
    // been; the index has to be orders of magnitude under that or it is not
    // bounding anything, whatever the wall clock said on this machine.
    const pairWork = cold.coverage.semantics.topic_pair_work;
    expect(pairWork.eligible_document_count).toBeGreaterThan(1_000);
    expect(pairWork.exhaustive_pair_count).toBeGreaterThan(1_000_000);
    expect(pairWork.evaluated_pair_count).toBeLessThan(pairWork.exhaustive_pair_count / 100);
    // And it did compare things: a bound that evaluated nothing would pass the
    // line above and mean the index reached no pair at all.
    expect(pairWork.evaluated_pair_count).toBeGreaterThan(0);
    expect(pairWork.indexed_posting_count).toBeGreaterThan(0);
    // The common vocabulary is outside every prefix, which is what makes the
    // rarest-first ordering worth having rather than merely tidy.
    expect(pairWork.unindexed_term_count).toBeGreaterThan(0);
    expect(cold.coverage.semantics.topic_candidate_count).toBeGreaterThan(0);

    // ── 1b. the mixed formats, at this size ───────────────────────────────
    //
    // A ten-thousand-document run over Markdown alone qualifies the cheapest
    // path through the scan. The operator's disks hold Word documents, decks,
    // spreadsheets, notebooks and PDFs, and every one of those has to be opened
    // by a decoder before a word of it can reach a topic — so each format is
    // required to be present, decoded, read for what it states, and named by a
    // candidate, at this size rather than in a five-file fixture.
    const byFormat = new Map(
      cold.documentSignals.analysis_participation.by_format.map((entry) => [entry.format, entry]),
    );
    for (const format of ["pdf", "docx", "pptx", "xlsx", "ipynb", "markdown", "html", "csv"]) {
      const participation = byFormat.get(format);
      expect(participation, `${format} is absent from the corpus`).toBeDefined();
      expect(participation?.decoded_count, `${format} decoded`).toBeGreaterThan(0);
      expect(participation?.lexically_analyzed_count, `${format} analyzed`).toBeGreaterThan(0);
    }
    for (const format of ["pdf", "docx", "pptx", "xlsx", "ipynb"]) {
      expect(byFormat.get(format)?.decoded_count).toBe(SPEC.mixedDocumentsPerFormat);
      // The count this closure exists to move off zero: decoded *and* found to
      // have said something, per format, at scale.
      expect(byFormat.get(format)?.interpreted_count, `${format} interpreted`)
        .toBe(SPEC.mixedDocumentsPerFormat);
    }

    // Every decoder that ran is named with the format it read, rather than the
    // whole index reporting one decoder for eight formats.
    const indexFormats = new Map(
      cold.documentIndex.summary.by_format.map((entry) => [entry.format, entry]),
    );
    expect(indexFormats.get("docx")?.decoder_id).not.toBe(indexFormats.get("pdf")?.decoder_id);
    for (const entry of cold.documentIndex.summary.by_format) {
      expect(entry.block_count, `${entry.format} blocks`).toBeGreaterThan(0);
      expect(entry.structured_locator_types.length).toBeGreaterThan(0);
    }

    // And the block-bound evidence is real at this size: statements, from every
    // binary format, each citing a coordinate that is not a line number.
    const evidence = cold.documentSignals.block_signals;
    expect(evidence.signal_count).toBeGreaterThan(SPEC.mixedDocumentsPerFormat * 5);
    expect(evidence.by_format.map((entry) => entry.format).sort())
      .toEqual(["csv", "docx", "html", "ipynb", "pdf", "pptx", "xlsx"]);
    for (const entry of evidence.by_format) {
      for (const record of entry.records) {
        expect(record.structured_locator.kind).not.toBe("line_span");
      }
    }

    // ── 2. warm, full ─────────────────────────────────────────────────────
    const warm = await runCorpusScan({ ...options, previousSnapshot: cold.snapshot });
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
  }, 900_000);
});
