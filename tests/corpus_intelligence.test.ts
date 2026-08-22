// corpus_intelligence.test.ts — duplicates, candidates, and the corpus projection.
//
// The line these tests police is the one between a fact and an estimate. Exact
// duplicates are byte equality and are stated as such. Near-duplicate candidates
// are a lexical score, and every assertion about them here is about what they do
// NOT claim as much as what they do: they never become a DUPLICATE_OF edge, they
// never absorb an exact duplicate, and the report is forbidden from describing
// them in the vocabulary of topic, project, merging or deletion.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  CORPUS_INDEX_SCHEMA,
  DEFAULT_NEAR_DUPLICATE_THRESHOLD,
  NEAR_DUPLICATE_METHOD,
  analysisTokens,
  jaccard,
  nearDuplicateCandidates,
  nearDuplicateCandidatesExhaustive,
  normalizeForAnalysis,
  prepareNearDuplicateDocument,
  shingleSet,
  type CorpusIndex,
  type NearDuplicateDocument,
} from "../src/corpus_analysis";
import { renderCorpusReport } from "../src/corpus_report";
import {
  buildLocalSourceCorpus,
  observeLocalSourceModel,
  writeLocalSourceCorpus,
  type LocalSourceCorpusOutputs,
} from "../src/local_source_model";
import { acquireLocalSource } from "../src/local_source";
import { repositoryModelArtifactId } from "../src/repository_model";
import { ARCHIVE_MEMBER_PATHS, writeCorpusFixture } from "./helpers/corpus_fixtures";
import { treeSnapshot, writeRawZip } from "./helpers/zip_fixtures";

const PRODUCER_VERSION = "4.0.0";

