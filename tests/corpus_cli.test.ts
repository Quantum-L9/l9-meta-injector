// corpus_cli.test.ts — corpus mode as an operator runs it.
//
// The CLI is where the roots, the cache, the session and every projection are
// wired together, and it is the only surface most people will ever touch. Every
// run below is the real script against the committed `dist/`, so a wiring mistake
// fails here rather than in someone's terminal.
import * as cp from "node:child_process";
import * as crypto from "node:crypto";
import * as http from "node:http";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { writeMultiRootCorpus } from "./helpers/multi_root_fixtures";
import { treeSnapshot } from "./helpers/zip_fixtures";

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "scripts", "local-source-cli.js");

const scratch: string[] = [];
function tmp(prefix = "l9-corpus-cli-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Run {
  const result = cp.spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/**
 * The same run, without blocking this process's event loop.
 *
 * `spawnSync` stops everything until the child exits, which is fine when the
 * child needs nothing from here. It is fatal when the child is expected to reach
 * a server running in *this* process: the socket is never accepted, and the run
 * fails on a timeout that has nothing to do with the code under test.
 */
function runAsync(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = cp.spawn(process.execPath, [CLI, ...args], { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.on("data", (chunk: string) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

interface Fixture {
  corpus: ReturnType<typeof writeMultiRootCorpus>;
  out: string;
  cache: string;
  roots: string[];
}

function fixture(): Fixture {
  const corpus = writeMultiRootCorpus(tmp("l9-corpus-cli-src-"));
  return {
    corpus,
    out: path.join(tmp("l9-corpus-cli-out-"), "observation"),
    cache: path.join(tmp("l9-corpus-cli-cache-"), "cache"),
    roots: [corpus.oldSsd, corpus.backup, corpus.archives],
  };
}

/**
 * The arguments an operator who names their roots would type.
 *
 * `PATH=KEY` rather than a bare path, because most of these runs compare, resume
 * or reuse across runs, and continuity on a key nobody declared is refused. The
 * refusal and its override are the subject of `corpus_root_history.test.ts`;
 * here the roots are named so these tests are about what they say they are.
 */
function argsFor(f: Fixture, extra: string[] = []): string[] {
  return [
    ...f.roots.flatMap((root) => ["--root", `${root}=${path.basename(root)}`]),
    "--out", f.out,
    "--cache-dir", f.cache,
    ...extra,
  ];
}

/**
 * Where the projections of the most recent run actually live.
 *
 * A run writes one generation directory and then switches `CURRENT.json` to it
 * with a single atomic rename, so nothing is at a fixed path any more and every
 * reader — these tests included — resolves through the pointer. That is the
 * point of the layout: a reader either sees a whole generation or the previous
 * whole generation, never a mixture assembled out of twelve separate renames.
 */
function sha256Of(contents: string): string {
  return `sha256:${crypto.createHash("sha256").update(contents, "utf8").digest("hex")}`;
}

function generation(f: Fixture): string {
  const current = JSON.parse(fs.readFileSync(path.join(f.out, "CURRENT.json"), "utf8"));
  expect(current.schema).toBe("l9.corpus-current/v1");
  return path.join(f.out, ...String(current.generation_ref).split("/"));
}

/** The roots recorded in a fixture's snapshot. */
function snapshotRoots(f: Fixture): { root_key: string; rmp_packet_id: string; bundle_ref: string }[] {
  return JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-snapshot.json"), "utf8")).roots;
}

describe("corpus mode", () => {
  it("states in its report what it understood and what it could not", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    const report = fs.readFileSync(path.join(generation(f), "corpus-report.md"), "utf8");

    // The coverage law: an operator must be able to tell "we looked and found
    // nothing" from "we could not read this", without opening a second file and
    // joining it by hand.
    for (const heading of [
      "## Exact observation",
      "## Decoding",
      "## Intelligence",
      "## Embedding",
    ]) {
      expect(report).toContain(heading);
    }
    expect(report).toContain("artifacts hashed");
    expect(report).toContain("artifacts unhashed");
    expect(report).toContain("needs OCR");
    expect(report).toContain("encrypted");
    expect(report).toContain("decoder failures");
    expect(report).toContain("artifacts with work signals");
    expect(report).toContain("skipped as secret candidates");
    // Embeddings did not run, and the report says so rather than printing a zero
    // that reads as "nothing was eligible".
    expect(report).toMatch(/\| enabled \| no \|/);
    expect(report).toMatch(/\| embedded artifacts \| — \|/);

    // And the per-format decoding table, which is where a decoder wired to
    // nothing becomes visible: decoded above zero, understood at zero.
    expect(report).toMatch(/\| format \| decoder \| eligible \| decoded \| understood \| refused \|/);
    const index = JSON.parse(
      fs.readFileSync(path.join(generation(f), "corpus-index.json"), "utf8"),
    );
    expect(index.coverage.decoding.length).toBeGreaterThan(0);
    for (const entry of index.coverage.decoding) {
      expect(entry.decoded_count).toBeLessThanOrEqual(entry.eligible_count);
      expect(entry.interpreted_count).toBeLessThanOrEqual(entry.decoded_count);
    }
  });

  it("writes the projection set and leaves every root untouched", () => {
    const f = fixture();
    const before = f.roots.map((root) => treeSnapshot(root));
    const result = run(argsFor(f));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(f.roots.map((root) => treeSnapshot(root))).toEqual(before);

    // The output root holds a pointer, the generations, and the session. Nothing
    // else: a projection at a fixed path beside a pointer is a second way to
    // read the results, and the second way is the one that goes stale.
    expect(fs.readdirSync(f.out).sort()).toEqual(["CURRENT.json", "generations", "session"]);
    expect(fs.readdirSync(path.join(f.out, "generations"))).toHaveLength(1);

    expect(fs.readdirSync(generation(f)).sort()).toEqual([
      "consolidation-candidates.json",
      "corpus-candidates.json",
      "corpus-coverage.json",
      "corpus-index.json",
      "corpus-report.md",
      "corpus-snapshot.json",
      "document-index.json",
      "document-signals.json",
      "document-work-signals.jsonl",
      "document-work-signals.manifest.json",
      "project-candidates.json",
      "readiness-evidence.json",
      "reasoning-candidates.jsonl",
      "reasoning-evidence-packs.jsonl",
      "roots",
      "semantic-relations.json",
      "topic-candidates.json",
    ]);

    // Every root keeps its own bundle, acquisition manifest and document index,
    // under a directory named after the key the operator declared.
    expect(fs.readdirSync(path.join(generation(f), "roots")).sort()).toEqual(
      f.roots.map((root) => path.basename(root)).sort(),
    );
    for (const root of fs.readdirSync(path.join(generation(f), "roots"))) {
      const dir = path.join(generation(f), "roots", root);
      expect(fs.readdirSync(dir).sort()).toEqual([
        "bundle",
        "document-coverage.json",
        "document-index.json",
        "local-source-manifest.json",
      ]);
      expect(fs.readdirSync(path.join(dir, "bundle")).sort())
        .toEqual(["manifest.json", "packet.json", "receipts"]);
      const bundle = JSON.parse(fs.readFileSync(path.join(dir, "bundle", "manifest.json"), "utf8"));
      const entry = snapshotRoots(f).find((r: { root_key: string }) => r.root_key === root);
      expect(entry?.rmp_packet_id).toBe(bundle.packet_id);
      expect(entry?.bundle_ref).toBe(`roots/${root}/bundle`);
    }
    const snapshot = JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-snapshot.json"), "utf8"));
    const candidates = JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-candidates.json"), "utf8"));
    const coverage = JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-coverage.json"), "utf8"));
    const readiness = JSON.parse(fs.readFileSync(path.join(generation(f), "readiness-evidence.json"), "utf8"));
    const session = JSON.parse(
      fs.readFileSync(path.join(f.out, "session", "corpus-session.json"), "utf8"),
    );

    const signals = JSON.parse(fs.readFileSync(path.join(generation(f), "document-signals.json"), "utf8"));

    expect(snapshot.schema).toBe("l9.corpus-snapshot/v1");
    expect(candidates.schema).toBe("l9.corpus-candidates/v1");
    expect(coverage.schema).toBe("l9.corpus-coverage/v1");
    expect(signals.schema).toBe("l9.document-signals/v1");
    expect(signals.corpus_source_snapshot_id).toBe(snapshot.corpus_source_snapshot_id);
    // Decoding that reaches nothing is not a result. The signals document says
    // how much of what was decoded a candidate actually names, so the CLI cannot
    // report a wired decoder as a working one.
    expect(signals.analysis_participation.decoded_document_count).toBeGreaterThan(0);
    expect(signals.analysis_participation.candidate_member_count).toBeGreaterThan(0);
    expect(signals.decoder_profiles.length).toBeGreaterThan(0);
    for (const profile of signals.decoder_profiles) expect(profile).toMatch(/^l9\.[a-z-]+@\d+\.\d+\.\d+$/);
    expect(readiness.schema).toBe("l9.readiness-evidence/v1");
    expect(session.schema).toBe("l9.corpus-session/v1");
    expect(snapshot.counts.root_count).toBe(3);
    expect(session.corpus_snapshot_target).toBe(snapshot.corpus_source_snapshot_id);

    expect(result.stdout).toContain("no root was modified");
    expect(result.stdout).toContain("crossing a root boundary");
    expect(result.stdout).toContain("no ranking, score or priority is produced");
    expect(result.stdout).toContain("no model was called and no network request was made");
  });

  it("keeps every mount point out of the semantic projections", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    for (const name of ["corpus-snapshot.json", "corpus-candidates.json", "readiness-evidence.json", "corpus-coverage.json"]) {
      const contents = fs.readFileSync(path.join(generation(f), name), "utf8");
      for (const root of f.roots) expect(contents).not.toContain(root);
      expect(contents).not.toContain(os.tmpdir());
    }
    // The session manifest is operational and does carry them, on purpose.
    expect(fs.readFileSync(path.join(f.out, "session", "corpus-session.json"), "utf8"))
      .toContain(f.corpus.oldSsd);
  });

  it("diffs against its own previous snapshot on the next run", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    expect(fs.existsSync(path.join(generation(f), "corpus-diff.json"))).toBe(false);

    fs.writeFileSync(path.join(f.corpus.oldSsd, "notes/tuesday.md"), "# Tuesday\n\nA new note.\n", "utf8");
    const second = run(argsFor(f));
    expect(second.status).toBe(0);
    const diff = JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-diff.json"), "utf8"));
    expect(diff.schema).toBe("l9.corpus-diff/v1");
    expect(diff.counts.added).toBe(1);
    expect(diff.counts.changed_content).toBe(0);
    expect(diff.invalidation.cache_entries_removed).toBe(0);
    expect(second.stdout).toContain("diff             +1 -0 ~0");
    // The second run reused the first run's work for everything that did not move:
    // only the arrival's own layers, and the two corpus-scope analyses, missed.
    const coverage = JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-coverage.json"), "utf8"));
    expect(coverage.cache.misses).toBe(6);
    expect(coverage.cache.hit_ratio).toBeGreaterThan(0.8);
  });

  it("resumes a session for the same roots", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    const resumed = run(argsFor(f, ["--resume"]));
    expect(resumed.status).toBe(0);
    expect(resumed.stdout).toMatch(/resumed {10}\d+ source\(s\)/);
  });

  it("runs cold when the cache is switched off", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    const cold = run([
      ...f.roots.flatMap((root) => ["--root", `${root}=${path.basename(root)}`]),
      "--out", f.out,
      "--no-cache",
    ]);
    expect(cold.status).toBe(0);
    expect(cold.stdout).toContain("cache            off");
  });

  it("accepts a roots manifest", () => {
    const f = fixture();
    const manifest = path.join(tmp("l9-corpus-cli-manifest-"), "roots.json");
    fs.writeFileSync(
      manifest,
      JSON.stringify({ schema: "l9.corpus-roots/v1", roots: f.roots.map((root) => ({ path: root })) }),
      "utf8",
    );
    const result = run(["--root-manifest", manifest, "--out", f.out, "--cache-dir", f.cache]);
    expect(result.status).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-snapshot.json"), "utf8")).counts.root_count).toBe(3);
  });

  it("refuses to write its output or its cache inside a root", () => {
    const f = fixture();
    const inside = run([
      "--root", f.corpus.oldSsd,
      "--out", path.join(f.corpus.oldSsd, "out"),
      "--cache-dir", f.cache,
    ]);
    expect(inside.status).not.toBe(0);
    expect(inside.stderr).toContain("refusing to write the corpus output directory inside an observed root");

    const cacheInside = run([
      "--root", f.corpus.oldSsd,
      "--out", f.out,
      "--cache-dir", path.join(f.corpus.oldSsd, "cache"),
    ]);
    expect(cacheInside.status).not.toBe(0);
    expect(cacheInside.stderr).toContain("refusing a cache root inside an observed source tree");
  });

  it("still runs the single-source mode when no root is named", () => {
    const corpus = writeMultiRootCorpus(tmp("l9-corpus-cli-single-"));
    const out = path.join(tmp("l9-corpus-cli-single-out-"), "observation");
    const result = run([corpus.oldSsd, "--out", out]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("local-source: OK");
    expect(fs.existsSync(path.join(out, "corpus-index.json"))).toBe(true);
    expect(fs.existsSync(path.join(out, "corpus-snapshot.json"))).toBe(false);
  });
});

describe("semantic candidate discovery", () => {
  it("emits the candidate documents, the reasoning queue and the document index", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);

    const relations = JSON.parse(fs.readFileSync(path.join(generation(f), "semantic-relations.json"), "utf8"));
    const topics = JSON.parse(fs.readFileSync(path.join(generation(f), "topic-candidates.json"), "utf8"));
    const projects = JSON.parse(fs.readFileSync(path.join(generation(f), "project-candidates.json"), "utf8"));
    const consolidation = JSON.parse(
      fs.readFileSync(path.join(generation(f), "consolidation-candidates.json"), "utf8"));
    const documents = JSON.parse(fs.readFileSync(path.join(generation(f), "document-index.json"), "utf8"));

    expect(relations.schema).toBe("l9.semantic-relations/v1");
    expect(topics.schema).toBe("l9.topic-candidates/v1");
    expect(projects.schema).toBe("l9.project-candidates/v1");
    expect(consolidation.schema).toBe("l9.consolidation-candidates/v1");
    expect(documents.schema).toBe("l9.document-index/v2");

    // The document index is the prerequisite this contract had to build: every
    // entry names its artifact, the exact source hash, and the decoder identity.
    //
    // The decoder identity is the one that *read the file*. This assertion used
    // to require every row to name the text decoder, which the index did in fact
    // do — including for files the text decoder never opened. A `.docx` row
    // claiming the text decoder made the normalized document id derived from it
    // wrong too, and that id is the join key between this index, the cache and
    // every piece of evidence.
    expect(documents.documents.length).toBeGreaterThan(0);
    const decodersByFormat = new Map<string, Set<string>>();
    for (const entry of documents.documents) {
      expect(entry.artifact_id.length).toBeGreaterThan(0);
      expect(entry.decoder_id.length).toBeGreaterThan(0);
      if (!entry.decoded) {
        expect(entry.format).toBeNull();
        expect(entry.block_count).toBeNull();
        continue;
      }
      expect(entry.normalized_document_id).not.toBeNull();
      expect(entry.format).not.toBeNull();
      expect(entry.block_count).toBeGreaterThanOrEqual(0);
      const decoders = decodersByFormat.get(entry.format as string) ?? new Set<string>();
      decoders.add(entry.decoder_id as string);
      decodersByFormat.set(entry.format as string, decoders);
    }
    // One decoder per format, and never one decoder for every format.
    for (const [, decoders] of decodersByFormat) expect(decoders.size).toBe(1);
    expect(documents.decoder_profiles.length).toBeGreaterThan(1);
  });

  it("writes one JSONL record per line, and a pack for every eligible candidate", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);

    const queue = fs.readFileSync(path.join(generation(f), "reasoning-candidates.jsonl"), "utf8")
      .split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));
    const packs = fs.readFileSync(path.join(generation(f), "reasoning-evidence-packs.jsonl"), "utf8")
      .split("\n").filter((line) => line.length > 0).map((line) => JSON.parse(line));

    const eligible = queue.filter((row) => row.reasoning_type !== "NONE");
    expect(packs).toHaveLength(eligible.length);
    for (const row of queue) {
      expect(row.schema).toBe("l9.reasoning-candidate/v1");
      expect(String(row.reason).length).toBeGreaterThan(0);
    }
  });

  it("reports zero model calls, because it makes none", () => {
    const f = fixture();
    const result = run(argsFor(f));
    expect(result.stdout).toContain("zero LLM calls");
    expect(result.stdout).toContain("embeddings       not enabled");
  });

  it("can be switched off, leaving the duplicate analysis in place", () => {
    const f = fixture();
    expect(run(argsFor(f, ["--no-semantic-analysis"])).status).toBe(0);

    const written = fs.readdirSync(generation(f)).sort();
    expect(written).not.toContain("topic-candidates.json");
    expect(written).not.toContain("reasoning-candidates.jsonl");
    // The document index is not part of the semantic pass and still lands.
    expect(written).toContain("document-index.json");
    expect(written).toContain("corpus-candidates.json");
  });

  it("keeps every mount point out of the semantic documents", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    for (const name of [
      "semantic-relations.json", "topic-candidates.json", "project-candidates.json",
      "consolidation-candidates.json", "reasoning-candidates.jsonl",
      "reasoning-evidence-packs.jsonl", "document-index.json",
    ]) {
      const text = fs.readFileSync(path.join(generation(f), name), "utf8");
      for (const root of f.roots) expect(text).not.toContain(root);
    }
  });
});

