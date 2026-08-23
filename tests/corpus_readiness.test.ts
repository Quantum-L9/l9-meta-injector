// corpus_readiness.test.ts — the evidence layer, and the line it must not cross.
//
// Two things are being held here at once. The first is that every readiness
// signal is derived from something citable — a filename, a path segment, an
// extension, or an assertion a document made about itself — and carries which of
// those it was. The second is that no value judgement is emitted under any name,
// which is checked by walking the whole emitted document rather than by trusting
// that nobody added one.
import { describe, expect, it } from "vitest";
import {
  BodyOfWorkContext,
  FORBIDDEN_READINESS_METRICS,
  NO_RANKING_STATEMENT,
  READINESS_SIGNALS,
  ReadinessArtifactInput,
  ReadinessSignal,
  buildBodyOfWork,
  buildReadinessArtifactEvidence,
  UNIQUE_CONTENT_METHOD,
  buildReadinessEvidence,
  readinessSignalsFor,
} from "../src/corpus_readiness";

function artifact(
  rootRelativePath: string,
  assertions: { predicate: string; object: string }[] = [],
  extra: Partial<ReadinessArtifactInput> = {},
): ReadinessArtifactInput {
  return {
    virtual_source_id: `vsrc:${rootRelativePath}`,
    corpus_path: `R::${rootRelativePath}`,
    root_relative_path: rootRelativePath,
    content_hash: `sha256:${rootRelativePath}`,
    size_bytes: 10,
    assertions,
    ...extra,
  };
}

function names(signals: readonly ReadinessSignal[]): string[] {
  return signals.map((signal) => signal.signal);
}

describe("signals read from a convention", () => {
  it("recognize source, tests, manifests, CI, containers, deployment and specs", () => {
    expect(names(readinessSignalsFor(artifact("src/index.ts")))).toEqual(["artifact.has_source_code"]);
    expect(names(readinessSignalsFor(artifact("tests/router.test.ts")))).toEqual([
      "artifact.has_source_code",
      "artifact.has_tests",
    ]);
    expect(names(readinessSignalsFor(artifact("src/router_test.go")))).toEqual([
      "artifact.has_source_code",
      "artifact.has_tests",
    ]);
    expect(names(readinessSignalsFor(artifact("package.json")))).toEqual(["artifact.has_build_manifest"]);
    expect(names(readinessSignalsFor(artifact(".github/workflows/ci.yml")))).toEqual([
      "artifact.has_ci_definition",
    ]);
    expect(names(readinessSignalsFor(artifact(".circleci/config.yml")))).toEqual([
      "artifact.has_ci_definition",
    ]);
    expect(names(readinessSignalsFor(artifact("Dockerfile")))).toEqual([
      "artifact.has_container_definition",
    ]);
    expect(names(readinessSignalsFor(artifact("infra/main.tf")))).toEqual([
      "artifact.has_deployment_definition",
    ]);
    expect(names(readinessSignalsFor(artifact("api/openapi.yaml")))).toEqual([
      "artifact.has_specification",
    ]);
    expect(names(readinessSignalsFor(artifact("docs/guide.md")))).toEqual([
      "artifact.has_documentation",
    ]);
  });

  it("carry the exact thing that decided them, and which kind of thing it was", () => {
    const [signal] = readinessSignalsFor(artifact(".github/workflows/release.yml"));
    expect(signal).toEqual({
      signal: "artifact.has_ci_definition",
      evidence_class: "path_convention",
      evidence: ".github/workflows/",
    });
    const [manifest] = readinessSignalsFor(artifact("services/api/package.json"));
    expect(manifest.evidence_class).toBe("filename_convention");
    expect(manifest.evidence).toBe("package.json");
  });

  it("read a test marker from a path inside an archive member the same way", () => {
    expect(names(readinessSignalsFor(artifact("bundle.zip!/pkg/tests/a.py")))).toEqual([
      "artifact.has_source_code",
      "artifact.has_tests",
    ]);
  });

  it("do not read a workflow from a yaml file that is merely named like one", () => {
    expect(names(readinessSignalsFor(artifact("config/ci.yml")))).toEqual([]);
    expect(names(readinessSignalsFor(artifact("workflows/ci.yml")))).toEqual([]);
  });
});

describe("signals read from a declaration", () => {
  it("come only from a predicate a document actually emitted", () => {
    expect(
      names(readinessSignalsFor(artifact("plans/a.md", [{ predicate: "work.task.open", object: "x" }]))),
    ).toEqual(["artifact.has_documentation", "artifact.has_open_tasks"]);
    expect(
      names(readinessSignalsFor(artifact("plans/a.md", [{ predicate: "work.status", object: "blocked" }]))),
    ).toEqual(["artifact.has_blockers", "artifact.has_documentation"]);
    expect(
      names(readinessSignalsFor(artifact("plans/a.md", [{ predicate: "work.kind", object: "roadmap" }]))),
    ).toEqual(["artifact.has_documentation", "artifact.has_roadmap"]);
    // A status outside the blocked vocabulary is not a blocker.
    expect(
      names(readinessSignalsFor(artifact("plans/a.md", [{ predicate: "work.status", object: "wip" }]))),
    ).toEqual(["artifact.has_documentation"]);
  });

  it("record the predicate as the evidence, and classify it as a declaration", () => {
    const signals = readinessSignalsFor(
      artifact("plans/a.md", [{ predicate: "work.kind", object: "plan" }]),
    );
    const plan = signals.find((signal) => signal.signal === "artifact.has_plan");
    expect(plan).toEqual({
      signal: "artifact.has_plan",
      evidence_class: "declared_assertion",
      evidence: "work.kind=plan",
    });
  });
});

