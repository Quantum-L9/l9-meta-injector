// corpus_qualification.test.ts — the acceptance matrix for incremental multi-root scanning.
//
// Every case here is one of the properties the corpus layer is only allowed to
// claim if it can be demonstrated: that a warm cache changes speed and nothing
// else, that a change invalidates what depends on it and nothing more, that an
// interrupted scan resumes, that a corrupt cache entry is discarded rather than
// believed, and that a corpus read from a different mount point is the same
// corpus.
//
// The tests compare *semantic* output — the snapshot, the candidate projection
// and the readiness evidence. The session manifest is excluded deliberately: it
// records absolute paths and wall-clock times because an operator needs them, and
// for exactly that reason it is not something two runs are required to agree on.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  MemoryCorpusCache,
  cacheEntryDefect,
  interpretationKey,
  lexicalFeaturesKey,
  normalizedDocumentKey,
} from "../src/corpus_cache";
import { CorpusScanResult, TEXT_DECODER_ID, TEXT_DECODER_VERSION, runCorpusScan } from "../src/corpus_scan";
import { defaultDecoderRegistry } from "../src/documents";
import { CorpusSessionStore, DEFAULT_CORPUS_BUDGETS } from "../src/corpus_session";
import { corpusRootId } from "../src/corpus_roots";
import { renderCorpusSnapshot } from "../src/corpus_snapshot";
import { renderCorpusCandidates, renderReadinessEvidence } from "../src/corpus_scan";
import { writeMultiRootCorpus, planDocument } from "./helpers/multi_root_fixtures";
import { writeRawZip, treeSnapshot } from "./helpers/zip_fixtures";

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-qual-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** The bytes two runs of a deterministic scan must agree on exactly. */
function semanticOutput(result: CorpusScanResult): string {
  return [
    renderCorpusSnapshot(result.snapshot),
    renderCorpusCandidates(result.candidates),
    renderReadinessEvidence(result.readiness),
  ].join("\n");
}

/**
 * The snapshot with its scheduling hints removed.
 *
 * `stat_precheck` is a size and an mtime. Two copies of one corpus have different
 * mtimes and are still the same corpus, so the hint is excluded from any
 * comparison that asks whether two observations describe the same content.
 */
function contentOnlySnapshot(result: CorpusScanResult): string {
  return renderCorpusSnapshot({
    ...result.snapshot,
    artifacts: result.snapshot.artifacts.map(({ stat_precheck: _hint, ...rest }) => rest),
  });
}

async function scan(roots: { path: string; name?: string }[], extra: Partial<Parameters<typeof runCorpusScan>[0]> = {}) {
  return runCorpusScan({ roots, producerVersion: "qualification", ...extra });
}

describe("cold and warm runs", () => {
  it("produce byte-identical semantic output, and the warm run reads no source file twice", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [
      { path: corpus.oldSsd, name: "OldSSD" },
      { path: corpus.backup, name: "Backup" },
      { path: corpus.archives, name: "Archives" },
    ];
    const cache = new MemoryCorpusCache("qualification");

    const cold = await scan(roots);
    const warming = await scan(roots, { cache });
    const warm = await scan(roots, { cache });

    expect(semanticOutput(warm)).toBe(semanticOutput(cold));
    expect(semanticOutput(warming)).toBe(semanticOutput(cold));

    // A fully warm run is all hits: nothing was recomputed, so nothing could
    // have been recomputed differently.
    expect(warm.cacheStats.misses).toBe(0);
    expect(warm.cacheStats.hits).toBeGreaterThan(0);
    expect(warm.cacheStats.hit_ratio).toBe(1);
    expect(warm.coverage.cache.hit_ratio).toBe(1);
  });

  it("hash every byte on the warm run, because identity is never cached", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [{ path: corpus.oldSsd, name: "OldSSD" }];
    const cache = new MemoryCorpusCache("qualification");
    const cold = await scan(roots, { cache });
    const warm = await scan(roots, { cache });
    expect(warm.scanned.files).toBe(cold.scanned.files);
    expect(warm.scanned.bytes).toBe(cold.scanned.bytes);
    for (const artifact of warm.snapshot.artifacts) {
      expect(artifact.content_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    }
  });
});