const scratchDirs: string[] = [];
function tmp(prefix = "l9-corpus-"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

interface CorpusRun {
  index: CorpusIndex;
  outputs: LocalSourceCorpusOutputs;
  packetArtifactIds: Set<string>;
  packetAssertionIds: Set<string>;
}

/** Observe a source and project it, disposing the staging root afterwards. */
function analyze(sourcePath: string, options: { name?: string; threshold?: number; nearDuplicates?: boolean } = {}): CorpusRun {
  const result = observeLocalSourceModel({
    path: sourcePath,
    name: options.name ?? "corpus",
    producerVersion: PRODUCER_VERSION,
  });
  try {
    const outputs = buildLocalSourceCorpus(result, {
      nearDuplicates: {
        enabled: options.nearDuplicates !== false,
        ...(options.threshold !== undefined ? { threshold: options.threshold } : {}),
      },
    });
    return {
      index: outputs.index,
      outputs,
      packetArtifactIds: new Set(result.packet.payload.artifacts.map((a) => a.artifact_id)),
      packetAssertionIds: new Set(result.packet.payload.assertions.map((a) => a.assertion_id)),
    };
  } finally {
    result.observation.dispose();
  }
}

/** The canonical fixture corpus, written into a fresh root. */
function fixtureCorpus(prefix = "l9-corpus-fixture-"): string {
  return writeCorpusFixture(path.join(tmp(prefix), "corpus"));
}

function clusterPaths(index: CorpusIndex): string[][] {
  return index.exact_duplicate_clusters.map((cluster) => [...cluster.source_paths]);
}

function candidatePaths(index: CorpusIndex): string[][] {
  return index.near_duplicate_candidates.map((candidate) => [candidate.source_path_a, candidate.source_path_b]);
}

// ───────────────────────────── exact duplicates ─────────────────────────────

describe("exact duplicate clusters", () => {
  it("clusters two physical files with identical bytes", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "identical bytes\n");
    fs.writeFileSync(path.join(root, "b.md"), "identical bytes\n");
    fs.writeFileSync(path.join(root, "c.md"), "different bytes\n");
    expect(clusterPaths(analyze(root).index)).toEqual([["a.md", "b.md"]]);
  });

  it("clusters a physical file with an archive member holding the same bytes", () => {
    const index = analyze(fixtureCorpus()).index;
    expect(clusterPaths(index)).toContainEqual([ARCHIVE_MEMBER_PATHS.copyOfNotes, "notes.txt"]);
  });

  it("clusters two members of one archive with each other", () => {
    const root = tmp();
    writeRawZip(path.join(root, "bundle.zip"), [
      { name: "one.md", content: "shared member bytes\n", stored: true },
      { name: "nested/two.md", content: "shared member bytes\n", stored: true },
      { name: "three.md", content: "other bytes\n", stored: true },
    ]);
    expect(clusterPaths(analyze(root).index))
      .toEqual([["bundle.zip!/nested/two.md", "bundle.zip!/one.md"]]);
  });

  it("clusters a nested archive member with a physical file and with another nested member", () => {
    const root = tmp();
    const build = tmp("l9-corpus-build-");
    const inner = path.join(build, "inner.zip");
    writeRawZip(inner, [
      { name: "deep-a.md", content: "deep shared bytes\n", stored: true },
      { name: "deep-b.md", content: "deep shared bytes\n", stored: true },
      { name: "surface.md", content: "surface shared bytes\n", stored: true },
    ]);
    fs.writeFileSync(path.join(root, "surface.md"), "surface shared bytes\n");
    writeRawZip(path.join(root, "outer.zip"), [
      { name: "inner.zip", content: fs.readFileSync(inner), stored: true },
    ]);

    expect(clusterPaths(analyze(root).index).sort()).toEqual([
      ["outer.zip!/inner.zip!/deep-a.md", "outer.zip!/inner.zip!/deep-b.md"],
      ["outer.zip!/inner.zip!/surface.md", "surface.md"],
    ].sort());
  });

  it("renders one relation per non-representative member, not every pair", () => {
    const root = tmp();
    for (const name of ["a.md", "bb.md", "ccc.md"]) {
      fs.writeFileSync(path.join(root, name), "three copies\n");
    }
    const index = analyze(root).index;
    expect(index.exact_duplicate_clusters).toHaveLength(1);
    const cluster = index.exact_duplicate_clusters[0];
    expect(cluster.count).toBe(3);
    // A three-member cluster has three equivalent pairs; the star rendering emits
    // two edges and carries the cluster id so the equivalence is not misread as
    // hub-and-spoke.
    expect(index.relations).toHaveLength(2);
    for (const relation of index.relations) {
      expect(relation.type).toBe("DUPLICATE_OF");
      expect(relation.target_artifact_id).toBe(cluster.representative_artifact_id);
      expect(relation.duplicate_cluster_id).toBe(cluster.cluster_id);
      expect(relation.symmetric).toBe(true);
    }
  });

  it("treats identical bytes under different names as duplicates", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "plan.md"), "same content\n");
    fs.writeFileSync(path.join(root, "totally-different-name.md"), "same content\n");
    expect(analyze(root).index.exact_duplicate_clusters).toHaveLength(1);
  });

  it("does not treat identical names with different bytes as duplicates", () => {
    const root = tmp();
    fs.mkdirSync(path.join(root, "one"));
    fs.mkdirSync(path.join(root, "two"));
    fs.writeFileSync(path.join(root, "one", "plan.md"), "first content\n");
    fs.writeFileSync(path.join(root, "two", "plan.md"), "second content\n");
    expect(analyze(root).index.exact_duplicate_clusters).toEqual([]);
  });

  it("chooses the representative deterministically and calls it nothing more", () => {
    const root = tmp();
    for (const name of ["zz.md", "a.md", "mmmm.md"]) {
      fs.writeFileSync(path.join(root, name), "pick one\n");
    }
    const cluster = analyze(root).index.exact_duplicate_clusters[0];
    // Shortest path, then code point. A rendering anchor, not a keeper.
    expect(cluster.representative_source_path).toBe("a.md");
    expect(Object.keys(cluster)).not.toContain("keeper");
    expect(JSON.stringify(cluster).toLowerCase()).not.toContain("keeper");
  });

  it("keeps cluster identity content-bound across absolute roots", () => {
    const write = (root: string): string => {
      fs.writeFileSync(path.join(root, "a.md"), "portable bytes\n");
      fs.writeFileSync(path.join(root, "b.md"), "portable bytes\n");
      return root;
    };
    const first = analyze(write(tmp("l9-corpus-abs-a-"))).index.exact_duplicate_clusters;
    const second = analyze(write(tmp("l9-corpus-abs-b-"))).index.exact_duplicate_clusters;
    expect(first).toEqual(second);
  });

  it("populates acquisition duplicates whenever a hash repeats", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "notes.txt"), "repeated bytes\n");
    writeRawZip(path.join(root, "bundle.zip"), [
      { name: "copy-of-notes.txt", content: "repeated bytes\n", stored: true },
    ]);
    const observation = acquireLocalSource({ path: root, name: "corpus" });
    try {
      // Acquisition used to hand back an empty duplicate set, which meant a file
      // and its copy inside an archive were never seen as the same bytes.
      expect(observation.inventory.duplicates).toHaveLength(1);
      expect([...observation.inventory.duplicates[0].paths].sort())
        .toEqual(["bundle.zip!/copy-of-notes.txt", "notes.txt"]);
    } finally {
      observation.dispose();
    }
  });
});

