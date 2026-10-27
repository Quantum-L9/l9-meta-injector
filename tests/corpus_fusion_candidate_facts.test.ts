// corpus_fusion_candidate_facts.test.ts — the facts a candidate states about its
// members are computed from those members, and never supplied downstream.
//
// Three defects shared one shape: a field the packet publishes was either not
// computed by the producer that owns the candidate (cross_root, a consolidation's
// confidence class), inferred from free text instead of the structured fact the
// pair builder records (supersession), or computed by a different predicate for
// one candidate kind than for another (weakly connected members). Every case
// below states the fact a reader would check and checks it against the members.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { runSemanticAnalysis } from "../src/corpus_semantic_run";
import {
  AMBIGUITY_WEAKLY_CONNECTED,
  CONSOLIDATION_EVIDENCE_PROJECT_VERSIONS,
  CONSOLIDATION_EVIDENCE_SUPERSESSION,
  buildProjectCandidates,
  buildTopicCandidates,
} from "../src/corpus_fusion";
import type { ConfidenceClass, PairClassification } from "../src/corpus_fusion";
import type { PairSignal, SemanticPair } from "../src/corpus_pairs";
import { runCorpusScan } from "../src/corpus_scan";
import { corpusIntelligenceInput } from "../src/corpus_intelligence_input";
import { CorpusIntelligenceError } from "../src/corpus_intelligence";
import { artifact, exactDuplicates, lexicalRelated, supersession } from "./helpers/semantic_fixtures";
import { writeMultiRootCorpus } from "./helpers/multi_root_fixtures";
import type { SemanticArtifactInput } from "../src/corpus_semantics";

const scratch: string[] = [];
function tmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function run(
  artifacts: readonly SemanticArtifactInput[],
  nearDuplicatePairs?: { artifact_a_id: string; artifact_b_id: string; score: number }[],
) {
  return runSemanticAnalysis({
    corpusSourceSnapshotId: "snapshot:test",
    corpusAnalysisId: "analysis:test",
    artifacts,
    ...(nearDuplicatePairs !== undefined ? { nearDuplicatePairs } : {}),
  });
}

const PLAN_BODY = [
  "The widget api plan covers the routing layer, the rate limiter and the rollout order.",
  "Each step names the owner and the verification it needs before the next can start.",
].join(" ");

/** The same PLAN.md on two roots: one byte-identical file, two disks. */
function planOnTwoRoots(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "plan-r1", path: "widget-api/PLAN.md", root: "r1", hash: "sha256:plan",
      title: "Widget API Plan", headings: ["Routing", "Rollout"], body: PLAN_BODY,
      duplicateCluster: "cluster:plan",
    }),
    artifact({
      id: "plan-r2", path: "widget-api/PLAN.md", root: "r2", hash: "sha256:plan",
      title: "Widget API Plan", headings: ["Routing", "Rollout"], body: PLAN_BODY,
      duplicateCluster: "cluster:plan",
    }),
  ];
}

function strongestOf(entries: readonly PairClassification[]): ConfidenceClass {
  if (entries.some((entry) => entry.confidence_class === "strong")) return "strong";
  if (entries.some((entry) => entry.confidence_class === "moderate")) return "moderate";
  return "weak";
}

describe("cross_root is computed by fusion from the members' roots", () => {
  it("REG-WU-048-RC-074-a: a candidate spanning two roots says so, one inside a root does not", () => {
    const result = run([...planOnTwoRoots(), ...lexicalRelated()]);
    const rootOf = new Map(result.views.map((view) => [view.artifact_id, view.root_id]));
    const spans = (members: readonly string[]): boolean =>
      new Set(members.map((id) => rootOf.get(id))).size > 1;

    const planTopic = result.topics.candidates.find((c) => c.member_artifact_ids.includes("plan-r1"));
    const ingestTopic = result.topics.candidates.find((c) => c.member_artifact_ids.includes("ingest-a"));
    expect(planTopic).toBeDefined();
    expect(ingestTopic).toBeDefined();
    expect(planTopic!.cross_root).toBe(true);
    expect(ingestTopic!.cross_root).toBe(false);

    const planConsolidation = result.consolidations.candidates.find(
      (c) => c.member_artifact_ids.includes("plan-r1"),
    );
    expect(planConsolidation).toBeDefined();
    expect(planConsolidation!.cross_root).toBe(true);

    // Every semantic candidate, of every kind, agrees with its own members.
    for (const candidate of [
      ...result.topics.candidates,
      ...result.projects.candidates,
      ...result.consolidations.candidates,
    ]) {
      expect(candidate.cross_root, candidate.candidate_id).toBe(spans(candidate.member_artifact_ids));
    }

    // And within one root it is false for a consolidation too.
    const single = run(exactDuplicates());
    expect(single.consolidations.candidates.length).toBeGreaterThan(0);
    for (const candidate of single.consolidations.candidates) expect(candidate.cross_root).toBe(false);
  });
});