describe("incremental invalidation", () => {
  it("reprocesses only the changed document when one file changes", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [{ path: corpus.oldSsd, name: "OldSSD" }, { path: corpus.backup, name: "Backup" }];
    const cache = new MemoryCorpusCache("qualification");
    const first = await scan(roots, { cache });

    fs.writeFileSync(
      path.join(corpus.oldSsd, "notes/monday.md"),
      "# Monday\n\nA note whose body has been rewritten since the last scan.\n",
      "utf8",
    );
    const second = await scan(roots, { cache, previousSnapshot: first.snapshot });

    const diff = second.diff;
    expect(diff).not.toBeNull();
    expect(diff?.counts.changed_content).toBe(1);
    expect(diff?.counts.added).toBe(0);
    expect(diff?.counts.removed).toBe(0);
    expect(diff?.counts.unchanged).toBe(first.snapshot.artifacts.length - 1);
    expect(diff?.invalidation.new_content_hashes).toHaveLength(1);
    expect(diff?.invalidation.retained_content_hash_count).toBeGreaterThan(0);
    // Exactly the layers that depend on the changed bytes miss, and no others:
    // one new hash, one decode, one lexical pass, one interpretation, and the two
    // corpus-scope analyses whose inputs are the whole document set.
    const misses = Object.fromEntries(
      second.cacheStats.layers.map((layer) => [layer.layer, layer.misses]),
    );
    expect(misses).toEqual({
      // The archives did not change, so their verdicts are answered from the
      // cache and nothing re-reads a central directory.
      archive_manifest: 0,
      raw_identity: 1,
      normalized_document: 1,
      interpretation: 1,
      lexical_features: 1,
      embedding: 0,
      candidate_analysis: 2,
    });
    expect(second.cacheStats.hits).toBeGreaterThan(second.cacheStats.misses);
  });

  it("classifies a moved file as a rename candidate and redecodes nothing", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [{ path: corpus.oldSsd, name: "OldSSD" }];
    const cache = new MemoryCorpusCache("qualification");
    const first = await scan(roots, { cache });

    fs.mkdirSync(path.join(corpus.oldSsd, "archive"), { recursive: true });
    fs.renameSync(
      path.join(corpus.oldSsd, "notes/monday.md"),
      path.join(corpus.oldSsd, "archive/monday.md"),
    );
    const second = await scan(roots, { cache, previousSnapshot: first.snapshot });

    expect(second.diff?.counts.renamed_candidate).toBe(1);
    expect(second.diff?.counts.added).toBe(0);
    expect(second.diff?.counts.removed).toBe(0);
    const rename = second.diff?.entries.find((entry) => entry.category === "renamed_candidate");
    expect(rename?.previous_corpus_path).toBe("OldSSD::notes/monday.md");
    expect(rename?.corpus_path).toBe("OldSSD::archive/monday.md");
    // Same bytes: nothing content-keyed is invalidated by a move.
    expect(second.diff?.invalidation.new_content_hashes).toHaveLength(0);
    expect(second.cacheStats.layers.find((layer) => layer.layer === "normalized_document")?.misses).toBe(0);
  });

  it("does not reuse a corpus-scope analysis across a rename", async () => {
    // The candidate documents embed artifact ids and corpus paths. A corpus whose
    // documents are unchanged but renamed is therefore a different input to that
    // analysis, and keying it on content alone served back candidates naming
    // artifacts the new snapshot does not contain.
    const root = path.join(tmp(), "Corpus");
    const shared = [
      "The routing table regeneration is verified against a recorded fixture rather than a",
      "live upstream, and the staging promotion job is unchanged in this revision of the",
      "document. Procurement remains the blocker for the hosting region decision.",
    ].join("\n");
    fs.mkdirSync(path.join(root, "notes"), { recursive: true });
    fs.writeFileSync(path.join(root, "notes/one.md"), `# One\n\n${shared}\n`, "utf8");
    fs.writeFileSync(path.join(root, "notes/two.md"), `# Two\n\n${shared}\nA differing tail.\n`, "utf8");

    const cache = new MemoryCorpusCache("qualification");
    const before = await scan([{ path: root }], { cache });
    expect(before.candidates.near_duplicate_candidates.length).toBeGreaterThan(0);

    fs.mkdirSync(path.join(root, "archive"), { recursive: true });
    fs.renameSync(path.join(root, "notes/one.md"), path.join(root, "archive/one.md"));

    const warm = await scan([{ path: root }], { cache });
    const cold = await scan([{ path: root }]);

    // Warm and cold agree, and every candidate endpoint is an artifact that is
    // actually in the snapshot the candidates were emitted beside.
    expect(renderCorpusCandidates(warm.candidates)).toBe(renderCorpusCandidates(cold.candidates));
    const present = new Set(warm.snapshot.artifacts.map((artifact) => artifact.virtual_source_id));
    for (const candidate of warm.candidates.near_duplicate_candidates) {
      expect(present.has(candidate.artifact_a_id)).toBe(true);
      expect(present.has(candidate.artifact_b_id)).toBe(true);
    }
    for (const candidate of warm.candidates.topic_candidates) {
      for (const id of candidate.member_ids) expect(present.has(id)).toBe(true);
    }
    const paths = warm.candidates.near_duplicate_candidates.flatMap(
      (candidate) => [candidate.source_path_a, candidate.source_path_b],
    );
    expect(paths).toContain("Corpus::archive/one.md");
    expect(paths).not.toContain("Corpus::notes/one.md");
  });

  it("reports an added archive, its members, and a removed archive", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [{ path: corpus.archives, name: "ArchiveZips" }];
    const first = await scan(roots);

    writeRawZip(path.join(corpus.archives, "new-work.zip"), [
      { name: "plans/next.md", content: planDocument("Next") },
    ]);
    const second = await scan(roots, { previousSnapshot: first.snapshot });
    expect(second.diff?.counts.archive_added).toBe(1);
    expect(second.diff?.counts.archive_removed).toBe(0);
    expect(second.diff?.counts.added).toBeGreaterThan(0);

    fs.rmSync(path.join(corpus.archives, "new-work.zip"));
    const third = await scan(roots, { previousSnapshot: second.snapshot });
    expect(third.diff?.counts.archive_removed).toBe(1);
    expect(third.diff?.counts.archive_added).toBe(0);
    // The departed member is absent from the current snapshot and recorded in the
    // diff, and no cache entry was destroyed on its account.
    expect(third.diff?.counts.removed).toBeGreaterThan(0);
    expect(third.diff?.invalidation.cache_entries_removed).toBe(0);
    expect(third.snapshot.artifacts.some((a) => a.corpus_path.includes("new-work.zip"))).toBe(false);
  });
});