// ───────────────────────────── near-duplicate algorithm ─────────────────────────────

describe("near-duplicate scoring", () => {
  function document(id: string, text: string): NearDuplicateDocument {
    return prepareNearDuplicateDocument({
      artifactId: `artifact:${id}`,
      sourcePath: `${id}.md`,
      contentHash: `sha256:${crypto.createHash("sha256").update(text).digest("hex")}`,
      text,
    });
  }

  const LONG = Array.from({ length: 40 }, (_, index) => `sentence ${index} about the acquisition layer`).join("\n");

  it("normalizes line endings, case and whitespace, and nothing else", () => {
    expect(normalizeForAnalysis("A\r\nB\r  C \n")).toBe("a b c");
    expect(analysisTokens(normalizeForAnalysis("Alpha, beta_9!"))).toEqual(["alpha", "beta_9"]);
    expect([...shingleSet(["a", "b", "c", "d", "e", "f"])]).toEqual(["a b c d e", "b c d e f"]);
  });

  it("scores an exact Jaccard over unique shingles", () => {
    const left = new Set(["x", "y", "z"]);
    const right = new Set(["y", "z", "w"]);
    expect(jaccard(left, right)).toEqual({ score: 0.5, shared: 2, union: 4 });
    expect(jaccard(new Set(), new Set())).toEqual({ score: 0, shared: 0, union: 0 });
  });

  it("reports whitespace-only variation as near-identical", () => {
    const pair = [document("a", LONG), document("b", LONG.replace(/\n/g, "\n\n  "))];
    const candidates = nearDuplicateCandidates(pair, DEFAULT_NEAR_DUPLICATE_THRESHOLD);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].score).toBe(1);
    expect(candidates[0].normalized_content_hash_a).toBe(candidates[0].normalized_content_hash_b);
  });

  it("excludes byte-identical documents from candidacy", () => {
    const candidates = nearDuplicateCandidates([document("a", LONG), document("b", LONG)], 0);
    expect(candidates).toEqual([]);
  });

  it("keeps unrelated documents below the threshold", () => {
    const other = Array.from({ length: 40 }, (_, index) => `line ${index} regarding coffee rota logistics`).join("\n");
    expect(nearDuplicateCandidates([document("a", LONG), document("b", other)], DEFAULT_NEAR_DUPLICATE_THRESHOLD))
      .toEqual([]);
  });

  it("does not make a shared title alone into a candidate", () => {
    const heading = "# Deployment Roadmap\n\n";
    const first = `${heading}${LONG}`;
    const second = `${heading}${Array.from({ length: 40 }, (_, i) => `unrelated remark ${i} about the kitchen`).join("\n")}`;
    expect(nearDuplicateCandidates([document("a", first), document("b", second)], DEFAULT_NEAR_DUPLICATE_THRESHOLD))
      .toEqual([]);
  });

  it("matches the exhaustive reference implementation", () => {
    const documents = [
      document("a", LONG),
      document("b", `${LONG}\nan extra closing sentence`),
      document("c", LONG.replace("sentence 7", "clause 7")),
      document("d", Array.from({ length: 40 }, (_, i) => `wholly other content ${i}`).join("\n")),
      document("e", `${LONG}\n${LONG}`),
    ];
    for (const threshold of [0, 0.1, 0.5, 0.85, 0.99, 1]) {
      expect(nearDuplicateCandidates(documents, threshold), `threshold ${threshold}`)
        .toEqual(nearDuplicateCandidatesExhaustive(documents, threshold));
    }
  });

  it("orders candidates and their pairs deterministically", () => {
    const documents = [
      document("zeta", LONG),
      document("alpha", `${LONG}\nsmall tail`),
      document("mid", `${LONG}\nother tail`),
    ];
    const forward = nearDuplicateCandidates(documents, 0.5);
    const reversed = nearDuplicateCandidates([...documents].reverse(), 0.5);
    expect(forward).toEqual(reversed);
    for (const candidate of forward) {
      expect(candidate.artifact_a_id < candidate.artifact_b_id).toBe(true);
      expect(candidate.method).toBe(NEAR_DUPLICATE_METHOD);
    }
  });
});

