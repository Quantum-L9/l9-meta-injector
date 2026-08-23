// corpus_identity.test.ts — what a corpus is, and what it was analyzed under.
//
// Two things are proved here, and they are the two the corpus contract is built
// on. The first is that source identity and analysis identity are separate
// numbers: an operator who swaps a decoder or raises a threshold has changed what
// was concluded, not what is on their disks, and a corpus that reported those as
// one change could not be used to tell a real edit from a settings change.
//
// The second is narrower and was a real defect. Two roots in an archive corpus
// routinely hold the same bytes at the same relative path — a backup of a project
// beside the project. The interpretation cache is keyed on exactly that pair, so
// the second root reads back the first root's entry, and if that entry carried
// the first root's subject ids the second root's packet would file its own
// documents under the other root's artifacts.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_MANIFEST_SCHEMA,
  DEFAULT_CORPUS_ID,
  readCorpusManifest,
  rootDirectoryName,
} from "../src/corpus_roots";
import { runCorpusScan } from "../src/corpus_scan";
import { FileCorpusCache } from "../src/corpus_cache";
import {
  bindPortableAssertions,
  interpretDocumentContent,
  toPortableAssertions,
} from "../src/interpretation";
import { defaultExtractors } from "../src/extractors";

const scratch: string[] = [];
function tmp(prefix = "l9-identity-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const README = [
  "---",
  "title: Alpha Service",
  "status: wip",
  "kind: project",
  "---",
  "# Alpha Service",
  "The alpha ingest pipeline reads the corpus and writes a normalized index.",
  "Depends on: beta-indexer",
].join("\n");

/** Two roots holding the identical document at the identical relative path. */
function twinRoots(): { rootA: string; rootB: string } {
  const base = tmp();
  const rootA = path.join(base, "rootA");
  const rootB = path.join(base, "rootB");
  for (const root of [rootA, rootB]) {
    fs.mkdirSync(path.join(root, "proj-alpha"), { recursive: true });
    fs.writeFileSync(path.join(root, "proj-alpha", "README.md"), README, "utf8");
  }
  // One byte of difference somewhere, so the roots are not simply one root
  // mounted twice — that case is folded, and would not exercise this at all.
  fs.writeFileSync(path.join(rootB, "proj-alpha", "NOTE.md"), "# Note\nrootB only.\n", "utf8");
  return { rootA, rootB };
}

describe("the corpus manifest", () => {
  it("names the corpus and every root, and resolves paths against itself", () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "disks", "old"), { recursive: true });
    fs.writeFileSync(path.join(dir, "corpus.json"), JSON.stringify({
      schema: CORPUS_MANIFEST_SCHEMA,
      corpus_id: "personal-technical-archive",
      roots: [{ root_id: "old-ssd", path: "disks/old", name: "Old SSD" }],
    }), "utf8");

    const manifest = readCorpusManifest(path.join(dir, "corpus.json"));
    expect(manifest.corpus_id).toBe("personal-technical-archive");
    expect(manifest.roots).toHaveLength(1);
    // The declared root_id is the root's identity; the path is where it is today.
    expect(manifest.roots[0]?.name).toBe("old-ssd");
    expect(manifest.roots[0]?.path).toBe(path.join(dir, "disks", "old"));
  });

  it("refuses a manifest that leaves a root unnamed or names one twice", () => {
    const dir = tmp();
    const write = (body: unknown): string => {
      const file = path.join(dir, `m${Math.random().toString(36).slice(2)}.json`);
      fs.writeFileSync(file, JSON.stringify(body), "utf8");
      return file;
    };
    expect(() => readCorpusManifest(write({
      schema: CORPUS_MANIFEST_SCHEMA, roots: [{ root_id: "a", path: "." }],
    }))).toThrow(/no 'corpus_id'/);
    expect(() => readCorpusManifest(write({
      schema: CORPUS_MANIFEST_SCHEMA, corpus_id: "c", roots: [{ path: "." }],
    }))).toThrow(/has no 'root_id'/);
    expect(() => readCorpusManifest(write({
      schema: CORPUS_MANIFEST_SCHEMA,
      corpus_id: "c",
      roots: [{ root_id: "a", path: "." }, { root_id: "a", path: ".." }],
    }))).toThrow(/declares root_id 'a' more than once/);
    expect(() => readCorpusManifest(write({ schema: "l9.something-else/v1", roots: [] })))
      .toThrow(/expected 'l9\.local-corpus\/v1'/);
  });

  it("still reads a roots list that predates corpus naming", () => {
    const dir = tmp();
    const file = path.join(dir, "roots.txt");
    fs.writeFileSync(file, `${dir}=one\n# a comment\n`, "utf8");
    const manifest = readCorpusManifest(file);
    expect(manifest.corpus_id).toBe(DEFAULT_CORPUS_ID);
    expect(manifest.roots[0]?.name).toBe("one");
  });
});

