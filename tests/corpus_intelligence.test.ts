// corpus_intelligence.test.ts — the corpus layer end to end over a real fixture.
//
// The fixture is a non-Git folder holding plain files, a nested archive, an exact
// copy, and a lexical near-copy. Everything asserted here is asserted against
// that corpus as acquired, not against hand-built inputs, so a break in
// acquisition, interpretation, or projection surfaces here.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { acquireLocalSource, type LocalSourceObservation } from "../src/local_source";
import { observeLocalSourceModel } from "../src/local_source_model";
import {
  CORPUS_INDEX_SCHEMA,
  DEFAULT_NEAR_DUPLICATE_THRESHOLD,
  buildCorpusIndex,
  canonicalCorpusJson,
  corpusAnalysisIdentity,
  indexedNearDuplicates,
  jaccard,
  normalizeForSimilarity,
  referenceNearDuplicates,
  shingleSet,
  tokenize,
  type CorpusIndex,
} from "../src/corpus_analysis";
import { renderCorpusReport } from "../src/corpus_report";
import { artifactIdFor, repositoryIdFor } from "../src/repository_model";

const REPO = path.resolve(__dirname, "..");
const CORPUS = path.join(REPO, "fixtures", "corpus", "sample-corpus");
const NAME = "sample-corpus";
const REPOSITORY_ID = repositoryIdFor(NAME);

const disposers: (() => void)[] = [];
afterAll(() => {
  for (const dispose of disposers) dispose();
});

function acquire(root: string = CORPUS): LocalSourceObservation {
  const observation = acquireLocalSource({ path: root, name: NAME });
  disposers.push(() => observation.dispose());
  return observation;
}

interface Analysed {
  observation: LocalSourceObservation;
  index: CorpusIndex;
}

function analyse(root: string = CORPUS, threshold = DEFAULT_NEAR_DUPLICATE_THRESHOLD): Analysed {
  const model = observeLocalSourceModel({
    path: root,
    name: NAME,
    producerVersion: "4.0.0",
  });
  disposers.push(() => model.observation.dispose());
  if (!model.packet) throw new Error(`packet was blocked: ${model.blockedReason ?? "unknown"}`);
  return {
    observation: model.observation,
    index: buildCorpusIndex({
      observation: model.observation,
      packet: model.packet,
      repositoryName: NAME,
      nearDuplicateThreshold: threshold,
    }),
  };
}

function pathsIn(index: CorpusIndex): string[] {
  return index.artifacts.map((artifact) => artifact.source_path);
}

function signalObjects(index: CorpusIndex, predicate: string, sourcePath?: string): string[] {
  return index.work_signals
    .filter((signal) => signal.predicate === predicate
      && (sourcePath === undefined || signal.source_path === sourcePath))
    .map((signal) => signal.object);
}

describe("acquisition covers the corpus", () => {
  it("observes physical files and virtual archive members together", () => {
    const { index } = analyse();
    const paths = pathsIn(index);
    expect(paths).toContain("plan.md");
    expect(paths).toContain("nested/blocked-work.md");
    expect(paths).toContain("archive-a.zip!/old-plan.md");
    expect(paths).toContain("archive-a.zip!/inner.zip!/draft.md");
  });

  it("leaves the source byte-identical", () => {
    const before = snapshot(CORPUS);
    const observation = acquire();
    observation.dispose();
    expect(snapshot(CORPUS)).toEqual(before);
  });

  it("keeps scratch paths out of the index entirely", () => {
    const { index } = analyse();
    const serialized = canonicalCorpusJson(index);
    expect(serialized).not.toContain(os.tmpdir());
    expect(serialized).not.toContain("l9-local-source");
  });
});