describe("the generational output layout", () => {
  it("switches the whole result set with one pointer, run after run", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    const first = JSON.parse(fs.readFileSync(path.join(f.out, "CURRENT.json"), "utf8"));
    const firstSnapshot = fs.readFileSync(path.join(generation(f), "corpus-snapshot.json"), "utf8");

    // A second run lands in a new generation, because its acquisition manifests
    // carry a wall clock and its output set is therefore genuinely different
    // bytes. The identity that must not move is the snapshot's, and it does not.
    fs.writeFileSync(path.join(f.corpus.oldSsd, "new-note.md"), "# New\n\nAdded.\n", "utf8");
    expect(run(argsFor(f)).status).toBe(0);
    const second = JSON.parse(fs.readFileSync(path.join(f.out, "CURRENT.json"), "utf8"));
    expect(second.generation_id).not.toBe(first.generation_id);
    expect(fs.readdirSync(path.join(f.out, "generations")).sort()).toHaveLength(2);

    // The previous generation is still on disk and still readable, byte for
    // byte. That is what makes the switch a switch rather than an overwrite: a
    // consumer part-way through reading the old one is not pulled out from
    // under, and an operator can compare the two directly.
    const previousDir = path.join(f.out, ...String(first.generation_ref).split("/"));
    expect(fs.readFileSync(path.join(previousDir, "corpus-snapshot.json"), "utf8"))
      .toBe(firstSnapshot);

    // And every file the pointer names is present, with the hash it promised.
    for (const entry of second.files as { path: string; content_hash: string }[]) {
      const absolute = path.join(generation(f), ...entry.path.split("/"));
      expect(fs.existsSync(absolute), entry.path).toBe(true);
      expect(sha256Of(fs.readFileSync(absolute, "utf8")), entry.path).toBe(entry.content_hash);
    }
  });

  it("keeps only the generations it was asked to keep", () => {
    const f = fixture();
    for (let i = 0; i < 4; i += 1) {
      fs.writeFileSync(
        path.join(f.corpus.oldSsd, `note-${i}.md`),
        `# Note ${i}\n\nDistinct content ${i}.\n`,
        "utf8",
      );
      expect(run(argsFor(f, ["--keep-generations", "2"])).status).toBe(0);
    }
    expect(fs.readdirSync(path.join(f.out, "generations"))).toHaveLength(2);
    // Pruning never touches the one in use.
    const current = JSON.parse(fs.readFileSync(path.join(f.out, "CURRENT.json"), "utf8"));
    expect(fs.existsSync(path.join(f.out, ...String(current.generation_ref).split("/")))).toBe(true);
    expect(fs.existsSync(path.join(generation(f), "corpus-snapshot.json"))).toBe(true);
  });

  it("finds the previous snapshot through the pointer, not at a fixed path", () => {
    const f = fixture();
    expect(run(argsFor(f)).status).toBe(0);
    fs.writeFileSync(path.join(f.corpus.oldSsd, "later.md"), "# Later\n\nAdded later.\n", "utf8");
    const second = run(argsFor(f));
    expect(second.status).toBe(0);

    // Nothing sits at <out>/corpus-snapshot.json any more, so a diff on the
    // second run proves the pointer was resolved rather than a path guessed.
    expect(fs.existsSync(path.join(f.out, "corpus-snapshot.json"))).toBe(false);
    const diff = JSON.parse(fs.readFileSync(path.join(generation(f), "corpus-diff.json"), "utf8"));
    expect(diff.counts.added).toBeGreaterThan(0);
  });
});

