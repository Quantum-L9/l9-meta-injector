// corpus_candidate_diff.test.ts — the candidate delta, computed or refused.
//
// The diff used to emit `candidate_added: 0`, `candidate_removed: 0` and
// `candidate_changed: 0` unconditionally, beside a `comparable` flag. Nothing
// had been computed. Three zeros in fields a reader takes as measurements are
// worse than three missing fields, because they read as "nothing changed" to
// anyone who does not check the flag first.
//
// These tests pin both halves of the replacement. When both snapshots carry an
// analysis manifest the numbers are real and are made to move, one at a time, by
// actually adding, removing and editing documents. When either snapshot has no
// manifest the numbers are `null` with a stated reason — never zero, which is
// the substitution the contract names.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ANALYSIS_MANIFEST_VERSION,
  buildAnalysisManifest,
  diffAnalysisManifests,
} from "../src/corpus_analysis_manifest";
import { buildCorpusDiff } from "../src/corpus_diff";
import { runCorpusScan } from "../src/corpus_scan";

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-cand-diff-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

const BODY = [
  "The acquisition layer observes a local folder, an external drive or a zip archive",
  "and writes nothing into the source it reads. Archive members are staged into",
  "tool-owned scratch and carried as virtual artifacts, so the observed tree keeps",
  "exactly the bytes it had before the run started. Identity is derived from content",
  "and from root-relative paths, never from the mount point a disk was attached at.",
].join("\n");

function write(root: string, relative: string, contents: string): void {
  const absolute = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, contents, "utf8");
}

/** A corpus with an exact duplicate pair, a topic and a declared project. */
function baseCorpus(): string {
  const root = tmp();
  write(root, "plan.md", `---\ntitle: Storage Plan\nkind: plan\n---\n\n# Storage Plan\n\n${BODY}\n`);
  write(root, "copies/plan.md", `---\ntitle: Storage Plan\nkind: plan\n---\n\n# Storage Plan\n\n${BODY}\n`);
  write(root, "notes.md", `# Acquisition notes\n\n${BODY}\n`);
  write(
    root,
    "svc/package.json",
    `${JSON.stringify({ name: "acquisition-svc", version: "1.0.0" }, null, 2)}\n`,
  );
  write(root, "svc/README.md", "# acquisition-svc\n\nReads a disk without writing to it.\n");
  return root;
}

async function scan(root: string, previous?: Awaited<ReturnType<typeof runCorpusScan>>) {
  return runCorpusScan({
    // Named, because these tests compare one run against another and that is a
    // continuity claim. An operator doing longitudinal work names their roots;
    // the refusal that follows from not naming them is `corpus_root_history`'s
    // own subject and is tested there.
    roots: [{ path: root, name: "Corpus" }],
    producerVersion: "test",
    ...(previous !== undefined ? { previousSnapshot: previous.snapshot } : {}),
  });
}

describe("the analysis manifest a run writes into its snapshot", () => {
  it("names every candidate the run produced, with a payload hash", async () => {
    const result = await scan(baseCorpus());
    const manifest = result.snapshot.analysis_manifest;

    expect(manifest?.manifest_version).toBe(ANALYSIS_MANIFEST_VERSION);
    expect(manifest?.entries.length).toBeGreaterThan(0);
    // Every candidate in the projection is in the manifest, and nothing else is.
    const projected = new Set([
      ...result.candidates.exact_duplicate_clusters.map((c) => c.cluster_id),
      ...result.candidates.near_duplicate_candidates.map((c) => c.candidate_id),
      ...result.candidates.topic_candidates.map((c) => c.candidate_id),
      ...result.candidates.project_candidates.map((c) => c.candidate_id),
    ]);
    expect(new Set(manifest?.entries.map((entry) => entry.candidate_id))).toEqual(projected);
    for (const entry of manifest?.entries ?? []) {
      expect(entry.semantic_payload_hash).toMatch(/^candidate-payload:/);
    }
    expect(manifest?.counts.exact_duplicate_cluster).toBeGreaterThan(0);
    expect(manifest?.counts.project).toBeGreaterThan(0);
  });

  it("enters neither identity, because it is a conclusion and not a rule or a byte", async () => {
    const root = baseCorpus();
    const first = await scan(root);
    const second = await scan(root);

    // Same disk, same rules: both identities hold, and the manifest is identical
    // rather than merely equivalent.
    expect(second.snapshot.corpus_source_snapshot_id)
      .toBe(first.snapshot.corpus_source_snapshot_id);
    expect(second.snapshot.analysis.corpus_analysis_id)
      .toBe(first.snapshot.analysis.corpus_analysis_id);
    expect(second.snapshot.analysis_manifest).toEqual(first.snapshot.analysis_manifest);
  });
});