// ───────────────────────────── near-duplicates over a corpus ─────────────────────────────

describe("near-duplicate candidates over the fixture corpus", () => {
  it("finds the revised plan and reports it as a candidate, not a duplicate", () => {
    const index = analyze(fixtureCorpus()).index;
    expect(candidatePaths(index)).toContainEqual(["revised-plan.md", "plan.md"]);
    // The revision is not byte-identical to anything, so it is in no cluster.
    const revised = index.artifacts.find((a) => a.source_path === "revised-plan.md");
    expect(revised?.exact_duplicate_cluster_id).toBeNull();
    expect(revised?.near_duplicate_candidate_ids.length).toBeGreaterThan(0);
    // And the unrelated document is not dragged in.
    expect(candidatePaths(index).flat()).not.toContain("unrelated.md");
  });

  it("compares an archive member against a physical file", () => {
    const root = tmp();
    const body = Array.from({ length: 40 }, (_, i) => `paragraph ${i} of the shared draft`).join("\n");
    fs.writeFileSync(path.join(root, "surface.md"), `${body}\n`);
    writeRawZip(path.join(root, "bundle.zip"), [
      { name: "packed.md", content: `${body}\nplus one closing line\n`, stored: true },
    ]);
    expect(candidatePaths(analyze(root).index)).toEqual([["bundle.zip!/packed.md", "surface.md"]]);
  });

  it("keeps candidate identity stable across absolute roots", () => {
    const first = analyze(fixtureCorpus("l9-corpus-cand-a-")).index.near_duplicate_candidates;
    const second = analyze(fixtureCorpus("l9-corpus-cand-b-")).index.near_duplicate_candidates;
    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(0);
  });

  it("binds the threshold into the analysis profile without touching packet identity", () => {
    const root = fixtureCorpus("l9-corpus-threshold-");
    const strict = analyze(root, { threshold: 0.99 }).index;
    const loose = analyze(root, { threshold: 0.5 }).index;

    // The packet describes the observation; the threshold describes the analysis.
    expect(strict.repository_model.semantic_hash).toBe(loose.repository_model.semantic_hash);
    expect(strict.analysis_profile.corpus_profile_hash)
      .not.toBe(loose.analysis_profile.corpus_profile_hash);
    expect(strict.near_duplicate_candidates.length)
      .toBeLessThan(loose.near_duplicate_candidates.length);
  });

  it("still reports exact duplicates when similarity analysis is disabled", () => {
    const root = fixtureCorpus("l9-corpus-disabled-");
    const index = analyze(root, { nearDuplicates: false }).index;
    expect(index.analysis_profile.near_duplicate_enabled).toBe(false);
    expect(index.near_duplicate_candidates).toEqual([]);
    expect(index.exact_duplicate_clusters.length).toBeGreaterThan(0);
    expect(index.diagnostics.near_duplicate_excluded).toEqual([{ reason: "analysis_disabled", count: 1 }]);
  });

  it("rejects a threshold outside the unit interval rather than clamping it", () => {
    const root = tmp();
    fs.writeFileSync(path.join(root, "a.md"), "content\n");
    expect(() => analyze(root, { threshold: 1.5 })).toThrow(/within \[0, 1\]/);
  });
});

// ───────────────────────────── the corpus index ─────────────────────────────