describe("artifact-scoped work signals", () => {
  it("attaches a document's status to that document, not to the repository", () => {
    const { index } = analyse();
    const status = index.work_signals.find((signal) =>
      signal.predicate === "work.status" && signal.source_path === "plan.md");
    expect(status?.object).toBe("wip");
    expect(status?.artifact_id).toBe(artifactIdFor(REPOSITORY_ID, "plan.md"));
    expect(status?.artifact_id).not.toBe(REPOSITORY_ID);
  });

  it("points an archive member's signals at the member's own artifact", () => {
    const { index } = analyse();
    const member = "archive-a.zip!/inner.zip!/draft.md";
    const status = index.work_signals.find((signal) =>
      signal.predicate === "work.status" && signal.source_path === member);
    expect(status?.object).toBe("draft");
    expect(status?.artifact_id).toBe(artifactIdFor(REPOSITORY_ID, member));
    // Not the outer archive, and not the archive that directly contained it.
    expect(status?.artifact_id).not.toBe(artifactIdFor(REPOSITORY_ID, "archive-a.zip"));
    expect(status?.artifact_id).not.toBe(artifactIdFor(REPOSITORY_ID, "archive-a.zip!/inner.zip"));
  });

  it("captures the declared kinds, tasks, milestones, and relations of the corpus", () => {
    const { index } = analyse();
    expect(signalObjects(index, "work.kind", "plan.md")).toContain("plan");
    expect(signalObjects(index, "work.kind", "roadmap.md")).toContain("roadmap");
    expect(signalObjects(index, "work.status", "nested/blocked-work.md")).toEqual(["blocked"]);
    expect(signalObjects(index, "work.blocked_by", "nested/blocked-work.md"))
      .toEqual(["upstream schema review"]);
    expect(signalObjects(index, "work.depends_on", "plan.md")).toEqual(["docs/packet-contract.md"]);
    expect(signalObjects(index, "work.superseded_by", "archive-a.zip!/old-plan.md")).toEqual(["plan.md"]);
    expect(signalObjects(index, "work.milestone", "roadmap.md").length).toBeGreaterThanOrEqual(2);
    expect(signalObjects(index, "work.task.open", "plan.md").length).toBeGreaterThanOrEqual(2);
    expect(signalObjects(index, "work.task.completed", "plan.md").length).toBe(1);
  });

  it("declares no work signals for a document that declares none", () => {
    const { index } = analyse();
    expect(signalObjects(index, "work.status", "unrelated.md")).toEqual([]);
    expect(signalObjects(index, "work.kind", "unrelated.md")).toEqual([]);
  });

  it("resolves every work signal to a real assertion and artifact", () => {
    const { index } = analyse();
    const artifactIds = new Set(index.artifacts.map((artifact) => artifact.artifact_id));
    expect(index.work_signals.length).toBeGreaterThan(0);
    for (const signal of index.work_signals) {
      expect(artifactIds.has(signal.artifact_id)).toBe(true);
      const owner = index.artifacts.find((artifact) => artifact.artifact_id === signal.artifact_id);
      expect(owner?.assertion_ids).toContain(signal.assertion_id);
    }
  });
});

describe("exact duplicates", () => {
  it("clusters a physical copy with its original", () => {
    const { index } = analyse();
    const cluster = index.exact_duplicate_clusters.find((c) =>
      c.source_paths.includes("plan.md"));
    expect(cluster?.source_paths).toEqual(["exact-copy-of-plan.md", "plan.md"]);
  });

  it("clusters an archive member with the physical file it duplicates", () => {
    const { index } = analyse();
    const cluster = index.exact_duplicate_clusters.find((c) =>
      c.source_paths.includes("notes.txt"));
    expect(cluster?.source_paths).toEqual(["archive-a.zip!/copy-of-notes.txt", "notes.txt"]);
  });

  it("does not cluster same-named files with different content", () => {
    const { index } = analyse();
    for (const cluster of index.exact_duplicate_clusters) {
      // revised-plan.md is a near copy of plan.md, never an exact one.
      expect(cluster.source_paths).not.toContain("revised-plan.md");
    }
  });

  it("renders one star relation per non-representative member", () => {
    const { index } = analyse();
    for (const cluster of index.exact_duplicate_clusters) {
      const edges = index.relations.filter((r) => r.duplicate_cluster_id === cluster.cluster_id);
      expect(edges.length).toBe(cluster.count - 1);
      for (const edge of edges) {
        expect(edge.target_artifact_id).toBe(cluster.representative_artifact_id);
        expect(edge.symmetric).toBe(true);
      }
    }
  });

  it("resolves every relation endpoint to an artifact in the index", () => {
    const { index } = analyse();
    const artifactIds = new Set(index.artifacts.map((artifact) => artifact.artifact_id));
    expect(index.relations.length).toBeGreaterThan(0);
    for (const relation of index.relations) {
      expect(artifactIds.has(relation.source_artifact_id)).toBe(true);
      expect(artifactIds.has(relation.target_artifact_id)).toBe(true);
    }
  });

  it("derives cluster identity from content, not from location", () => {
    const { index } = analyse();
    for (const cluster of index.exact_duplicate_clusters) {
      expect(cluster.cluster_id).toBe(`duplicate-cluster:${cluster.content_hash}`);
    }
  });
});