describe("interruption and resume", () => {
  it("carries completed work forward and finishes with identical output", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [{ path: corpus.oldSsd, name: "OldSSD" }, { path: corpus.backup, name: "Backup" }];
    const sessionFile = path.join(tmp("l9-corpus-session-"), "corpus-session.json");
    const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };
    // Keyed and classed the way the CLI writes a session manifest: resuming
    // adopts completions recorded against a root id, so the class the session
    // was started under is what a later resume is judged against.
    const sessionRoots = roots.map((root) => ({
      root_id: corpusRootId(root.name),
      root_key: root.name,
      absolute_path: root.path,
      root_identity_class: "declared" as const,
    }));
    const cache = new MemoryCorpusCache("qualification");

    const first = CorpusSessionStore.open({
      file: sessionFile,
      roots: sessionRoots,
      budgets,
      now: "2026-01-01T00:00:00.000Z",
    });
    const interrupted = await scan(roots, { cache, session: first });
    first.save("2026-01-01T00:01:00.000Z");
    expect(fs.existsSync(sessionFile)).toBe(true);

    const resumed = CorpusSessionStore.open({
      file: sessionFile,
      roots: sessionRoots,
      budgets,
      now: "2026-01-01T00:02:00.000Z",
      resume: true,
    });
    expect(resumed.id).toBe(first.id);
    expect(resumed.resumedCounts.source_ids).toBeGreaterThan(0);
    expect(resumed.resumedCounts.decoder_keys).toBeGreaterThan(0);

    const completed = await scan(roots, { cache, session: resumed });
    expect(semanticOutput(completed)).toBe(semanticOutput(interrupted));
    // Nothing was recomputed on the resumed run.
    expect(completed.cacheStats.misses).toBe(0);
  });

  it("starts fresh rather than adopting a manifest written for other roots", () => {
    const sessionFile = path.join(tmp("l9-corpus-session-"), "corpus-session.json");
    const budgets = { ...DEFAULT_CORPUS_BUDGETS, archive: {} };
    const original = CorpusSessionStore.open({
      file: sessionFile,
      roots: [{ root_id: corpusRootId("A"), root_key: "A", absolute_path: "/mnt/a" }],
      budgets,
      now: "2026-01-01T00:00:00.000Z",
    });
    original.completeSource("vsrc:one");
    original.save("2026-01-01T00:00:01.000Z");

    const other = CorpusSessionStore.open({
      file: sessionFile,
      roots: [{ root_id: corpusRootId("B"), root_key: "B", absolute_path: "/mnt/b" }],
      budgets,
      now: "2026-01-01T00:00:02.000Z",
      resume: true,
    });
    expect(other.id).not.toBe(original.id);
    expect(other.resumedCounts.source_ids).toBe(0);
  });
});