describe("a consolidation candidate's confidence class", () => {
  it("REG-WU-048-RC-074-b: is the strongest class among its pairs, not unconditionally weak", () => {
    // Byte-identical copies that also declare one project: the duplicate pair
    // carries two strong families, so it is a strong pair.
    const declared = [{ identifier: "reporting", manifest: "package.json", field: "name" }];
    const result = run(
      exactDuplicates().map((input) => ({ ...input, declared_identifiers: declared })),
    );
    const candidate = result.consolidations.candidates.find(
      (c) => c.exact_duplicate_cluster_ids.includes("cluster:dup"),
    );
    expect(candidate).toBeDefined();
    const members = new Set(candidate!.member_artifact_ids);
    const within = result.relations.classifications.filter(
      (entry) => members.has(entry.artifact_a_id) && members.has(entry.artifact_b_id),
    );
    expect(within.length).toBeGreaterThan(0);
    expect(candidate!.confidence_class).toBe(strongestOf(within));
    expect(candidate!.confidence_class).toBe("strong");
  });
});

describe("the packet translation reads the producer's values and refuses when they are absent", () => {
  async function scanTwoRoots() {
    const corpus = writeMultiRootCorpus(tmp("l9-fusion-facts-"));
    return runCorpusScan({
      roots: [
        { path: corpus.oldSsd, name: "OldSSD" },
        { path: corpus.backup, name: "Backup" },
      ],
      producerVersion: "test",
    });
  }

  it("REG-WU-048-RC-074-c: a semantic candidate without confidence_class or cross_root is refused by name", async () => {
    const result = await scanTwoRoots();
    expect(result.semantic).not.toBeNull();
    const options = { producerVersion: "test", createdAt: "2026-01-01T00:00:00.000Z" };
    // The untouched run translates.
    expect(() => corpusIntelligenceInput(result, options)).not.toThrow();

    const topics = result.semantic!.topics.candidates;
    expect(topics.length).toBeGreaterThan(0);
    const target = topics[0]!;

    const withoutRoot = { ...target } as Partial<typeof target>;
    delete withoutRoot.cross_root;
    topics[0] = withoutRoot as typeof target;
    let error: unknown;
    try {
      corpusIntelligenceInput(result, options);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CorpusIntelligenceError);
    expect(String((error as Error).message)).toContain(target.candidate_id);
    expect(String((error as Error).message)).toContain("cross_root");

    const withoutClass = { ...target } as Partial<typeof target>;
    delete withoutClass.confidence_class;
    topics[0] = withoutClass as typeof target;
    error = undefined;
    try {
      corpusIntelligenceInput(result, options);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CorpusIntelligenceError);
    expect(String((error as Error).message)).toContain(target.candidate_id);
    expect(String((error as Error).message)).toContain("confidence_class");

    topics[0] = { ...target, confidence_class: "certain" as ConfidenceClass };
    expect(() => corpusIntelligenceInput(result, options)).toThrow(CorpusIntelligenceError);
  });

  it("REG-WU-048-RC-074-d: a lexical project candidate keeps spans_roots and the documented weak floor", async () => {
    const result = await scanTwoRoots();
    const input = corpusIntelligenceInput(result, {
      producerVersion: "test", createdAt: "2026-01-01T00:00:00.000Z",
    });
    const lexical = result.candidates.project_candidates.find(
      (candidate) => candidate.project_key.includes("widget-api"),
    );
    expect(lexical).toBeDefined();
    expect(lexical!.spans_roots).toBe(true);
    const cluster = input.payload.project_candidates.find(
      (entry) => entry.candidate_id === lexical!.candidate_id,
    );
    expect(cluster).toBeDefined();
    expect(cluster!.cross_root).toBe(true);
    expect(cluster!.confidence_class).toBe("weak");
    // Neither container is inside an archive, so the derived flag is false.
    expect(cluster!.cross_archive).toBe(false);
  });

  it("REG-WU-048-RC-074-e: every semantic packet cluster's cross_root agrees with its members' roots", async () => {
    const result = await scanTwoRoots();
    const input = corpusIntelligenceInput(result, {
      producerVersion: "test", createdAt: "2026-01-01T00:00:00.000Z",
    });
    const semantic = result.semantic!;
    const rootOf = new Map(semantic.views.map((view) => [view.artifact_id, view.root_id]));
    const upstream = new Map<string, readonly string[]>(
      [
        ...semantic.topics.candidates,
        ...semantic.projects.candidates,
        ...semantic.consolidations.candidates,
      ].map((candidate) => [candidate.candidate_id, candidate.member_artifact_ids]),
    );
    let spanning = 0;
    for (const cluster of [
      ...input.payload.topic_candidates,
      ...input.payload.project_candidates,
      ...input.payload.consolidation_candidates,
    ]) {
      const members = upstream.get(cluster.upstream_candidate_id);
      if (members === undefined) continue; // a lexical project candidate
      const spans = new Set(members.map((id) => rootOf.get(id))).size > 1;
      if (spans) spanning += 1;
      expect(cluster.cross_root, cluster.candidate_id).toBe(spans);
    }
    // The fixture puts a byte-identical PLAN.md on both disks, so at least one
    // semantic candidate does span them.
    expect(spanning).toBeGreaterThan(0);
  });
});