describe("body-of-work metrics", () => {
  const inputs = [
    artifact("proj/package.json"),
    artifact("proj/src/a.ts"),
    artifact("proj/src/b.ts"),
    artifact("proj/tests/a.test.ts"),
    artifact("proj/PLAN.md", [
      { predicate: "work.kind", object: "plan" },
      { predicate: "work.task.open", object: "one" },
      { predicate: "work.task.open", object: "two" },
      { predicate: "work.task.completed", object: "three" },
      { predicate: "work.blocked_by", object: "procurement" },
      { predicate: "work.superseded_by", object: "the newer plan" },
    ]),
    artifact("proj/PLAN-copy.md", [], { content_hash: "sha256:proj/PLAN.md" }),
  ];
  const signalsById = new Map(
    inputs.map((input) => [input.virtual_source_id, readinessSignalsFor(input)]),
  );
  const context: BodyOfWorkContext = {
    signalsById,
    artifactsById: new Map(inputs.map((input) => [input.virtual_source_id, input])),
    rootById: new Map(inputs.map((input) => [input.virtual_source_id, "root:one"])),
    exactDuplicateIds: new Set(["vsrc:proj/PLAN.md", "vsrc:proj/PLAN-copy.md"]),
    nearDuplicatePairs: [["vsrc:proj/src/a.ts", "vsrc:proj/src/b.ts"]],
  };

  it("count what was observed and combine nothing", () => {
    const body = buildBodyOfWork(
      { origin: "project_candidate", origin_ref: "container:proj", member_ids: inputs.map((i) => i.virtual_source_id) },
      context,
    );
    expect(body.metrics).toEqual({
      corpus: { artifact_count: 6, root_count: 1, archive_count: 0, total_bytes: 60 },
      implementation: {
        source_artifact_count: 3,
        language_distribution: [{ language: ".ts", artifact_count: 3 }],
        manifest_count: 1,
        build_definition_count: 0,
      },
      // Structural, and named so: files placed and named like tests exist. It
      // does not say a test was run, and there is no metric here that could.
      validation: { structural_test_artifact_count: 1, ci_definition_count: 0 },
      delivery: { container_definition_count: 0, deployment_definition_count: 0 },
      knowledge: {
        specification_count: 0,
        documentation_count: 2,
        plan_count: 1,
        roadmap_count: 0,
      },
      work_state: {
        wip_count: 0,
        draft_count: 0,
        blocked_count: 1,
        complete_declared_count: 0,
        open_task_count: 2,
        completed_task_count: 1,
        milestone_count: 0,
      },
      dependency: { explicit_dependency_count: 0, explicit_blocker_count: 1 },
      reuse_and_duplication: {
        exact_duplicate_cluster_count: 0,
        exact_duplicate_artifact_count: 2,
        near_duplicate_candidate_count: 1,
        consolidation_candidate_count: 0,
        explicit_supersession_count: 1,
        content_variant_count: 1,
      },
      uncertainty: {
        conflicting_status_count: 0,
        unsupported_document_count: 0,
        // These inputs say nothing about decoding, and an absent report is not
        // the same claim as "a decoder tried and failed". Only an explicit
        // `decoded: false` is counted; see the uncertainty test below.
        undecoded_artifact_count: 0,
        coverage_gap_count: 0,
      },
      unique_content: {
        distinct_content_hash_count: 5,
        distinct_content_bytes: 50,
        method: UNIQUE_CONTENT_METHOD,
      },
    });
    expect(body.member_count).toBe(6);
    expect(body.root_ids).toEqual(["root:one"]);
  });

  it("give the same body the same id wherever it was computed", () => {
    const spec = { origin: "project_candidate" as const, origin_ref: "container:proj", member_ids: ["a"] };
    expect(buildBodyOfWork(spec, context).body_id).toBe(buildBodyOfWork(spec, context).body_id);
    expect(
      buildBodyOfWork({ ...spec, origin_ref: "container:other" }, context).body_id,
    ).not.toBe(buildBodyOfWork(spec, context).body_id);
  });
});

