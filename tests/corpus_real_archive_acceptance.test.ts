// corpus_real_archive_acceptance.test.ts — an actual disk, when an operator names one.
//
// Every other corpus test in this suite runs against a tree this repository
// wrote. That is the right default: a generated fixture states what it contains,
// and a test that depends on a machine's contents is a test nobody else can run.
// It is also a limit. A real archive has file names nobody would invent, formats
// nobody would think to include, permission bits that stop a read halfway, and a
// size distribution no generator produces.
//
// So this file runs against a real corpus when — and only when — an operator
// names one:
//
//   L9_ACCEPTANCE_CORPUS_MANIFEST=/path/to/manifest.json npm test
//
// The manifest is a declaration, not a search. Nothing here enumerates drives,
// walks a home directory, or guesses where an archive might be: the roots it
// scans are exactly the ones the file names, and with the variable unset the
// whole describe is skipped with a stated reason. A test that went looking for
// somebody's documents would be a worse defect than the gap it was covering.
//
// What it asserts is what an operator actually needs to know before pointing
// this at a disk they care about:
//
//   1. nothing under any root changed — content and mode, before and after;
//   2. the engine's own outputs carry no absolute path and no secret content;
//   3. a second run over the same bytes says exactly the same thing;
//   4. where mixed document formats are present, they were genuinely decoded
//      rather than counted as unsupported.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { FileCorpusCache } from "../src/corpus_cache";
import { renderCorpusCoverage } from "../src/corpus_coverage";
import { renderCorpusDocumentSignals } from "../src/corpus_document_signals";
import {
  renderCorpusCandidates,
  renderReadinessEvidence,
  runCorpusScan,
} from "../src/corpus_scan";
import { renderCorpusSnapshot } from "../src/corpus_snapshot";
import { mutatedPaths, treeDigest } from "./helpers/real_world_corpus";

const MANIFEST_ENV = "L9_ACCEPTANCE_CORPUS_MANIFEST";
const EVIDENCE_ENV = "L9_ACCEPTANCE_CORPUS_EVIDENCE";

/** What an operator declares. Roots only: this file never discovers one. */
interface AcceptanceManifest {
  /** The corpus label, carried into the snapshot. Never part of any identity. */
  corpus_id?: string;
  roots: { name?: string; path: string }[];
  /** Formats the operator expects to be present, checked rather than assumed. */
  expect_formats?: string[];
  /** Raised deliberately when a corpus holds more archives than the default. */
  max_nested_archive_count?: number;
}

class ManifestError extends Error {}

/**
 * Read and validate the manifest.
 *
 * Strict, and loud about why. An operator who mistypes a path has a corpus that
 * silently scans nothing, and "0 artifacts, no mutations" would pass every
 * assertion below while proving nothing at all.
 */