describe("supersession is a declaration that resolves between two members", () => {
  /** A plan and a spec of one project; the plan supersedes a file outside it. */
  function projectSupersedingOutsider(): SemanticArtifactInput[] {
    return [
      artifact({
        id: "proj-plan", path: "gateway/plan.md", title: "Gateway Plan", headings: ["Routing"],
        body: "The gateway plan routes requests by tenant.", references: ["gateway/spec.md"],
        identifiers: [{ identifier: "gateway", manifest: "package.json", field: "name" }],
        supersedes: "archive/old-gateway-notes.md",
      }),
      artifact({
        id: "proj-spec", path: "gateway/spec.md", title: "Gateway Spec", headings: ["Limits"],
        body: "The gateway spec fixes the per-tenant limits.",
        identifiers: [{ identifier: "gateway", manifest: "package.json", field: "name" }],
      }),
    ];
  }

  it("REG-WU-048-RC-081-a: a member superseding a non-member admits no consolidation and no supersession analysis", () => {
    const result = run(projectSupersedingOutsider());
    expect(result.projects.candidates).toHaveLength(1);
    expect(result.consolidations.candidates).toHaveLength(0);
    expect(
      result.reasoningCandidates.filter((row) => row.reasoning_type === "SUPERSESSION_ANALYSIS"),
    ).toHaveLength(0);
  });

  it("REG-WU-048-RC-081-b: a plain reference to a path spelling 'superseded' is not a supersession", () => {
    const result = run([
      artifact({
        id: "b1", path: "notes/index.md", title: "Design Index", headings: ["Designs"],
        body: "The index lists the design documents.", references: ["notes/superseded-designs.md"],
      }),
      artifact({
        id: "b2", path: "notes/superseded-designs.md", title: "Earlier Designs",
        headings: ["Designs"], body: "Designs considered and set aside.",
      }),
    ]);
    // The reference resolved, so the pair exists and carries the reference.
    const pair = result.relations.pairs.find(
      (entry) => [entry.artifact_a_id, entry.artifact_b_id].sort().join() === "b1,b2",
    );
    expect(pair).toBeDefined();
    expect(pair!.signals.some((signal) => signal.kind === "explicit_reference")).toBe(true);

    for (const candidate of result.consolidations.candidates) {
      expect(candidate.evidence_class).not.toContain(CONSOLIDATION_EVIDENCE_SUPERSESSION);
    }
  });

  it("REG-WU-048-RC-081-c: a genuine member-to-member supersession is still admitted and routed", () => {
    const result = run(supersession());
    const candidate = result.consolidations.candidates.find(
      (c) => c.evidence_class.includes(CONSOLIDATION_EVIDENCE_SUPERSESSION),
    );
    expect(candidate).toBeDefined();
    expect(candidate!.member_artifact_ids).toEqual(["design-v1", "design-v2"]);
    const declared = result.views.find((view) => view.artifact_id === "design-v2")!
      .supersession_declarations.map((d) => d.assertion_id);
    expect(candidate!.supersession_assertion_ids).toEqual(declared);
    const routed = result.reasoningCandidates.find(
      (row) => row.candidate_id === candidate!.candidate_id,
    );
    expect(routed?.reasoning_type).toBe("SUPERSESSION_ANALYSIS");
  });

  it("REG-WU-048-RC-081-d: a project with a near-duplicate edge between members is still a versions candidate", () => {
    const result = run(projectSupersedingOutsider(), [
      { artifact_a_id: "proj-plan", artifact_b_id: "proj-spec", score: 0.9 },
    ]);
    const project = result.projects.candidates[0]!;
    const versions = result.consolidations.candidates.find(
      (c) => c.evidence_class.includes(CONSOLIDATION_EVIDENCE_PROJECT_VERSIONS),
    );
    expect(versions).toBeDefined();
    expect(versions!.project_candidate_ids).toEqual([project.candidate_id]);
    // The outsider declaration resolves inside no pair of members, so it is not
    // carried as a supersession this group holds.
    expect(versions!.supersession_assertion_ids).toEqual([]);
  });
});