describe("the root output directory", () => {
  it("uses a plain key verbatim and disambiguates one that is not", () => {
    expect(rootDirectoryName("primary-projects")).toBe("primary-projects");
    expect(rootDirectoryName("Old_SSD.2")).toBe("Old_SSD.2");
    // A key that is not usable as a directory name is slugged, and the digest is
    // what keeps two keys that slug alike from becoming one directory.
    const slashed = rootDirectoryName("a/b");
    expect(slashed).not.toContain("/");
    expect(slashed).not.toBe(rootDirectoryName("a-b"));
    expect(rootDirectoryName("..")).not.toBe("..");
    // Stable: a directory name is a function of the key and nothing else.
    expect(rootDirectoryName("a/b")).toBe(slashed);
  });
});

describe("a cached interpretation", () => {
  it("carries no subject, and is rebound to whichever root reads it", () => {
    const extractors = defaultExtractors();
    const fresh = interpretDocumentContent({
      repositorySubjectId: "repo:rootA",
      sourcePath: "proj-alpha/README.md",
      content: README,
      extractors,
    });
    expect(fresh.assertions.length).toBeGreaterThan(0);

    const portable = toPortableAssertions(fresh.assertions);
    for (const assertion of portable) {
      expect(assertion).not.toHaveProperty("subject_id");
      expect(assertion).not.toHaveProperty("assertion_id");
    }

    // Rebinding to the root it came from reproduces it exactly...
    expect(bindPortableAssertions(portable, "repo:rootA")).toEqual(fresh.assertions);

    // ...and rebinding to another root produces that root's subjects instead,
    // rather than silently keeping the first root's.
    const rebound = bindPortableAssertions(portable, "repo:rootB");
    for (const [index, assertion] of rebound.entries()) {
      const original = fresh.assertions[index];
      expect(assertion.subject_id).not.toBe(original?.subject_id);
      expect(assertion.assertion_id).not.toBe(original?.assertion_id);
      expect(assertion.predicate).toBe(original?.predicate);
      expect(assertion.object).toBe(original?.object);
      expect(assertion.source_path).toBe(original?.source_path);
    }
  });

  it("does not let one root's identity leak into another root's packet", async () => {
    const { rootA, rootB } = twinRoots();
    const roots = [{ path: rootA, name: "rootA" }, { path: rootB, name: "rootB" }];
    const cold = await runCorpusScan({ roots, producerVersion: "test" });

    const cache = new FileCorpusCache({
      root: path.join(tmp(), "cache"),
      producerVersion: "test",
      observedRootPaths: [rootA, rootB],
    });
    await runCorpusScan({ roots, producerVersion: "test", cache });
    const warm = await runCorpusScan({ roots, producerVersion: "test", cache });

    // The cache must have been used, or this proves nothing.
    expect(cache.stats().hits).toBeGreaterThan(0);

    // Each root's packet is what it was when nothing was cached. Before the
    // rebinding this failed: rootB read rootA's entry for the twin README and
    // emitted rootA's artifact subject inside rootB's packet.
    const packetIds = (result: Awaited<ReturnType<typeof runCorpusScan>>) =>
      result.rootPackets.map((entry) => `${entry.root_key}=${entry.packet.packet_id}`);
    expect(packetIds(warm)).toEqual(packetIds(cold));
    expect(warm.snapshot.corpus_source_snapshot_id).toBe(cold.snapshot.corpus_source_snapshot_id);

    // And the two roots really do model the twin document as two artifacts.
    const subjectsOf = (key: string) => {
      const packet = warm.rootPackets.find((entry) => entry.root_key === key)?.packet;
      return new Set((packet?.payload.assertions ?? [])
        .filter((assertion) => assertion.source_path === "proj-alpha/README.md")
        .map((assertion) => assertion.subject_id));
    };
    const a = subjectsOf("rootA");
    const b = subjectsOf("rootB");
    expect(a.size).toBeGreaterThan(0);
    expect(b.size).toBeGreaterThan(0);
    for (const subject of a) expect(b.has(subject)).toBe(false);
  });
});