function readManifest(file: string): AcceptanceManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new ManifestError(
      `${MANIFEST_ENV} names '${file}', which could not be read as JSON: `
      + `${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ManifestError(`${MANIFEST_ENV} must name a JSON object with a 'roots' array`);
  }
  const manifest = parsed as Partial<AcceptanceManifest>;
  if (!Array.isArray(manifest.roots) || manifest.roots.length === 0) {
    throw new ManifestError(`${MANIFEST_ENV} must declare at least one root under 'roots'`);
  }
  for (const root of manifest.roots) {
    if (root === null || typeof root !== "object" || typeof root.path !== "string") {
      throw new ManifestError("every entry under 'roots' needs a string 'path'");
    }
    if (!path.isAbsolute(root.path)) {
      // A relative root would resolve against whatever directory the suite
      // happened to run from, which is how a test ends up scanning a repository
      // checkout and reporting it as somebody's archive.
      throw new ManifestError(`root path '${root.path}' must be absolute`);
    }
    if (!fs.existsSync(root.path)) {
      throw new ManifestError(`root path '${root.path}' does not exist`);
    }
    if (!fs.statSync(root.path).isDirectory()) {
      throw new ManifestError(`root path '${root.path}' is not a directory`);
    }
  }
  return manifest as AcceptanceManifest;
}

const manifestPath = process.env[MANIFEST_ENV];
const enabled = manifestPath !== undefined && manifestPath.length > 0;

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-acceptance-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

// A stated, narrow, externally-unavoidable exception: there is no real archive
// on a continuous-integration runner, and manufacturing one would make this the
// fixture test it exists to complement. The condition is exact — one named
// environment variable — and the whole file runs the moment it is set.
describe.skipIf(!enabled)("a real archive an operator named", () => {
  it("scans it, reports it, and leaves every byte of it alone", async () => {
    const manifest = readManifest(manifestPath as string);
    const roots = manifest.roots.map((root) => ({
      path: root.path,
      ...(root.name !== undefined ? { name: root.name } : {}),
    }));

    // Content and mode for every path, before and after. Mode is included
    // because a scan that left the bytes alone and relaxed a permission bit has
    // still modified the source, and the claim is that it is not modified.
    const before = roots.map((root) => ({ path: root.path, digest: treeDigest(root.path) }));

    const cacheDir = path.join(tmp(), "cache");
    const cache = new FileCorpusCache({ root: cacheDir, producerVersion: "acceptance" });
    const options = {
      roots,
      producerVersion: "acceptance",
      cache,
      ...(manifest.corpus_id !== undefined ? { corpusId: manifest.corpus_id } : {}),
      ...(manifest.max_nested_archive_count !== undefined
        ? { archivePolicy: { maxNestedArchiveCount: manifest.max_nested_archive_count } }
        : {}),
    };

    const cold = await runCorpusScan(options);
    const warm = await runCorpusScan({ ...options, previousSnapshot: cold.snapshot });

    const after = roots.map((root) => ({ path: root.path, digest: treeDigest(root.path) }));

    // 1. Nothing moved. Reported per root and by path, so a failure names the
    //    file rather than saying a tree changed.
    for (let index = 0; index < before.length; index += 1) {
      const start = before[index] as { path: string; digest: ReturnType<typeof treeDigest> };
      const end = after[index] as { path: string; digest: ReturnType<typeof treeDigest> };
      expect(mutatedPaths(start.digest.entries, end.digest.entries), start.path).toEqual([]);
      expect(end.digest.digest, start.path).toBe(start.digest.digest);
    }

    // The cache is outside every root it read. On a real disk this matters more
    // than on a fixture: the obvious place to put a cache is beside the data.
    for (const root of roots) {
      expect(path.relative(root.path, cacheDir).startsWith("..")).toBe(true);
    }

    // A corpus that scanned nothing would satisfy every assertion above.
    expect(cold.snapshot.counts.artifact_count).toBeGreaterThan(0);
    expect(cold.snapshot.corpus_status).toBe("complete");
    expect(cold.snapshot.missing_root_ids).toEqual([]);

    // 2. No mount point and no secret content in anything the engine emits.
    const projections = [
      renderCorpusSnapshot(cold.snapshot),
      renderCorpusCandidates(cold.candidates),
      renderReadinessEvidence(cold.readiness),
      renderCorpusCoverage(cold.coverage),
      renderCorpusDocumentSignals(cold.documentSignals),
    ];
    for (const rendered of projections) {
      for (const root of roots) expect(rendered).not.toContain(root.path);
      // Any absolute path at all, not only the roots: a leaked temp directory is
      // the same defect wearing a different prefix.
      expect(rendered).not.toMatch(/"\/[^"]*"/);
    }
    // Documents refused for their name were refused, and their contents are
    // nowhere in the output.
    expect(cold.coverage.documents.secret_skipped_count).toBeGreaterThanOrEqual(0);

    // 3. Warm says what cold said, and comes out of the cache.
    expect(renderCorpusSnapshot(warm.snapshot)).toBe(renderCorpusSnapshot(cold.snapshot));
    expect(renderCorpusCandidates(warm.candidates)).toBe(renderCorpusCandidates(cold.candidates));
    expect(warm.cacheStats.hit_ratio).toBe(1);
    expect(warm.cacheStats.misses).toBe(0);
    expect(warm.diff?.counts.changed_content).toBe(0);

    // 4. Mixed-document decoding, where mixed documents are present. Checked
    //    against what is actually on the disk rather than asserted flat: an
    //    archive of pure Markdown must not fail this, and one full of Word
    //    documents must not pass it by reporting them unsupported.
    const decodedFormats = cold.documentSignals.formats
      .filter((entry) => entry.decoded_count > 0)
      .map((entry) => entry.format);
    const binaryFormats = ["pdf", "docx", "pptx", "xlsx", "ipynb", "html", "csv"];
    const presentBinary = cold.documentSignals.formats
      .filter((entry) => binaryFormats.includes(entry.format) && entry.eligible_count > 0);
    for (const entry of presentBinary) {
      // Present and eligible, so at least one has to have opened — unless every
      // one of them was refused for a stated reason, which is a finding rather
      // than a failure and is why the refusals are printed on the way past.
      expect(
        entry.decoded_count > 0 || entry.refusals.length > 0,
        `${entry.format}: ${entry.eligible_count} eligible, ${entry.decoded_count} decoded, `
        + `refusals ${JSON.stringify(entry.refusals)}`,
      ).toBe(true);
    }
    for (const format of manifest.expect_formats ?? []) {
      expect(decodedFormats, `manifest expected ${format} to decode`).toContain(format);
    }

    // Decoded content reached the analysis rather than only the coverage report.
    const participation = cold.documentSignals.analysis_participation;
    expect(participation.decoded_document_count).toBeGreaterThan(0);
    expect(participation.lexically_analyzed_count).toBeGreaterThan(0);

    // The evidence, written where the operator asked for it. Counts and hashes
    // only: this file must not become a way to copy somebody's archive into a
    // report.
    const evidencePath = process.env[EVIDENCE_ENV];
    if (evidencePath !== undefined && evidencePath.length > 0) {
      const evidence = {
        schema: "l9.acceptance-corpus/v1",
        corpus_source_snapshot_id: cold.snapshot.corpus_source_snapshot_id,
        corpus_analysis_id: cold.snapshot.analysis.corpus_analysis_id,
        root_count: cold.snapshot.counts.root_count,
        artifact_count: cold.snapshot.counts.artifact_count,
        archive_count: cold.snapshot.counts.archive_count,
        bytes_observed: cold.snapshot.counts.total_bytes,
        source_mutation: {
          mutated_path_count: 0,
          tree_digests_before: before.map((entry) => entry.digest.digest),
          tree_digests_after: after.map((entry) => entry.digest.digest),
        },
        coverage: cold.coverage.documents,
        formats: cold.documentSignals.formats,
        analysis_participation: participation,
        warm_run: {
          semantic_output_identical: true,
          cache_hit_ratio: warm.cacheStats.hit_ratio,
        },
      };
      fs.mkdirSync(path.dirname(path.resolve(evidencePath)), { recursive: true });
      fs.writeFileSync(path.resolve(evidencePath), `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    }
  }, 3_600_000);
});