describe("near-duplicate candidates", () => {
  it("finds the revised copy as a candidate against the original", () => {
    const { index } = analyse();
    const pair = index.near_duplicate_candidates.find((candidate) =>
      [candidate.source_path_a, candidate.source_path_b].includes("revised-plan.md"));
    expect(pair).toBeDefined();
    expect(pair?.score).toBeGreaterThanOrEqual(DEFAULT_NEAR_DUPLICATE_THRESHOLD);
  });

  it("still scores a file that happens to have an exact twin", () => {
    // plan.md has a byte-identical copy. Dropping every clustered file from the
    // analysis would silently lose its near-duplicate relationship to the revision.
    const { index } = analyse();
    const pair = index.near_duplicate_candidates.find((candidate) =>
      [candidate.source_path_a, candidate.source_path_b].includes("plan.md"));
    expect(pair).toBeDefined();
  });

  it("excludes exact duplicates from candidacy", () => {
    const { index } = analyse();
    for (const candidate of index.near_duplicate_candidates) {
      const paths = [candidate.source_path_a, candidate.source_path_b];
      expect(paths).not.toContain("exact-copy-of-plan.md");
    }
  });

  it("leaves unrelated prose below the threshold", () => {
    const { index } = analyse();
    for (const candidate of index.near_duplicate_candidates) {
      expect([candidate.source_path_a, candidate.source_path_b]).not.toContain("unrelated.md");
    }
  });

  it("scores whitespace-only variation as near identical", () => {
    const base = "the quick brown fox jumps over the lazy dog and then keeps running far past the fence line today";
    const spaced = base.replace(/ /g, "   ").replace(/fox/, "fox\n");
    const a = shingleSet(tokenize(normalizeForSimilarity(base)));
    const b = shingleSet(tokenize(normalizeForSimilarity(spaced)));
    expect(jaccard(a, b)).toBe(1);
  });

  it("matches the bounded all-pairs reference exactly", () => {
    // The index build uses the shingle-indexed generator. It must return the same
    // qualifying pairs as the quadratic definition, or the optimization changed
    // the answer rather than the cost.
    const model = observeLocalSourceModel({ path: CORPUS, name: NAME, producerVersion: "4.0.0" });
    disposers.push(() => model.observation.dispose());
    const documents = analysableDocumentsFor(model.observation);
    for (const threshold of [0.0, 0.3, 0.6, 0.85, 0.99]) {
      expect(indexedNearDuplicates(documents, threshold))
        .toEqual(referenceNearDuplicates(documents, threshold));
    }
  });

  it("changes analysis identity when the threshold changes", () => {
    expect(corpusAnalysisIdentity(0.85)).not.toBe(corpusAnalysisIdentity(0.6));
  });

  it("can be skipped while exact duplicates still report", () => {
    const model = observeLocalSourceModel({ path: CORPUS, name: NAME, producerVersion: "4.0.0" });
    disposers.push(() => model.observation.dispose());
    const index = buildCorpusIndex({
      observation: model.observation,
      packet: model.packet!,
      repositoryName: NAME,
      skipNearDuplicates: true,
    });
    expect(index.near_duplicate_candidates).toEqual([]);
    expect(index.analysis_profile.near_duplicate_analysed).toBe(false);
    expect(index.exact_duplicate_clusters.length).toBeGreaterThan(0);
  });

  it("rejects a threshold outside [0,1]", () => {
    const model = observeLocalSourceModel({ path: CORPUS, name: NAME, producerVersion: "4.0.0" });
    disposers.push(() => model.observation.dispose());
    expect(() => buildCorpusIndex({
      observation: model.observation,
      packet: model.packet!,
      repositoryName: NAME,
      nearDuplicateThreshold: 1.5,
    })).toThrow(/within \[0,1\]/);
  });
});