describe("the candidate delta between two runs", () => {
  it("counts a new candidate as added, and nothing else", async () => {
    const root = baseCorpus();
    const before = await scan(root);

    // A third byte-identical copy joins the existing duplicate cluster, and a
    // second package.json declaring the same name joins the project.
    write(root, "backup/plan.md", `---\ntitle: Storage Plan\nkind: plan\n---\n\n# Storage Plan\n\n${BODY}\n`);
    const after = await scan(root, before);

    const analysis = after.diff?.analysis;
    expect(analysis?.not_computed_reason).toBeNull();
    const kind = (name: string) => analysis?.by_kind.find((k) => k.candidate_kind === name);

    // Three candidate kinds move here, and they move differently, which is the
    // reason the delta is reported per kind rather than as one total.
    //
    // A duplicate cluster is keyed by its content hash, so gaining a member
    // leaves the same candidate carrying a different payload: changed.
    expect(kind("exact_duplicate_cluster")?.changed).toBe(1);
    expect(kind("exact_duplicate_cluster")?.added).toBe(0);

    // A near-duplicate candidate is keyed by its pair, so a third copy makes a
    // pair that did not exist before: added, with the existing two untouched.
    expect(kind("near_duplicate")?.added).toBe(1);
    expect(kind("near_duplicate")?.unchanged).toBe(2);
    expect(kind("near_duplicate")?.removed).toBe(0);

    // A topic candidate is keyed by its membership, so a new member re-keys it:
    // the old id is gone and a new one is present. Reported as one removed and
    // one added rather than as one changed, because that is what the ids say —
    // and a diff that quietly paired them would be guessing at continuity it
    // has no basis for.
    expect(kind("topic")?.added).toBe(1);
    expect(kind("topic")?.removed).toBe(1);

    // The declared project is untouched: its key is the manifest name.
    expect(kind("project")?.unchanged).toBe(1);
  });

  it("counts a vanished candidate as removed", async () => {
    const root = baseCorpus();
    const before = await scan(root);
    expect(before.candidates.exact_duplicate_clusters).toHaveLength(1);

    // Delete one half of the only duplicate pair: the cluster stops existing.
    fs.rmSync(path.join(root, "copies", "plan.md"));
    const after = await scan(root, before);

    const analysis = after.diff?.analysis;
    expect(analysis?.not_computed_reason).toBeNull();
    expect(analysis?.candidate_removed).toBeGreaterThan(0);
    const clusterKind = analysis?.by_kind.find((k) => k.candidate_kind === "exact_duplicate_cluster");
    expect(clusterKind?.removed).toBe(1);
    expect(after.candidates.exact_duplicate_clusters).toHaveLength(0);
  });

  it("counts a candidate whose membership moved as changed, not as added and removed", async () => {
    const root = baseCorpus();
    const before = await scan(root);

    // A new member joins the declared project. The project's identity is its
    // declared key, so the candidate survives with a different payload.
    write(root, "svc/lib/hash.js", "'use strict';\nexports.sha256 = () => 'x';\n");
    const after = await scan(root, before);

    const analysis = after.diff?.analysis;
    expect(analysis?.not_computed_reason).toBeNull();
    const projectKind = analysis?.by_kind.find((k) => k.candidate_kind === "project");
    expect(projectKind?.changed).toBe(1);
    expect(projectKind?.added ?? 0).toBe(0);
    expect(projectKind?.removed ?? 0).toBe(0);
  });

  it("reports every count as zero only when the corpus genuinely did not move", async () => {
    const root = baseCorpus();
    const before = await scan(root);
    const after = await scan(root, before);

    const analysis = after.diff?.analysis;
    // Here the zeros are earned: both manifests exist, they were compared, and
    // nothing differed. `candidate_unchanged` above zero is what distinguishes
    // this from a comparison that never happened.
    expect(analysis?.not_computed_reason).toBeNull();
    expect(analysis?.candidate_added).toBe(0);
    expect(analysis?.candidate_removed).toBe(0);
    expect(analysis?.candidate_changed).toBe(0);
    expect(analysis?.candidate_unchanged).toBeGreaterThan(0);
    expect(analysis?.comparable).toBe(true);
  });
});