describe("a corpus snapshot", () => {
  it("gives every root its own packet, bundle reference and status", async () => {
    const { rootA, rootB } = twinRoots();
    const result = await runCorpusScan({
      roots: [{ path: rootA, name: "rootA" }, { path: rootB, name: "rootB" }],
      producerVersion: "test",
      corpusId: "personal-technical-archive",
    });

    expect(result.snapshot.corpus_id).toBe("personal-technical-archive");
    expect(result.snapshot.corpus_status).toBe("complete");
    expect(result.snapshot.counts.root_count_requested).toBe(2);
    expect(result.snapshot.counts.root_count_observed).toBe(2);
    expect(result.snapshot.counts.root_count_failed).toBe(0);

    for (const root of result.snapshot.roots) {
      expect(root.observation_status).toBe("observed");
      expect(root.rmp_packet_id).toMatch(/^packet:/);
      expect(root.rmp_semantic_hash).toMatch(/^sha256:/);
      // Output-relative, so a snapshot copied elsewhere still points at its own
      // bundles, and no mount point rides along inside it.
      expect(root.bundle_ref).toBe(`roots/${root.root_key}/bundle`);
      expect(root.failure_reason).toBeNull();
    }
    // Two roots, two distinct packets: neither is a view of one merged tree.
    const packets = new Set(result.snapshot.roots.map((root) => root.rmp_packet_id));
    expect(packets.size).toBe(2);
  });

  it("names the corpus without letting the name reach any identity", async () => {
    const { rootA, rootB } = twinRoots();
    const roots = [{ path: rootA, name: "rootA" }, { path: rootB, name: "rootB" }];
    const first = await runCorpusScan({ roots, producerVersion: "test", corpusId: "archive-one" });
    const second = await runCorpusScan({ roots, producerVersion: "test", corpusId: "archive-two" });

    expect(first.snapshot.corpus_id).not.toBe(second.snapshot.corpus_id);
    expect(first.snapshot.corpus_source_snapshot_id)
      .toBe(second.snapshot.corpus_source_snapshot_id);
    expect(first.snapshot.analysis.corpus_analysis_id)
      .toBe(second.snapshot.analysis.corpus_analysis_id);
    // The same root named in two corpora keeps its own packet, too.
    expect(first.rootPackets.map((p) => p.packet.packet_id))
      .toEqual(second.rootPackets.map((p) => p.packet.packet_id));
  });

  it("moves the analysis identity, and only that, when a threshold changes", async () => {
    const { rootA, rootB } = twinRoots();
    const roots = [{ path: rootA, name: "rootA" }, { path: rootB, name: "rootB" }];
    const base = await runCorpusScan({ roots, producerVersion: "test" });
    const retuned = await runCorpusScan({
      roots,
      producerVersion: "test",
      nearDuplicates: { threshold: 0.5 },
    });

    expect(retuned.snapshot.corpus_source_snapshot_id)
      .toBe(base.snapshot.corpus_source_snapshot_id);
    expect(retuned.snapshot.analysis.corpus_analysis_id)
      .not.toBe(base.snapshot.analysis.corpus_analysis_id);
  });
});