describe("a corrupt cache entry", () => {
  it("is discarded, recomputed, reported, and changes no output", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [{ path: corpus.oldSsd, name: "OldSSD" }];
    const cache = new MemoryCorpusCache("qualification");
    const clean = await scan(roots, { cache });

    const plan = clean.snapshot.artifacts.find((a) => a.corpus_path.endsWith("PLAN.md"));
    expect(plan?.content_hash).toBeTruthy();
    // The key names the decoder that actually claimed the file, so a decoder
    // revision invalidates its own entries and this test keeps pointing at the
    // entry the run really wrote.
    const planDecoder = defaultDecoderRegistry().forPath("PLAN.md");
    const documentKey = normalizedDocumentKey({
      contentHash: plan?.content_hash as string,
      decoderId: planDecoder?.id as string,
      decoderVersion: planDecoder?.version as string,
    });
    expect(cache.corrupt("normalized_document", documentKey)).toBe(true);

    const repaired = await scan(roots, { cache });
    expect(semanticOutput(repaired)).toBe(semanticOutput(clean));
    expect(repaired.cacheStats.corrupt).toBe(1);
    expect(repaired.diagnostics.some((d) => d.code === "corpus-cache.entry_corrupt")).toBe(true);

    // …and the recomputed entry is trusted again on the next run.
    const afterRepair = await scan(roots, { cache });
    expect(afterRepair.cacheStats.corrupt).toBe(0);
    expect(semanticOutput(afterRepair)).toBe(semanticOutput(clean));
  });

  it("is detected by its own payload hash rather than by a heuristic", () => {
    const entry = {
      schema: "l9.corpus-cache-entry/v1",
      layer: "lexical_features" as const,
      key: "lexical:abc",
      payload_hash: `sha256:${"0".repeat(64)}`,
      producer_version: "qualification",
      payload: { token_count: 3 },
    };
    expect(cacheEntryDefect(entry, { layer: "lexical_features", key: "lexical:abc" })).toContain(
      "payload_hash does not describe",
    );
    expect(cacheEntryDefect(entry, { layer: "interpretation", key: "lexical:abc" })).toContain(
      "belongs to layer",
    );
  });
});

describe("mount points and path namespaces", () => {
  it("gives one corpus the same identity read from two different absolute paths", async () => {
    const first = writeMultiRootCorpus(tmp("l9-mount-a-"));
    const secondBase = tmp("l9-mount-b-");
    const second = writeMultiRootCorpus(secondBase);

    const here = await scan([{ path: first.oldSsd }, { path: first.backup }]);
    const there = await scan([{ path: second.oldSsd }, { path: second.backup }]);

    expect(there.snapshot.corpus_source_snapshot_id).toBe(here.snapshot.corpus_source_snapshot_id);
    expect(contentOnlySnapshot(there)).toBe(contentOnlySnapshot(here));
    expect(renderCorpusCandidates(there.candidates)).toBe(renderCorpusCandidates(here.candidates));
    expect(renderReadinessEvidence(there.readiness)).toBe(renderReadinessEvidence(here.readiness));

    // Nothing in the semantic output mentions where either copy was mounted.
    const rendered = contentOnlySnapshot(here) + renderCorpusCandidates(here.candidates);
    expect(rendered).not.toContain(first.base);
    expect(rendered).not.toContain(secondBase);
    expect(rendered).not.toContain(os.tmpdir());
  });

  it("keeps the same relative filename in two roots apart", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const result = await scan([{ path: corpus.oldSsd }, { path: corpus.backup }]);
    const mondays = result.snapshot.artifacts.filter((a) => a.root_relative_path === "notes/monday.md");
    expect(mondays).toHaveLength(2);
    expect(new Set(mondays.map((a) => a.virtual_source_id)).size).toBe(2);
    expect(new Set(mondays.map((a) => a.corpus_path))).toEqual(
      new Set(["OldSSD::notes/monday.md", "Backup::notes/monday.md"]),
    );
    // Different bytes, so they are not a duplicate cluster either.
    expect(new Set(mondays.map((a) => a.content_hash)).size).toBe(2);
  });

  it("folds one root mounted twice and refuses two different roots that share a key", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const folded = await scan([
      { path: corpus.oldSsd },
      { path: corpus.oldSsd, name: "OldSSD" },
    ]);
    expect(folded.bindings).toHaveLength(1);
    expect(folded.diagnostics.some((d) => d.code === "corpus.root_folded")).toBe(true);

    await expect(
      scan([{ path: corpus.oldSsd, name: "Same" }, { path: corpus.backup, name: "Same" }]),
    ).rejects.toThrow(/declare the key 'Same' but hold different content/);
  });
});