describe("a comparison that cannot be made", () => {
  it("reports null with a reason when the previous snapshot predates manifests", async () => {
    const root = baseCorpus();
    const before = await scan(root);
    const after = await scan(root);

    // A snapshot from an earlier release: same document, no manifest in it.
    const legacy = { ...before.snapshot };
    delete legacy.analysis_manifest;

    const diff = buildCorpusDiff(legacy, after.snapshot);
    expect(diff.analysis.candidate_added).toBeNull();
    expect(diff.analysis.candidate_removed).toBeNull();
    expect(diff.analysis.candidate_changed).toBeNull();
    expect(diff.analysis.candidate_unchanged).toBeNull();
    expect(diff.analysis.not_computed_reason).toContain("predates the analysis manifest");
    expect(diff.analysis.by_kind).toEqual([]);
  });

  it("refuses to compare payload hashes from two manifest definitions", () => {
    const manifest = buildAnalysisManifest({
      exactDuplicateClusters: [{ cluster_id: "c1", content_hash: "h", artifact_ids: ["a", "b"] }],
      nearDuplicates: [], topics: [], projects: [],
    });
    const older = { ...manifest, manifest_version: "0.9.0" };

    const delta = diffAnalysisManifests(older, manifest);
    // Comparing across definitions would report every candidate as changed,
    // which is a worse answer than "this cannot be compared".
    expect(delta.candidate_changed).toBeNull();
    expect(delta.not_computed_reason).toContain("manifest versions differ");
  });

  it("never substitutes zero for a count it did not compute", () => {
    const manifest = buildAnalysisManifest({
      exactDuplicateClusters: [], nearDuplicates: [], topics: [], projects: [],
    });
    for (const [previous, current] of [
      [undefined, manifest],
      [manifest, undefined],
      [undefined, undefined],
      [null, manifest],
    ] as const) {
      const delta = diffAnalysisManifests(previous, current);
      expect(delta.candidate_added).toBeNull();
      expect(delta.candidate_removed).toBeNull();
      expect(delta.candidate_changed).toBeNull();
      expect(delta.not_computed_reason).not.toBeNull();
    }

    // And an empty manifest on both sides is a real comparison of nothing,
    // which is zeros rather than nulls: the distinction the whole file is about.
    const real = diffAnalysisManifests(manifest, manifest);
    expect(real.candidate_added).toBe(0);
    expect(real.not_computed_reason).toBeNull();
  });
});

describe("what counts as a changed candidate", () => {
  const cluster = (ids: string[]) => ({
    exactDuplicateClusters: [{ cluster_id: "c1", content_hash: "h1", artifact_ids: ids }],
    nearDuplicates: [], topics: [], projects: [],
  });

  it("ignores the order members were written down in", () => {
    const a = buildAnalysisManifest(cluster(["x", "y", "z"]));
    const b = buildAnalysisManifest(cluster(["z", "x", "y"]));
    expect(diffAnalysisManifests(a, b).candidate_changed).toBe(0);
    expect(diffAnalysisManifests(a, b).candidate_unchanged).toBe(1);
  });

  it("notices a member joining or leaving", () => {
    const a = buildAnalysisManifest(cluster(["x", "y"]));
    const b = buildAnalysisManifest(cluster(["x", "y", "z"]));
    expect(diffAnalysisManifests(a, b).candidate_changed).toBe(1);
  });

  it("compares a score at the precision the report shows it", () => {
    const near = (score: number) => buildAnalysisManifest({
      exactDuplicateClusters: [], topics: [], projects: [],
      nearDuplicates: [{ candidate_id: "n1", artifact_a_id: "a", artifact_b_id: "b", score }],
    });
    // Six places is what a rendered candidate carries, so a difference below it
    // is a difference nobody can see and must not be reported as a change.
    expect(diffAnalysisManifests(near(0.871234), near(0.8712344)).candidate_changed).toBe(0);
    expect(diffAnalysisManifests(near(0.871234), near(0.871235)).candidate_changed).toBe(1);
  });
});