describe("the emitted document", () => {
  const inputs = [artifact("proj/package.json"), artifact("proj/src/a.ts")];
  const evidence = buildReadinessEvidence({
    corpusSnapshotId: "corpus-snapshot:test",
    artifacts: inputs,
    bodies: [
      {
        origin: "explicit_project_identifier",
        origin_ref: "project:widget",
        member_ids: inputs.map((input) => input.virtual_source_id),
      },
    ],
    context: {
      signalsById: new Map(inputs.map((i) => [i.virtual_source_id, readinessSignalsFor(i)])),
      artifactsById: new Map(inputs.map((i) => [i.virtual_source_id, i])),
      rootById: new Map(inputs.map((i) => [i.virtual_source_id, "root:one"])),
      exactDuplicateIds: new Set(),
      nearDuplicatePairs: [],
    },
  });

  it("declares its schema, its closed vocabulary and its refusals", () => {
    expect(evidence.schema).toBe("l9.readiness-evidence/v1");
    expect(evidence.profile.signal_vocabulary).toEqual(READINESS_SIGNALS);
    expect(evidence.profile.forbidden_metrics).toEqual(FORBIDDEN_READINESS_METRICS);
    expect(evidence.no_ranking_statement).toBe(NO_RANKING_STATEMENT);
  });

  it("contains no forbidden metric under any key, at any depth", () => {
    const keys: string[] = [];
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) return node.forEach(walk);
      if (node !== null && typeof node === "object") {
        for (const [key, value] of Object.entries(node)) {
          keys.push(key);
          walk(value);
        }
      }
    };
    walk({ ...evidence, profile: { ...evidence.profile, forbidden_metrics: [] } });
    for (const forbidden of FORBIDDEN_READINESS_METRICS) expect(keys).not.toContain(forbidden);
  });

  it("omits an artifact that carries no signal rather than emitting an empty one", () => {
    const evidenceRows = buildReadinessArtifactEvidence([
      artifact("bin/blob.bin"),
      artifact("src/a.ts"),
    ]);
    expect(evidenceRows.map((row) => row.corpus_path)).toEqual(["R::src/a.ts"]);
  });
});

describe("uncertainty", () => {
  // Three ways of not knowing, and they are not the same fact. A PDF nothing here
  // reads, bytes a decoder was given and could not turn into text, and a file
  // whose bytes were never established at all each tell an operator to do
  // something different, so they are counted apart.
  const inputs = [
    artifact("proj/design.pdf", [], { unsupported_format: true, decoded: false }),
    artifact("proj/blob.bin", [], { decoded: false }),
    artifact("proj/huge.iso", [], { content_hash: null, decoded: false }),
    artifact("proj/README.md", [], { decoded: true }),
  ];
  const context: BodyOfWorkContext = {
    signalsById: new Map(inputs.map((i) => [i.virtual_source_id, readinessSignalsFor(i)])),
    artifactsById: new Map(inputs.map((i) => [i.virtual_source_id, i])),
    rootById: new Map(inputs.map((i) => [i.virtual_source_id, "root:one"])),
    exactDuplicateIds: new Set(),
    nearDuplicatePairs: [],
  };

  it("separates an unread format from unread bytes from absent bytes", () => {
    const body = buildBodyOfWork(
      {
        origin: "project_candidate",
        origin_ref: "container:proj",
        member_ids: inputs.map((i) => i.virtual_source_id),
      },
      context,
    );
    expect(body.metrics.uncertainty).toEqual({
      conflicting_status_count: 0,
      unsupported_document_count: 1,
      undecoded_artifact_count: 1,
      coverage_gap_count: 1,
    });
    // Every member is accounted for: one decoded, three uncertain in three ways.
    expect(body.metrics.corpus.artifact_count).toBe(4);
  });

  it("reports a body whose documents disagree about their own state", () => {
    const disagreeing = [
      artifact("proj/A.md", [{ predicate: "work.status", object: "complete" }]),
      artifact("proj/B.md", [{ predicate: "work.status", object: "wip" }]),
      artifact("proj/C.md", []),
    ];
    const ctx: BodyOfWorkContext = {
      signalsById: new Map(disagreeing.map((i) => [i.virtual_source_id, readinessSignalsFor(i)])),
      artifactsById: new Map(disagreeing.map((i) => [i.virtual_source_id, i])),
      rootById: new Map(disagreeing.map((i) => [i.virtual_source_id, "root:one"])),
      exactDuplicateIds: new Set(),
      nearDuplicatePairs: [],
    };
    const body = buildBodyOfWork(
      {
        origin: "project_candidate",
        origin_ref: "container:proj",
        member_ids: disagreeing.map((i) => i.virtual_source_id),
      },
      ctx,
    );
    // Both declarations are counted, and neither is picked as the truth.
    expect(body.metrics.uncertainty.conflicting_status_count).toBe(2);
    expect(body.metrics.work_state.complete_declared_count).toBe(1);
    expect(body.metrics.work_state.wip_count).toBe(1);

    // One document declaring one status is not a conflict.
    const agreed = buildBodyOfWork(
      {
        origin: "project_candidate",
        origin_ref: "container:proj",
        member_ids: [disagreeing[0]!.virtual_source_id],
      },
      ctx,
    );
    expect(agreed.metrics.uncertainty.conflicting_status_count).toBe(0);
  });
});