describe("index and report are projections", () => {
  it("declares the corpus index schema", () => {
    expect(analyse().index.schema).toBe(CORPUS_INDEX_SCHEMA);
  });

  it("counts what the domains actually contain", () => {
    const { index } = analyse();
    expect(index.summary.artifact_count).toBe(index.artifacts.length);
    expect(index.summary.near_duplicate_candidate_count).toBe(index.near_duplicate_candidates.length);
    expect(index.summary.exact_duplicate_cluster_count).toBe(index.exact_duplicate_clusters.length);
    expect(index.summary.recoverable_duplicate_bytes)
      .toBe(index.exact_duplicate_clusters.reduce((total, c) => total + c.recoverable_bytes, 0));
    expect(index.summary.open_task_count)
      .toBe(index.work_signals.filter((s) => s.predicate === "work.task.open").length);
  });

  it("renders a report that never claims semantic equivalence", () => {
    const report = renderCorpusReport(analyse().index);
    for (const forbidden of [
      "same topic", "same project", "merge these", "delete this", "redundant",
      "keeper", "canonical copy",
    ]) {
      expect(report.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("names near-duplicates as candidates measured lexically", () => {
    const report = renderCorpusReport(analyse().index).toLowerCase();
    expect(report).toContain("candidate");
    expect(report).toContain("lexical similarity");
  });

  it("may call exact duplicates byte-identical", () => {
    const report = renderCorpusReport(analyse().index).toLowerCase();
    expect(report).toContain("byte-identical");
  });

  it("renders the same bytes for the same index", () => {
    const { index } = analyse();
    expect(renderCorpusReport(index)).toBe(renderCorpusReport(index));
  });
});

describe("identity under replay and relocation", () => {
  it("produces a byte-identical index on a repeated run", () => {
    expect(canonicalCorpusJson(analyse().index)).toBe(canonicalCorpusJson(analyse().index));
  });

  it("keeps every semantic ID stable when the corpus moves to another absolute path", () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), "l9-corpus-move-"));
    disposers.push(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
    const moved = path.join(elsewhere, "sample-corpus");
    fs.cpSync(CORPUS, moved, { recursive: true });

    const here = analyse(CORPUS).index;
    const there = analyse(moved).index;

    expect(there.artifacts.map((a) => a.artifact_id)).toEqual(here.artifacts.map((a) => a.artifact_id));
    expect(there.work_signals.map((s) => s.assertion_id)).toEqual(here.work_signals.map((s) => s.assertion_id));
    expect(there.exact_duplicate_clusters.map((c) => c.cluster_id))
      .toEqual(here.exact_duplicate_clusters.map((c) => c.cluster_id));
    expect(there.near_duplicate_candidates.map((c) => c.candidate_id))
      .toEqual(here.near_duplicate_candidates.map((c) => c.candidate_id));
  });

  it("changes only the touched document's evidence when one task line changes", () => {
    const edited = fs.mkdtempSync(path.join(os.tmpdir(), "l9-corpus-edit-"));
    disposers.push(() => fs.rmSync(edited, { recursive: true, force: true }));
    const root = path.join(edited, "sample-corpus");
    fs.cpSync(CORPUS, root, { recursive: true });
    const target = path.join(root, "nested", "blocked-work.md");
    fs.writeFileSync(target, fs.readFileSync(target, "utf8").replace("re-run the conformance probe", "re-run the probe"));

    const before = analyse(CORPUS).index;
    const after = analyse(root).index;

    const notesCluster = (index: CorpusIndex): string | undefined =>
      index.exact_duplicate_clusters.find((c) => c.source_paths.includes("notes.txt"))?.cluster_id;
    // The edit is confined to one document: an unrelated duplicate cluster keeps
    // its identity, while the edited document's task assertion does not.
    expect(notesCluster(after)).toBe(notesCluster(before));

    const taskOf = (index: CorpusIndex): string | undefined => index.work_signals.find((s) =>
      s.predicate === "work.task.open" && s.source_path === "nested/blocked-work.md")?.assertion_id;
    expect(taskOf(after)).not.toBe(taskOf(before));
  });
});

// Rebuild the analysable document set the way the index build does, so the
// reference comparison scores exactly the inputs the production path scores.
function analysableDocumentsFor(observation: LocalSourceObservation) {
  const repositoryId = repositoryIdFor(NAME);
  // Mirror the production rule: one representative per exact-duplicate cluster.
  const representativeByPath = new Map<string, string>();
  for (const cluster of observation.inventory.duplicates) {
    const representative = [...cluster.paths].sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))[0];
    for (const p of cluster.paths) representativeByPath.set(p, representative);
  }
  const documents: { artifactId: string; sourcePath: string; normalizedHash: string; shingles: Set<string> }[] = [];
  for (const record of [...observation.inventory.records].sort((a, b) =>
    a.relative_path < b.relative_path ? -1 : a.relative_path > b.relative_path ? 1 : 0)) {
    if (record.artifact_type === "folder") continue;
    const sourcePath = record.relative_path;
    if (!/\.(md|markdown|txt|rst)$/i.test(sourcePath)) continue;
    const representative = representativeByPath.get(sourcePath);
    if (representative !== undefined && representative !== sourcePath) continue;
    if (!record.absolute_path) continue;
    const text = fs.readFileSync(record.absolute_path, "utf8");
    const tokens = tokenize(normalizeForSimilarity(text));
    if (tokens.length < 20) continue;
    documents.push({
      artifactId: artifactIdFor(repositoryId, sourcePath),
      sourcePath,
      normalizedHash: `sha256:${"0".repeat(64)}`,
      shingles: shingleSet(tokens),
    });
  }
  return documents;
}

function snapshot(root: string): Record<string, string> {
  const crypto = require("node:crypto") as typeof import("node:crypto");
  const out: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stats = fs.lstatSync(absolute);
      if (stats.isDirectory()) { out[`${relative}/`] = "dir"; walk(absolute); continue; }
      out[relative] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    }
  };
  walk(root);
  return out;
}