describe("the source", () => {
  it("is byte-for-byte unchanged by a scan, warm or cold", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const roots = [
      { path: corpus.oldSsd, name: "OldSSD" },
      { path: corpus.backup, name: "Backup" },
      { path: corpus.archives, name: "Archives" },
    ];
    const before = roots.map((root) => treeSnapshot(root.path));
    const cache = new MemoryCorpusCache("qualification");
    await scan(roots, { cache });
    await scan(roots, { cache });
    const after = roots.map((root) => treeSnapshot(root.path));
    expect(after).toEqual(before);
  });

  it("is not reachable through a symlink either", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const { assertOutsideRoots, resolveForContainment } = await import("../src/corpus_roots");
    const { FileCorpusCache } = await import("../src/corpus_cache");

    // A lexical containment check approves this path: it resolves to itself and
    // does not begin with the root. Following it lands in the observed tree.
    const link = path.join(tmp("l9-symlink-"), "outlink");
    fs.symlinkSync(path.join(corpus.oldSsd, "generated"), link);
    expect(resolveForContainment(link)).toContain(path.resolve(corpus.oldSsd));
    expect(() => assertOutsideRoots(link, [corpus.oldSsd], "the output")).toThrow(
      /refusing to write the output inside an observed root/,
    );
    expect(() =>
      new FileCorpusCache({ root: link, producerVersion: "q", observedRootPaths: [corpus.oldSsd] }),
    ).toThrow(/refusing a cache root inside an observed source tree/);

    // …and a path under a symlink that does not exist yet is judged the same way,
    // because it is judged by where it would be created.
    const nested = path.join(link, "deep", "corpus-out");
    expect(() => assertOutsideRoots(nested, [corpus.oldSsd], "the output")).toThrow(
      /refusing to write the output inside an observed root/,
    );

    // A symlink pointing somewhere else is still fine.
    const elsewhere = path.join(tmp("l9-symlink-ok-"), "outlink");
    fs.symlinkSync(tmp("l9-symlink-target-"), elsewhere);
    expect(() => assertOutsideRoots(elsewhere, [corpus.oldSsd], "the output")).not.toThrow();
  });

  it("is never where the cache, the session or the output may be written", async () => {
    const corpus = writeMultiRootCorpus(tmp());
    const { FileCorpusCache } = await import("../src/corpus_cache");
    expect(
      () =>
        new FileCorpusCache({
          root: path.join(corpus.oldSsd, ".l9-cache"),
          producerVersion: "qualification",
          observedRootPaths: [corpus.oldSsd],
        }),
    ).toThrow(/refusing a cache root inside an observed source tree/);

    const { assertOutsideRoots } = await import("../src/corpus_roots");
    expect(() => assertOutsideRoots(path.join(corpus.backup, "out"), [corpus.backup], "the output")).toThrow(
      /refusing to write the output inside an observed root/,
    );
  });
});

describe("cache keys", () => {
  it("are functions of content and rules, never of a location", () => {
    const contentHash = `sha256:${"a".repeat(64)}`;
    const documentKey = normalizedDocumentKey({
      contentHash,
      decoderId: TEXT_DECODER_ID,
      decoderVersion: TEXT_DECODER_VERSION,
    });
    expect(documentKey).toBe(
      normalizedDocumentKey({
        contentHash,
        decoderId: TEXT_DECODER_ID,
        decoderVersion: TEXT_DECODER_VERSION,
      }),
    );
    expect(
      normalizedDocumentKey({ contentHash, decoderId: TEXT_DECODER_ID, decoderVersion: "9.9.9" }),
    ).not.toBe(documentKey);
    expect(
      lexicalFeaturesKey({ normalizedDocumentIdentity: documentKey, lexicalProfileHash: "p1" }),
    ).not.toBe(lexicalFeaturesKey({ normalizedDocumentIdentity: documentKey, lexicalProfileHash: "p2" }));
    expect(
      interpretationKey({ normalizedDocumentIdentity: documentKey, interpretationProfileHash: "p1" }),
    ).not.toBe(
      interpretationKey({ normalizedDocumentIdentity: documentKey, interpretationProfileHash: "p2" }),
    );
  });
});