describe("the worker budgets", () => {
  it("refuses a flag it no longer acts on, rather than ignoring it", () => {
    const f = fixture();
    for (const flag of ["--max-hash-workers", "--max-analysis-workers", "--max-parallel-hashers"]) {
      const result = run(argsFor(f, [flag, "8"]));
      // Silently dropping it is how a decorative knob survives its own removal:
      // the invocation succeeds, the setting still does nothing, and now there
      // is not even a manifest field to notice it by.
      expect(result.status, flag).not.toBe(0);
      expect(result.stderr, flag).toContain("has been removed");
    }
  });

  it("still accepts the budgets it enforces, and records them", () => {
    const f = fixture();
    const result = run(argsFor(f, [
      "--max-decoder-workers", "3", "--max-memory-bytes", "67108864",
    ]));
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    const session = JSON.parse(
      fs.readFileSync(path.join(f.out, "session", "corpus-session.json"), "utf8"),
    );
    expect(session.budgets.max_parallel_decoders).toBe(3);
    expect(session.budgets.max_memory_bytes).toBe(67_108_864);
    // The manifest names only budgets the run was actually subject to.
    expect(session.budgets).not.toHaveProperty("max_parallel_hashers");
    expect(session.budgets).not.toHaveProperty("max_parallel_analysis");
  });
});