describe("corpus index", () => {
  it("declares its schema and binds the packet it projects", () => {
    const run = analyze(fixtureCorpus());
    expect(run.index.schema).toBe(CORPUS_INDEX_SCHEMA);
    expect(run.index.repository_model.packet_version).toBe("1.1.0");
    expect(run.index.repository_model.interpretation_profile?.profile_version).toBe("1.1.0");
    expect(run.index.analysis_profile.near_duplicate_threshold).toBe(DEFAULT_NEAR_DUPLICATE_THRESHOLD);
  });

  it("resolves every reference it makes", () => {
    const run = analyze(fixtureCorpus());
    const artifactIds = new Set(run.index.artifacts.map((a) => a.artifact_id));

    for (const artifact of run.index.artifacts) {
      expect(run.packetArtifactIds.has(artifact.artifact_id), artifact.source_path).toBe(true);
      for (const assertionId of artifact.assertion_ids) {
        expect(run.packetAssertionIds.has(assertionId)).toBe(true);
      }
    }
    for (const signal of run.index.work_signals) {
      expect(run.packetAssertionIds.has(signal.assertion_id)).toBe(true);
      expect(artifactIds.has(signal.artifact_id)).toBe(true);
    }
    for (const cluster of run.index.exact_duplicate_clusters) {
      expect(artifactIds.has(cluster.representative_artifact_id)).toBe(true);
      for (const id of cluster.artifact_ids) expect(artifactIds.has(id)).toBe(true);
    }
    for (const relation of run.index.relations) {
      expect(artifactIds.has(relation.source_artifact_id)).toBe(true);
      expect(artifactIds.has(relation.target_artifact_id)).toBe(true);
    }
    for (const candidate of run.index.near_duplicate_candidates) {
      expect(artifactIds.has(candidate.artifact_a_id)).toBe(true);
      expect(artifactIds.has(candidate.artifact_b_id)).toBe(true);
    }
  });

  it("counts the fixture corpus the way the fixture declares itself", () => {
    const summary = analyze(fixtureCorpus()).index.summary;
    expect(summary).toMatchObject({
      archive_count: 2,
      archive_member_count: 4,
      exact_duplicate_cluster_count: 2,
      exact_duplicate_artifact_count: 4,
      near_duplicate_candidate_count: 2,
      wip_count: 3,
      draft_count: 1,
      blocked_count: 1,
      roadmap_count: 1,
    });
    expect(summary.plan_count).toBeGreaterThanOrEqual(3);
    expect(summary.open_task_count).toBeGreaterThanOrEqual(2);
    expect(summary.milestone_count).toBeGreaterThanOrEqual(3);
    expect(summary.artifacts_with_work_signals).toBeGreaterThan(0);
  });

  it("carries the work state each fixture document declares", () => {
    const index = analyze(fixtureCorpus()).index;
    const byPath = new Map(index.artifacts.map((a) => [a.source_path, a]));

    expect(byPath.get("plan.md")?.work_signal_summary).toMatchObject({
      statuses: ["wip"],
      kinds: ["plan"],
      titles: ["Corpus Intelligence Plan"],
      depends_on: ["notes.txt"],
    });
    expect(byPath.get("plan.md")?.work_signal_summary.open_task_count).toBeGreaterThanOrEqual(2);
    expect(byPath.get("roadmap.md")?.work_signal_summary).toMatchObject({ kinds: ["roadmap"] });
    expect(byPath.get("roadmap.md")?.work_signal_summary.milestone_count).toBeGreaterThanOrEqual(2);
    expect(byPath.get("nested/blocked-work.md")?.work_signal_summary).toMatchObject({
      statuses: ["blocked"],
      blocked_by: ["the corpus index is not emitted yet"],
    });
    expect(byPath.get(ARCHIVE_MEMBER_PATHS.nestedDraft)?.work_signal_summary.statuses).toEqual(["draft"]);
    expect(byPath.get(ARCHIVE_MEMBER_PATHS.nestedDraft)?.is_archive_member).toBe(true);
    expect(byPath.get(ARCHIVE_MEMBER_PATHS.oldPlan)?.work_signal_summary.superseded_by).toEqual(["plan.md"]);
    expect(byPath.get("revised-plan.md")?.work_signal_summary.supersedes).toEqual(["plan.md"]);
  });

  it("re-renders byte for byte from the same content at a different absolute root", () => {
    const first = analyze(fixtureCorpus("l9-corpus-replay-a-")).outputs;
    const second = analyze(fixtureCorpus("l9-corpus-replay-b-")).outputs;
    expect(first.indexJson).toBe(second.indexJson);
    expect(first.report).toBe(second.report);
  });

  it("serializes with code-point key ordering at every depth", () => {
    const outputs = analyze(fixtureCorpus()).outputs;
    const parsed = JSON.parse(outputs.indexJson) as unknown;
    const checkKeys = (value: unknown): void => {
      if (Array.isArray(value)) return value.forEach(checkKeys);
      if (value === null || typeof value !== "object") return;
      const keys = Object.keys(value as Record<string, unknown>);
      expect(keys).toEqual([...keys].sort());
      for (const key of keys) checkKeys((value as Record<string, unknown>)[key]);
    };
    checkKeys(parsed);
    expect(outputs.indexJson.endsWith("\n")).toBe(true);
  });

  it("carries no wall clock and no machine path", () => {
    const outputs = analyze(fixtureCorpus()).outputs;
    for (const rendered of [outputs.indexJson, outputs.report]) {
      expect(rendered).not.toContain(os.tmpdir());
      expect(rendered).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
      expect(rendered).not.toContain(".l9-scratch-owner");
    }
  });
});

