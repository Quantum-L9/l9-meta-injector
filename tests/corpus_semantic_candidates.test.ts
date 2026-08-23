// corpus_semantic_candidates.test.ts — the epistemic contract, case by case.
//
// The semantic layer's risk is not that it computes a wrong number. It is that a
// number gets promoted into a claim: similarity into "same topic", a shared
// folder into "same project", a model's opinion into a fact. Almost every
// assertion here is therefore a *refusal* — a check that some plausible promotion
// did not happen.
//
// The positive cases exist to prove the refusals are not achieved by finding
// nothing at all.
import { describe, expect, it } from "vitest";
import { runSemanticAnalysis } from "../src/corpus_semantic_run";
import { classifyPair } from "../src/corpus_fusion";
import { buildFeatureViews } from "../src/corpus_semantics";
import { buildSemanticPairs, referenceFixtureComparison } from "../src/corpus_pairs";
import {
  consolidationSet,
  crossArchiveVersions,
  exactDuplicates,
  explicitSameProject,
  genericOverlapFalsePositive,
  lexicalRelated,
  semanticParaphrase,
  statusConflict,
  supersession,
} from "./helpers/semantic_fixtures";
import type { SemanticArtifactInput } from "../src/corpus_semantics";
import type { EmbeddingPairScore } from "../src/corpus_pairs";

function run(
  artifacts: readonly SemanticArtifactInput[],
  extra: { embeddingPairs?: EmbeddingPairScore[]; nearDuplicatePairs?: { artifact_a_id: string; artifact_b_id: string; score: number }[] } = {},
) {
  return runSemanticAnalysis({
    corpusSnapshotId: "snapshot:test",
    artifacts,
    ...extra,
  });
}

describe("explicit same project", () => {
  it("admits a project candidate on declared identity plus an explicit reference", () => {
    const result = run(explicitSameProject());

    expect(result.projects.candidates).toHaveLength(1);
    const project = result.projects.candidates[0]!;
    expect(project.member_artifact_ids).toEqual(["wm-notes", "wm-plan"]);
    expect(project.declared_identifiers).toEqual(["world-model"]);
    expect(project.explicit_reference_count).toBeGreaterThan(0);
    expect(project.confidence_class).toBe("strong");
  });

  it("names no project, and carries only identifiers a source declared", () => {
    const result = run(explicitSameProject());
    const rendered = JSON.stringify(result.projects);

    // Every identifier in the record must be one a manifest declared.
    for (const identifier of result.projects.candidates[0]!.declared_identifiers) {
      expect(identifier).toBe("world-model");
    }
    for (const forbidden of ["project_name", "canonical_copy", "recommended_action", "merge_into"]) {
      expect(rendered).not.toContain(forbidden);
    }
  });
});

describe("lexical relatedness", () => {
  it("admits a topic candidate", () => {
    const result = run(lexicalRelated());
    expect(result.topics.candidates).toHaveLength(1);
    expect(result.topics.candidates[0]!.member_artifact_ids).toEqual(["ingest-a", "ingest-b"]);
  });

  it("does not admit a project candidate from vocabulary alone", () => {
    const result = run(lexicalRelated());
    // One lexical family is not corroboration. Without a declared identifier or a
    // graph edge there is no evidence these are one body of work.
    expect(result.projects.candidates).toHaveLength(0);
  });
});

describe("a paraphrase the lexical layer cannot see", () => {
  it("produces no strong lexical relationship, which is the honest answer", () => {
    const result = run(semanticParaphrase());
    const strong = result.relations.classifications.filter((c) => c.confidence_class === "strong");
    expect(strong).toHaveLength(0);
    expect(result.projects.candidates).toHaveLength(0);
  });

  it("becomes a candidate once an embedding score is supplied, and stays weak", () => {
    const result = run(semanticParaphrase(), {
      embeddingPairs: [{ artifact_a_id: "para-a", artifact_b_id: "para-b", score: 0.93 }],
    });

    const classification = result.relations.classifications.find(
      (entry) => entry.artifact_a_id === "para-a" && entry.artifact_b_id === "para-b",
    );
    expect(classification).toBeDefined();
    expect(classification!.embedding_only).toBe(true);
    // 0.93 is above the strong threshold and the class is still weak: a model's
    // opinion is capped by what kind of evidence it is, not by how confident it is.
    expect(classification!.confidence_class).toBe("weak");
  });
});