describe("the embedding guards", () => {
  it("refuse embeddings with no provider named", () => {
    const f = fixture();
    const result = run(argsFor(f, ["--embeddings"]));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--embedding-provider");
  });

  it("refuse a remote provider without the separate remote opt-in", () => {
    const f = fixture();
    const result = run(argsFor(f, [
      "--embeddings", "--embedding-provider", "acme", "--embedding-model", "m1",
      "--embedding-locality", "remote", "--embedding-endpoint", "https://acme.example.com",
    ]));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--allow-remote-embeddings");
  });

  it("refuse a remote endpoint that is not https", () => {
    const f = fixture();
    const result = run(argsFor(f, [
      "--embeddings", "--embedding-provider", "acme", "--embedding-model", "m1",
      "--embedding-locality", "remote", "--embedding-endpoint", "http://acme.example.com",
      "--allow-remote-embeddings",
    ]));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("https://");
  });

  it("name the one provider it can run, rather than accepting any name", () => {
    const f = fixture();
    const result = run(argsFor(f, [
      "--embeddings", "--embedding-provider", "acme", "--embedding-model", "m1",
    ]));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("http-json");
  });

  it("refuse a local provider pointed at a host that is not this machine", () => {
    const f = fixture();
    const result = run(argsFor(f, [
      "--embeddings", "--embedding-provider", "http-json", "--embedding-model", "m1",
      "--embedding-endpoint", "https://embeddings.example.com/v1",
    ]));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("loopback");
  });
});