// ───────────────────────────── the corpus report ─────────────────────────────

describe("corpus report", () => {
  it("renders every required section", () => {
    const report = analyze(fixtureCorpus()).outputs.report;
    for (const heading of [
      "## Corpus Summary",
      "## Work Signals",
      "### Plans and Roadmaps",
      "### WIP and Drafts",
      "### Blocked Work",
      "### Open Tasks",
      "### Completed Tasks",
      "### Milestones",
      "## Explicit Relationships",
      "### Depends On",
      "### Blocked By",
      "### References",
      "### Supersedes",
      "### Superseded By",
      "## Exact Duplicate Clusters",
      "## Near-Duplicate Candidates",
      "## Archives and Virtual Members",
      "## Diagnostics and Coverage Gaps",
    ]) {
      expect(report, heading).toContain(heading);
    }
  });

  it("states exact duplicates as facts and candidates as candidates", () => {
    const report = analyze(fixtureCorpus()).outputs.report;
    expect(report).toContain("Byte-identical files");
    expect(report).toContain("candidate");
    expect(report.toLowerCase()).toContain("lexical similarity");
  });

  it("never claims a shared topic, a shared project, or an action to take", () => {
    const report = analyze(fixtureCorpus()).outputs.report.toLowerCase();
    // The similarity section is the one place a reader would most naturally
    // over-read, so the vocabulary of judgement is kept out of the whole document.
    for (const forbidden of [
      "same topic",
      "same project",
      "merge these",
      "delete this",
      "redundant",
      "keeper",
      "canonical copy",
      "should be consolidated",
      "build priority",
      "abandoned",
      "production ready",
    ]) {
      expect(report, forbidden).not.toContain(forbidden);
    }
  });

  it("reads the index and nothing else", () => {
    const run = analyze(fixtureCorpus());
    const altered: CorpusIndex = {
      ...run.index,
      summary: { ...run.index.summary, open_task_count: 4242 },
      near_duplicate_candidates: [],
      exact_duplicate_clusters: [],
      relations: [],
    };
    const report = renderCorpusReport(altered);
    // Values follow the index, so the report cannot disagree with it.
    expect(report).toContain("| open tasks | 4242 |");
    expect(report).toContain("No two observed artifacts are byte-identical.");
    expect(report).toContain("No pair of eligible documents reaches the similarity threshold.");
  });

  it("re-renders identically from the same index", () => {
    const index = analyze(fixtureCorpus()).index;
    expect(renderCorpusReport(index)).toBe(renderCorpusReport(index));
  });
});

// ───────────────────────────── identity under change ─────────────────────────────