describe("generic vocabulary overlap", () => {
  it("does not reach a strong relationship", () => {
    const result = run(genericOverlapFalsePositive());
    for (const classification of result.relations.classifications) {
      expect(classification.confidence_class).not.toBe("strong");
    }
  });

  it("creates no project candidate", () => {
    const result = run(genericOverlapFalsePositive());
    expect(result.projects.candidates).toHaveLength(0);
  });
});

describe("an embedding-only relationship", () => {
  const embeddingPairs: EmbeddingPairScore[] = [
    { artifact_a_id: "para-a", artifact_b_id: "para-b", score: 0.99 },
  ];

  it("caps at weak", () => {
    const result = run(semanticParaphrase(), { embeddingPairs });
    const classification = result.relations.classifications[0]!;
    expect(classification.confidence_class).toBe("weak");
  });

  it("creates no project candidate and no topic candidate", () => {
    const result = run(semanticParaphrase(), { embeddingPairs });
    expect(result.projects.candidates).toHaveLength(0);
    expect(result.topics.candidates).toHaveLength(0);
  });

  it("is never routed to a reasoner", () => {
    const result = run(semanticParaphrase(), { embeddingPairs });
    expect(result.summary.reasoning_eligible_count).toBe(0);
  });
});

describe("versions across two archives", () => {
  it("keeps each member's archive provenance", () => {
    const result = run(crossArchiveVersions());
    const byId = new Map(result.views.map((view) => [view.artifact_id, view]));
    expect(byId.get("arch-old")!.archive_ancestry).toEqual(["old.zip"]);
    expect(byId.get("arch-new")!.archive_ancestry).toEqual(["backup.zip"]);
  });

  it("admits a candidate and marks it as crossing an archive boundary", () => {
    const result = run(crossArchiveVersions());
    expect(result.projects.candidates).toHaveLength(1);
    expect(result.projects.candidates[0]!.cross_archive).toBe(true);
  });
});

describe("exact duplicates", () => {
  it("are carried as a fact", () => {
    const result = run(exactDuplicates());
    const pair = result.relations.pairs[0]!;
    const exact = pair.signals.find((signal) => signal.kind === "exact_duplicate");
    expect(exact).toBeDefined();
    expect(exact!.fact).toBe(true);
  });

  it("are not worth a reasoner's attention on their own", () => {
    const result = run(exactDuplicates());
    const consolidation = result.reasoningCandidates.filter(
      (row) => row.candidate_type === "CONSOLIDATION_CANDIDATE",
    );
    expect(consolidation.length).toBeGreaterThan(0);
    for (const row of consolidation) {
      expect(row.reasoning_type).toBe("NONE");
      expect(row.reason).toContain("byte-identical");
    }
    expect(result.evidencePacks).toHaveLength(0);
  });

  it("do not by themselves prove a shared project", () => {
    const result = run(exactDuplicates());
    // A copy is evidence that a copy happened. Copies cross projects routinely.
    expect(result.projects.candidates).toHaveLength(0);
  });
});

describe("a status conflict inside one declared project", () => {
  it("admits the project candidate and flags the conflict", () => {
    const result = run(statusConflict());
    expect(result.projects.candidates).toHaveLength(1);
    const project = result.projects.candidates[0]!;
    expect(project.ambiguity_class).toContain("conflicting_status");
    expect(project.work_statuses).toEqual(["complete", "wip"]);
  });

  it("routes it for conflict resolution, with a reason and a bounded pack", () => {
    const result = run(statusConflict());
    const routed = result.reasoningCandidates.find(
      (row) => row.candidate_type === "PROJECT_CANDIDATE",
    );
    expect(routed!.reasoning_type).toBe("CONFLICT_RESOLUTION_ANALYSIS");
    expect(routed!.reason.length).toBeGreaterThan(0);

    const pack = result.evidencePacks.find(
      (entry) => entry.reasoning_candidate_id === routed!.reasoning_candidate_id,
    );
    expect(pack).toBeDefined();
    expect(pack!.member_artifact_ids).toEqual(["status-a", "status-b"]);
    expect(pack!.ambiguity.conflict_flags.join(" ")).toContain("statuses differ");
  });
});