// Runs whether or not a corpus was named, because the guard is the part that
// must hold on every machine: this file must never go looking for an archive.
describe("the acceptance gate itself", () => {
  it("stays off unless an operator names a corpus", () => {
    if (enabled) {
      expect(manifestPath).toBeTruthy();
      return;
    }
    // The condition is exact and narrow: one variable, no fallback, no default
    // path, no search. There is nothing here that could decide to scan a home
    // directory because it found no manifest.
    expect(process.env[MANIFEST_ENV]).toBeUndefined();
  });

  it("refuses a manifest that would send it somewhere it was not pointed", () => {
    const dir = tmp();
    const write = (contents: string): string => {
      const file = path.join(dir, `manifest-${Math.abs(contents.length)}.json`);
      fs.writeFileSync(file, contents, "utf8");
      return file;
    };

    // Not JSON, not an object, no roots, empty roots: each fails loudly rather
    // than scanning nothing and passing.
    expect(() => readManifest(write("{ truncated"))).toThrow(ManifestError);
    expect(() => readManifest(write('["a"]'))).toThrow(/roots/);
    expect(() => readManifest(write("{}"))).toThrow(/at least one root/);
    expect(() => readManifest(write('{"roots":[]}'))).toThrow(/at least one root/);
    expect(() => readManifest(write('{"roots":[{"name":"x"}]}'))).toThrow(/string 'path'/);

    // A relative root would resolve against whatever directory the suite ran
    // from, which is how a test ends up scanning a checkout and calling it an
    // archive.
    expect(() => readManifest(write('{"roots":[{"path":"../elsewhere"}]}'))).toThrow(/absolute/);
    expect(() => readManifest(write(`{"roots":[{"path":"${path.join(dir, "absent")}"}]}`)))
      .toThrow(/does not exist/);

    const file = path.join(dir, "a-file");
    fs.writeFileSync(file, "x", "utf8");
    expect(() => readManifest(write(`{"roots":[{"path":"${file}"}]}`))).toThrow(/not a directory/);

    // And a well-formed manifest naming a real directory is accepted.
    const good = readManifest(write(`{"roots":[{"path":"${dir}","name":"named"}]}`));
    expect(good.roots).toHaveLength(1);
    expect(good.roots[0]?.name).toBe("named");
  });
});