describe("what changes when the corpus changes", () => {
  /** Two corpora identical except for one edit, so every other id must hold still. */
  function twoRuns(mutate: (root: string) => void): { before: CorpusIndex; after: CorpusIndex } {
    const before = analyze(fixtureCorpus("l9-corpus-identity-a-")).index;
    const mutated = fixtureCorpus("l9-corpus-identity-b-");
    mutate(mutated);
    return { before, after: analyze(mutated).index };
  }

  it("moves only what an edited task line touches", () => {
    const { before, after } = twoRuns((root) => {
      const target = path.join(root, "roadmap.md");
      fs.writeFileSync(
        target,
        fs.readFileSync(target, "utf8").replace("acquisition hardening lands", "acquisition hardening ships"),
      );
    });

    const artifact = (index: CorpusIndex, sourcePath: string) =>
      index.artifacts.find((a) => a.source_path === sourcePath);
    // The edited artifact's bytes, and therefore its evidence, moved.
    expect(artifact(after, "roadmap.md")?.content_hash)
      .not.toBe(artifact(before, "roadmap.md")?.content_hash);
    expect(artifact(after, "roadmap.md")?.assertion_ids)
      .not.toEqual(artifact(before, "roadmap.md")?.assertion_ids);
    expect(after.repository_model.semantic_hash).not.toBe(before.repository_model.semantic_hash);

    // Nothing else did. Duplicate clusters are content-bound and the edited file
    // is in none of them; the candidate pair does not involve it either.
    expect(after.exact_duplicate_clusters.map((c) => c.cluster_id))
      .toEqual(before.exact_duplicate_clusters.map((c) => c.cluster_id));
    expect(after.near_duplicate_candidates.map((c) => c.candidate_id))
      .toEqual(before.near_duplicate_candidates.map((c) => c.candidate_id));
    expect(artifact(after, "plan.md")?.assertion_ids).toEqual(artifact(before, "plan.md")?.assertion_ids);
  });

  it("moves artifact identity but not cluster identity when a file is only renamed", () => {
    const { before, after } = twoRuns((root) => {
      fs.renameSync(path.join(root, "exact-copy-of-plan.md"), path.join(root, "second-copy-of-plan.md"));
    });

    // The physical snapshot describes paths as well as bytes, so it moved.
    expect(after.source.physical_snapshot_hash).not.toBe(before.source.physical_snapshot_hash);
    expect(after.source.source_revision).not.toBe(before.source.source_revision);
    expect(after.artifacts.map((a) => a.artifact_id)).not.toEqual(before.artifacts.map((a) => a.artifact_id));

    // Cluster identity is byte-bound, so the same two files still form the same
    // cluster under a different name.
    expect(after.exact_duplicate_clusters.map((c) => c.cluster_id))
      .toEqual(before.exact_duplicate_clusters.map((c) => c.cluster_id));
    const renamed = after.exact_duplicate_clusters.find((c) => c.source_paths.includes("plan.md"));
    expect(renamed?.source_paths).toEqual(["plan.md", "second-copy-of-plan.md"]);
    // Nothing was actually deduplicated: both copies are still artifacts.
    expect(after.summary.artifact_count).toBe(before.summary.artifact_count);
  });
});

// ───────────────────────────── source safety ─────────────────────────────

describe("source safety", () => {
  it("leaves the observed corpus byte-identical", () => {
    const root = fixtureCorpus("l9-corpus-safety-");
    const before = treeSnapshot(root);
    const outputs = analyze(root).outputs;
    expect(outputs.indexJson.length).toBeGreaterThan(0);
    expect(treeSnapshot(root)).toEqual(before);
  });

  it("refuses to write corpus outputs inside the observed source", () => {
    const root = fixtureCorpus("l9-corpus-inside-");
    const result = observeLocalSourceModel({ path: root, name: "corpus", producerVersion: PRODUCER_VERSION });
    try {
      const outputs = buildLocalSourceCorpus(result);
      expect(() => writeLocalSourceCorpus(
        outputs,
        { indexPath: path.join(root, "corpus-index.json"), reportPath: path.join(root, "corpus-report.md") },
        root,
      )).toThrow(/refusing to write the corpus index inside the observed source tree/);
      expect(fs.existsSync(path.join(root, "corpus-index.json"))).toBe(false);
    } finally {
      result.observation.dispose();
    }
  });

  it("writes both outputs to a tool-owned directory", () => {
    const root = fixtureCorpus("l9-corpus-write-");
    const outDir = tmp("l9-corpus-out-");
    const result = observeLocalSourceModel({ path: root, name: "corpus", producerVersion: PRODUCER_VERSION });
    try {
      const outputs = buildLocalSourceCorpus(result);
      const written = writeLocalSourceCorpus(
        outputs,
        { indexPath: path.join(outDir, "corpus-index.json"), reportPath: path.join(outDir, "corpus-report.md") },
        root,
      );
      expect(fs.readFileSync(written.indexPath, "utf8")).toBe(outputs.indexJson);
      expect(fs.readFileSync(written.reportPath, "utf8")).toBe(outputs.report);
    } finally {
      result.observation.dispose();
    }
  });

  it("names artifacts by their portable locator, never by their staged copy", () => {
    const index = analyze(fixtureCorpus()).index;
    const member = index.artifacts.find((a) => a.source_path === ARCHIVE_MEMBER_PATHS.nestedDraft);
    expect(member).toBeDefined();
    expect(member?.artifact_id)
      .toBe(repositoryModelArtifactId("repo:corpus", ARCHIVE_MEMBER_PATHS.nestedDraft));
    for (const artifact of index.artifacts) {
      expect(path.isAbsolute(artifact.source_path)).toBe(false);
    }
  });
});