describe("an explicit supersession", () => {
  it("preserves the declared direction and invents no reverse claim", () => {
    const result = run(supersession());
    const byId = new Map(result.views.map((view) => [view.artifact_id, view]));

    const declared = byId.get("design-v2")!.supersession_declarations;
    expect(declared).toHaveLength(1);
    expect(declared[0]!.predicate).toBe("work.supersedes");
    expect(declared[0]!.object).toBe("design-v1.md");

    // v1 said nothing about v2. The analysis must not add a superseded_by to it.
    expect(byId.get("design-v1")!.supersession_declarations).toHaveLength(0);
  });
});

describe("consolidation", () => {
  it("groups an exact copy and a revision, and counts the content variants", () => {
    const result = run(consolidationSet(), {
      nearDuplicatePairs: [
        { artifact_a_id: "cons-orig", artifact_b_id: "cons-revised", score: 0.9 },
      ],
    });
    const withVariants = result.consolidations.candidates.filter(
      (candidate) => candidate.unique_content_variant_count > 1,
    );
    expect(withVariants.length).toBeGreaterThan(0);
  });

  it("routes a multi-variant group for consolidation analysis", () => {
    const result = run(consolidationSet(), {
      nearDuplicatePairs: [
        { artifact_a_id: "cons-orig", artifact_b_id: "cons-revised", score: 0.9 },
      ],
    });
    const types = new Set(
      result.reasoningCandidates
        .filter((row) => row.candidate_type === "CONSOLIDATION_CANDIDATE")
        .map((row) => row.reasoning_type),
    );
    expect(types.has("CONSOLIDATION_ANALYSIS") || types.has("SUPERSESSION_ANALYSIS")).toBe(true);
  });

  it("carries no field that could be read as an instruction", () => {
    const result = run(consolidationSet());
    const rendered = JSON.stringify(result.consolidations);
    for (const forbidden of [
      "delete_these_files", "keeper", "canonical_copy", "merge_into", "recommended_action",
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
  });
});

describe("the whole emitted surface", () => {
  const all = [
    ...explicitSameProject(), ...lexicalRelated(), ...statusConflict(),
    ...consolidationSet(), ...exactDuplicates(),
  ];

  it("invents no strategy judgement anywhere", () => {
    const result = run(all);
    const rendered = JSON.stringify([
      result.relations, result.topics, result.projects,
      result.consolidations, result.reasoningCandidates, result.evidencePacks,
    ]);
    for (const forbidden of [
      "build_priority", "strategic_value", "percent_complete",
      "production_readiness_score", "abandonment_probability",
      "should_merge", "should_delete", "obsolete", "abandoned",
    ]) {
      expect(rendered).not.toContain(forbidden);
    }
  });

  it("resolves every candidate member and supporting pair to something real", () => {
    const result = run(all);
    const artifactIds = new Set(result.views.map((view) => view.artifact_id));
    const pairIds = new Set(result.relations.pairs.map((pair) => pair.pair_id));

    for (const candidate of [...result.topics.candidates, ...result.projects.candidates]) {
      for (const member of candidate.member_artifact_ids) expect(artifactIds.has(member)).toBe(true);
      for (const pairId of candidate.supporting_pair_ids) expect(pairIds.has(pairId)).toBe(true);
    }
    for (const candidate of result.consolidations.candidates) {
      for (const member of candidate.member_artifact_ids) expect(artifactIds.has(member)).toBe(true);
    }
  });

  it("gives every reasoning-eligible candidate a reason and a bounded pack", () => {
    const result = run(all);
    const eligible = result.reasoningCandidates.filter((row) => row.reasoning_type !== "NONE");
    const packByCandidate = new Map(
      result.evidencePacks.map((pack) => [pack.reasoning_candidate_id, pack]),
    );
    for (const row of eligible) {
      expect(row.reason.length).toBeGreaterThan(0);
      const pack = packByCandidate.get(row.reasoning_candidate_id);
      expect(pack).toBeDefined();
      expect(pack!.artifacts.length).toBeLessThanOrEqual(pack!.pack_profile.budget.maxArtifactsPerPack);
      for (const entry of pack!.artifacts) {
        expect(entry.excerpts.length).toBeLessThanOrEqual(pack!.pack_profile.budget.maxExcerptsPerArtifact);
      }
    }
  });

  it("replays byte-identically", () => {
    const first = run(all);
    const second = run(all);
    expect(JSON.stringify(second.relations)).toBe(JSON.stringify(first.relations));
    expect(JSON.stringify(second.topics)).toBe(JSON.stringify(first.topics));
    expect(JSON.stringify(second.projects)).toBe(JSON.stringify(first.projects));
    expect(JSON.stringify(second.consolidations)).toBe(JSON.stringify(first.consolidations));
    expect(JSON.stringify(second.reasoningCandidates)).toBe(JSON.stringify(first.reasoningCandidates));
    expect(JSON.stringify(second.evidencePacks)).toBe(JSON.stringify(first.evidencePacks));
  });

  it("gives one corpus the same candidate identities read from a different root", () => {
    const relocated = all.map((entry) => ({
      ...entry,
      root_id: "other-disk",
      corpus_path: entry.corpus_path.replace(/^[^:]+::/, "other-disk::"),
    }));
    const here = run(all);
    const there = run(relocated);
    expect(there.topics.candidates.map((c) => c.candidate_id))
      .toEqual(here.topics.candidates.map((c) => c.candidate_id));
    expect(there.projects.candidates.map((c) => c.candidate_id))
      .toEqual(here.projects.candidates.map((c) => c.candidate_id));
  });
});

describe("candidate generation by index", () => {
  it("finds what exhaustive scoring finds, on a corpus small enough to check both", () => {
    const all = [
      ...explicitSameProject(), ...lexicalRelated(), ...statusConflict(),
      ...consolidationSet(), ...exactDuplicates(), ...genericOverlapFalsePositive(),
    ];
    const views = buildFeatureViews(all);
    const comparison = referenceFixtureComparison({ views });

    // The blocked set may legitimately be smaller than exhaustive — a pair sharing
    // nothing is absent rather than zero — but it must not miss a pair that
    // exhaustive scoring found signals on.
    expect(comparison.missedPairIds).toEqual([]);
    expect(comparison.generated).toBe(comparison.exhaustive);
  });

  it("reports its own coverage rather than capping silently", () => {
    const result = run([...explicitSameProject(), ...lexicalRelated()]);
    expect(result.relations.generation.posting_ceiling).toBeGreaterThan(0);
    expect(result.relations.generation.scored_pair_count).toBeGreaterThan(0);
    expect(result.relations.generation.exhaustive_pair_count).toBeGreaterThanOrEqual(
      result.relations.generation.scored_pair_count,
    );
  });
});

describe("archive context on its own", () => {
  it("creates no candidate", () => {
    // Two unrelated documents that share only an enclosing archive.
    const artifacts = [
      ...genericOverlapFalsePositive().map((entry) => ({
        ...entry,
        archive_ancestry: ["shared.zip"],
        is_archive_member: true,
      })),
    ];
    const views = buildFeatureViews(artifacts);
    const pairs = buildSemanticPairs({ views });
    const contextOnly = pairs.pairs.filter((pair) =>
      pair.signals.every((signal) => signal.kind === "archive_context"));

    for (const pair of contextOnly) {
      expect(classifyPair(pair).context_only).toBe(true);
    }
    const result = run(artifacts);
    for (const candidate of result.projects.candidates) {
      // Any project candidate here must rest on something other than the archive.
      expect(candidate.confidence_class).not.toBe("weak");
    }
  });
});
