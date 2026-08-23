// corpus_verification.test.ts — what a content hash in a snapshot actually claims.
//
// A corpus of several drives cannot rehash hundreds of gigabytes on every run,
// and filesystem timestamps cannot quietly become the truth instead. The way out
// is not a cleverer heuristic, it is a label: an incremental run may carry a
// previous run's hash forward, and it must say that it did, because a hash that
// was read from a record and a hash that was read from the bytes support
// different claims. These tests are about the label as much as the reuse.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { CorpusSnapshot } from "../src/corpus_snapshot";
import { runCorpusScan } from "../src/corpus_scan";

const scratch: string[] = [];
function tmp(prefix = "l9-verify-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function root(): string {
  const dir = path.join(tmp(), "disk");
  fs.mkdirSync(path.join(dir, "notes"), { recursive: true });
  fs.writeFileSync(path.join(dir, "notes", "monday.md"), "# Monday\nThe ingest plan.\n", "utf8");
  fs.writeFileSync(path.join(dir, "notes", "tuesday.md"), "# Tuesday\nThe routing plan.\n", "utf8");
  fs.writeFileSync(path.join(dir, "README.md"), "# Disk\nA small corpus root.\n", "utf8");
  return dir;
}

async function scan(
  dir: string,
  options: { previousSnapshot?: CorpusSnapshot; incremental?: boolean; verifyContent?: boolean } = {},
) {
  return runCorpusScan({
    roots: [{ path: dir, name: "disk" }],
    producerVersion: "test",
    ...(options.previousSnapshot ? { previousSnapshot: options.previousSnapshot } : {}),
    ...(options.incremental === true ? { verification: "incremental" as const } : {}),
    ...(options.verifyContent === true ? { verifyContent: true } : {}),
  });
}

/** Rewrite a file and move its mtime forward, as an ordinary edit would. */
function edit(file: string, contents: string): void {
  fs.writeFileSync(file, contents, "utf8");
  const later = new Date(Date.now() + 5_000);
  fs.utimesSync(file, later, later);
}

describe("full verification", () => {
  it("reads every byte and says so", async () => {
    const result = await scan(root());
    const verification = result.snapshot.verification;
    expect(verification.mode).toBe("full");
    expect(verification.verification_class).toBe("fully_verified");
    expect(verification.cached_hash_reuse_count).toBe(0);
    expect(verification.fully_rehashed_artifact_count).toBe(3);
    expect(verification.statement).toMatch(/read in full on this run/);
  });

  it("ignores a previous snapshot's hashes even when one is supplied", async () => {
    const dir = root();
    const first = await scan(dir);
    const second = await scan(dir, { previousSnapshot: first.snapshot });
    // Full mode is the default and is not negotiable by the presence of history.
    expect(second.snapshot.verification.cached_hash_reuse_count).toBe(0);
    expect(second.snapshot.verification.verification_class).toBe("fully_verified");
  });
});