describe("weakly connected members: one rule for topics and projects", () => {
  const PROFILE = {
    pair_signal_profile_id: "test", pair_signal_profile_version: "1", pair_signal_profile_hash: "h",
  };
  function signal(kind: PairSignal["kind"], score: number): PairSignal {
    return { kind, method: `test:${kind}`, score, categorical: false, fact: false, detail: [] };
  }
  /** One strong lexical metric plus a sub-threshold model score: two families, one strong. */
  const moderate = (): PairSignal[] => [signal("title_overlap", 0.6), signal("embedding_similarity", 0.5)];
  /** Two families, both strong. */
  const strong = (): PairSignal[] => [signal("title_overlap", 0.6), signal("embedding_similarity", 0.9)];
  /** One lexical metric below its threshold. */
  const weak = (): PairSignal[] => [signal("title_overlap", 0.2)];
  function pair(id: string, a: string, b: string, signals: PairSignal[]): SemanticPair {
    return { pair_id: id, artifact_a_id: a, artifact_b_id: b, signals, evidence_refs: [], analysis_profile: PROFILE };
  }

  it("REG-WU-048-RC-083-a: a moderate-only component keeps the flag when a weak pair is added inside it", () => {
    const pairs = [
      pair("p1", "A", "B", moderate()),
      pair("p2", "B", "C", moderate()),
      pair("p3", "A", "C", weak()),
    ];
    const topics = buildTopicCandidates({ views: [], pairs });
    expect(topics).toHaveLength(1);
    expect(topics[0]!.member_artifact_ids).toEqual(["A", "B", "C"]);
    expect(topics[0]!.confidence_class).toBe("moderate");
    expect(topics[0]!.ambiguity_class).toContain(AMBIGUITY_WEAKLY_CONNECTED);
  });

  it("REG-WU-048-RC-083-b: a component with a strong pair is not weakly connected", () => {
    const topics = buildTopicCandidates({
      views: [],
      pairs: [pair("p1", "A", "B", strong()), pair("p2", "B", "C", moderate())],
    });
    expect(topics).toHaveLength(1);
    expect(topics[0]!.ambiguity_class).not.toContain(AMBIGUITY_WEAKLY_CONNECTED);
  });

  it("REG-WU-048-RC-083-c: a moderate-only component without extra pairs keeps the flag", () => {
    const pairs = [pair("p1", "A", "B", moderate()), pair("p2", "B", "C", moderate())];
    const topics = buildTopicCandidates({ views: [], pairs });
    expect(topics).toHaveLength(1);
    expect(topics[0]!.ambiguity_class).toContain(AMBIGUITY_WEAKLY_CONNECTED);
    // The project rule is the same predicate.
    const projects = buildProjectCandidates({ views: [], pairs });
    for (const project of projects) expect(project.ambiguity_class).toContain(AMBIGUITY_WEAKLY_CONNECTED);
  });
});