describe("an embedding run through the CLI", () => {
  /**
   * A loopback server for the duration of one CLI invocation.
   *
   * The CLI runs in a child process, so nothing can be stubbed into it: this is
   * a real server on a real port, reached over a real socket by the script an
   * operator would run. That is the only way to prove `--embeddings` stopped
   * being a flag that fails.
   */
  async function withServer<T>(
    body: (url: string, seen: () => number) => Promise<T> | T,
  ): Promise<T> {
    let count = 0;
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        count += 1;
        const text = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input: string }).input;
        // A deterministic function of the text: enough for a cosine, not a model.
        const vector = new Array<number>(12).fill(0);
        for (const word of text.toLowerCase().split(/[^a-z0-9]+/)) {
          if (word.length < 3) continue;
          let hash = 0;
          for (const character of word) hash = (hash * 31 + character.charCodeAt(0)) % 100_003;
          vector[hash % 12] = (vector[hash % 12] as number) + 1;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ model: "toy-v1", embedding: vector }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      return await body(`http://127.0.0.1:${address.port}/embed`, () => count);
    } finally {
      server.close();
    }
  }

  it("embeds against a loopback server and reports what it sent", async () => {
    await withServer(async (url, seen) => {
      const f = fixture();
      const result = await runAsync(argsFor(f, [
        "--embeddings",
        "--embedding-provider", "http-json",
        "--embedding-model", "toy",
        "--embedding-endpoint", url,
        "--embedding-locality", "local",
        "--max-embedding-workers", "3",
      ]));
      expect(result.stderr).toBe("");
      expect(result.status).toBe(0);
      // The server was actually called. Without this the rest could pass on a
      // run that quietly embedded nothing.
      expect(seen()).toBeGreaterThan(0);

      expect(result.stdout).toContain("embedded");
      expect(result.stdout).toContain("local http-json");
      expect(result.stdout).toContain("bounded chunk(s)");
      expect(result.stdout).not.toContain("no model was called");

      const coverage = JSON.parse(
        fs.readFileSync(path.join(generation(f), "corpus-coverage.json"), "utf8"),
      );
      expect(coverage.embeddings.enabled).toBe(true);
      expect(coverage.embeddings.embedded_count).toBeGreaterThan(0);
      expect(coverage.embedding_coverage_when_enabled).not.toBeNull();

      // The model identity reaches the analysis identity, so two runs under two
      // models are two analyses of one snapshot rather than one contradictory
      // record.
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(generation(f), "corpus-snapshot.json"), "utf8"),
      );
      expect(snapshot.analysis.embedding_profile).not.toBeNull();

      // And still no mount point anywhere in the projections.
      const rendered = fs.readFileSync(path.join(generation(f), "corpus-coverage.json"), "utf8");
      for (const root of f.roots) expect(rendered).not.toContain(root);
    });
  });
});