describe("incremental verification", () => {
  it("reuses an eligible prior hash and refuses to call the result verified", async () => {
    const dir = root();
    const first = await scan(dir);
    const second = await scan(dir, { previousSnapshot: first.snapshot, incremental: true });

    expect(second.snapshot.verification.mode).toBe("incremental");
    expect(second.snapshot.verification.cached_hash_reuse_count).toBe(3);
    expect(second.snapshot.verification.fully_rehashed_artifact_count).toBe(0);
    // The label is the point: a stat-assisted scan is never fully_verified.
    expect(second.snapshot.verification.verification_class).toBe("cached_unchanged_assumption");
    expect(second.snapshot.verification.statement).toMatch(/not byte-verified/);

    // Reuse is only worth having if it produces the same answer.
    expect(second.snapshot.corpus_source_snapshot_id)
      .toBe(first.snapshot.corpus_source_snapshot_id);
  });

  it("has nothing to reuse without a previous snapshot, and does not pretend otherwise", async () => {
    const result = await scan(root(), { incremental: true });
    expect(result.snapshot.verification.mode).toBe("incremental");
    expect(result.snapshot.verification.cached_hash_reuse_count).toBe(0);
    // Reuse count decides the class, not the mode that was requested.
    expect(result.snapshot.verification.verification_class).toBe("fully_verified");
  });

  it("rereads a file whose size moved", async () => {
    const dir = root();
    const first = await scan(dir);
    const file = path.join(dir, "notes", "monday.md");
    // Same mtime, different length: size alone must invalidate.
    const stat = fs.statSync(file);
    fs.writeFileSync(file, "# Monday\nThe ingest plan, extended.\n", "utf8");
    fs.utimesSync(file, stat.atime, stat.mtime);

    const second = await scan(dir, { previousSnapshot: first.snapshot, incremental: true });
    expect(second.snapshot.verification.fully_rehashed_artifact_count).toBe(1);
    expect(second.snapshot.verification.cached_hash_reuse_count).toBe(2);
    const changed = second.snapshot.artifacts.find((a) => a.root_relative_path === "notes/monday.md");
    const before = first.snapshot.artifacts.find((a) => a.root_relative_path === "notes/monday.md");
    expect(changed?.content_hash).not.toBe(before?.content_hash);
  });

  it("rereads a file whose mtime moved, even at the same length", async () => {
    const dir = root();
    const first = await scan(dir);
    // Exactly the same length, so only the timestamp can catch this.
    edit(path.join(dir, "notes", "monday.md"), "# Monday\nThe egress plan.\n");

    const second = await scan(dir, { previousSnapshot: first.snapshot, incremental: true });
    expect(second.snapshot.verification.fully_rehashed_artifact_count).toBe(1);
    expect(second.snapshot.verification.cached_hash_reuse_count).toBe(2);
    expect(second.snapshot.corpus_source_snapshot_id)
      .not.toBe(first.snapshot.corpus_source_snapshot_id);
  });

  it("does not carry a hash across to a file that was not there before", async () => {
    const dir = root();
    const first = await scan(dir);
    fs.writeFileSync(path.join(dir, "notes", "wednesday.md"), "# Wednesday\nA new note.\n", "utf8");

    const second = await scan(dir, { previousSnapshot: first.snapshot, incremental: true });
    expect(second.snapshot.verification.fully_rehashed_artifact_count).toBe(1);
    expect(second.snapshot.verification.cached_hash_reuse_count).toBe(3);
  });
});

describe("--verify-content", () => {
  it("outranks incremental and restores a fully verified snapshot", async () => {
    const dir = root();
    const first = await scan(dir);
    const assumed = await scan(dir, { previousSnapshot: first.snapshot, incremental: true });
    expect(assumed.snapshot.verification.verification_class).toBe("cached_unchanged_assumption");

    const verified = await scan(dir, {
      previousSnapshot: first.snapshot,
      incremental: true,
      verifyContent: true,
    });
    expect(verified.snapshot.verification.verify_content_requested).toBe(true);
    expect(verified.snapshot.verification.cached_hash_reuse_count).toBe(0);
    expect(verified.snapshot.verification.verification_class).toBe("fully_verified");
    expect(verified.snapshot.corpus_source_snapshot_id)
      .toBe(first.snapshot.corpus_source_snapshot_id);
  });
});

describe("coverage", () => {
  it("discloses the hashing split beside the corpus denominators", async () => {
    const dir = root();
    const first = await scan(dir);
    const second = await scan(dir, { previousSnapshot: first.snapshot, incremental: true });

    const hashing = second.coverage.hashing;
    expect(hashing.verification_mode).toBe("incremental");
    expect(hashing.verification_class).toBe("cached_unchanged_assumption");
    expect(hashing.cached_hash_reuse_count).toBe(3);
    expect(hashing.fully_rehashed_count + hashing.cached_hash_reuse_count + hashing.unhashed_count)
      .toBe(second.coverage.corpus.total_physical_artifacts);

    // Every denominator the contract asks for is present, not merely the counts.
    expect(second.coverage.corpus.root_count_requested).toBe(1);
    expect(second.coverage.corpus.root_count_observed).toBe(1);
    expect(second.coverage.corpus.root_count_failed).toBe(0);
    expect(second.coverage.documents.decoder_eligible_count).toBeGreaterThan(0);
    expect(second.coverage.embeddings.enabled).toBe(false);
    expect(second.coverage.embeddings.eligible_count).toBeNull();
  });
});
