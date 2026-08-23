// semantic_fixtures.ts — the corpus the semantic contract is qualified against.
//
// Every case the contract names is built here as an explicit set of feature
// inputs rather than as files on disk. That is deliberate: the semantic layer's
// input is recorded evidence — assertions, declared identifiers, duplicate
// clusters — and stating that evidence directly is the only way a test can be
// unambiguous about which signal it is exercising. A fixture written as Markdown
// would additionally be testing the extractors, and a failure would not say which
// layer broke.
//
// The cases, and what each one is here to prove:
//
//   explicit same project      declared identifier + explicit reference admits a
//                              project candidate
//   lexical related            shared vocabulary admits a topic candidate and not
//                              a project one
//   semantic paraphrase        two documents about one subject sharing almost no
//                              words: invisible to lexical analysis, which is the
//                              case embeddings exist for
//   generic overlap            unrelated documents sharing "plan", "system",
//                              "design" must not reach strong
//   embedding only             a model's opinion alone caps at weak, creates no
//                              project candidate, and is never reasoning-eligible
//   cross archive versions     two archives holding one lineage keep provenance
//   exact duplicates           a fact, and never worth a reasoner's attention
//   status conflict            same project, contradictory declared statuses
//   supersession               a declared direction is preserved, never reversed
//   consolidation              a copy plus a revision with unique content
import type { SemanticArtifactInput } from "../../src/corpus_semantics";

/** Shorthand for building one artifact's recorded evidence. */
export function artifact(input: {
  id: string;
  path: string;
  root?: string;
  hash?: string;
  title?: string;
  headings?: string[];
  body?: string;
  status?: string;
  kind?: string;
  references?: string[];
  dependsOn?: string[];
  supersedes?: string;
  supersededBy?: string;
  blockedBy?: string;
  tasks?: string[];
  milestones?: string[];
  identifiers?: { identifier: string; manifest: string; field: string }[];
  archiveAncestry?: string[];
  duplicateCluster?: string | null;
  nearDuplicateIds?: string[];
}): SemanticArtifactInput {
  const root = input.root ?? "disk";
  const assertions: { assertion_id: string; predicate: string; object: string }[] = [];
  let counter = 0;
  const add = (predicate: string, object: string): void => {
    counter += 1;
    assertions.push({ assertion_id: `assert:${input.id}:${counter}`, predicate, object });
  };

  if (input.title !== undefined) add("document.title", input.title);
  for (const heading of input.headings ?? []) add("document.heading", heading);
  if (input.status !== undefined) add("work.status", input.status);
  if (input.kind !== undefined) add("work.kind", input.kind);
  for (const reference of input.references ?? []) add("work.references", reference);
  for (const dependency of input.dependsOn ?? []) add("work.depends_on", dependency);
  if (input.supersedes !== undefined) add("work.supersedes", input.supersedes);
  if (input.supersededBy !== undefined) add("work.superseded_by", input.supersededBy);
  if (input.blockedBy !== undefined) add("work.blocked_by", input.blockedBy);
  for (const task of input.tasks ?? []) add("work.task.open", task);
  for (const milestone of input.milestones ?? []) add("work.milestone", milestone);

  return {
    artifact_id: input.id,
    root_id: root,
    corpus_path: `${root}::${input.path}`,
    root_relative_path: input.path,
    content_hash: input.hash ?? `sha256:${input.id}`,
    normalized_document_id: `normdoc:${input.hash ?? input.id}`,
    is_archive_member: (input.archiveAncestry ?? []).length > 0,
    archive_ancestry: input.archiveAncestry ?? [],
    assertions,
    declared_identifiers: input.identifiers ?? [],
    exact_duplicate_cluster_id: input.duplicateCluster ?? null,
    near_duplicate_candidate_ids: input.nearDuplicateIds ?? [],
    ...(input.body !== undefined ? { body_text: input.body } : {}),
  };
}

const WORLD_MODEL_BODY = [
  "The world model plane consumes reasoning candidates and evidence packs. It stores temporal",
  "assertions in the knowledge graph so that a later question about what was believed at a given",
  "time can be answered from recorded evidence rather than from a summary.",
].join(" ");

const WORLD_MODEL_NOTES_BODY = [
  "Implementation notes for the world model plane. The knowledge graph holds temporal assertions,",
  "and each one cites the document that declared it so the belief can be checked.",
].join(" ");

/** Case 1: an explicit shared identifier plus an explicit reference. */
export function explicitSameProject(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "wm-plan", path: "world-model/plan.md", title: "World Model Plan",
      headings: ["Reasoning Plane", "Evidence Packs"], body: WORLD_MODEL_BODY,
      references: ["world-model/notes.md"],
      identifiers: [{ identifier: "world-model", manifest: "package.json", field: "name" }],
    }),
    artifact({
      id: "wm-notes", path: "world-model/notes.md", title: "World Model Implementation Notes",
      headings: ["Reasoning Plane", "Knowledge Graph"], body: WORLD_MODEL_NOTES_BODY,
      identifiers: [{ identifier: "world-model", manifest: "package.json", field: "name" }],
    }),
  ];
}

/** Case 2: shared vocabulary and headings, no declared identity, no graph edge. */
export function lexicalRelated(): SemanticArtifactInput[] {
  const shared = [
    "The ingest scheduler batches documents by decoder cost and retries transient decoder failures.",
    "Backpressure is applied per decoder so a slow decoder cannot starve the others.",
  ].join(" ");
  return [
    artifact({
      id: "ingest-a", path: "notes/ingest-scheduler.md", title: "Ingest Scheduler",
      headings: ["Backpressure", "Decoder Cost"], body: shared,
    }),
    artifact({
      id: "ingest-b", path: "notes/scheduler-review.md", title: "Ingest Scheduler Review",
      headings: ["Backpressure", "Decoder Cost"],
      body: shared + " The review confirms the backpressure model and the decoder cost estimates.",
    }),
  ];
}

/**
 * Case 3: one subject, disjoint vocabulary.
 *
 * Deliberately worded so lexical overlap is near zero. Without embeddings these
 * two are unrelated as far as this package can tell, and that is the honest
 * result rather than a failure.
 */
export function semanticParaphrase(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "para-a", path: "notes/persistence.md", title: "Temporal Assertion Persistence",
      body: "Persist temporal assertions in the knowledge graph.",
    }),
    artifact({
      id: "para-b", path: "notes/durable.md", title: "Durable Semantic Memory",
      body: "Store time-aware facts in durable semantic memory.",
    }),
  ];
}

/** Case 4: unrelated subjects sharing only generic project vocabulary. */
export function genericOverlapFalsePositive(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "generic-a", path: "notes/kitchen-plan.md", title: "Kitchen Renovation Plan",
      headings: ["System", "Design"],
      body: "Plan the kitchen renovation. The system design covers cabinets, worktops and the sink.",
    }),
    artifact({
      id: "generic-b", path: "notes/payroll-plan.md", title: "Payroll Migration Plan",
      headings: ["System", "Design"],
      body: "Plan the payroll migration. The system design covers tax tables, payslips and banking.",
    }),
  ];
}

/** Case 6: one lineage across two archives. */
export function crossArchiveVersions(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "arch-old", path: "old.zip!/world-model-plan.md", title: "World Model Plan",
      headings: ["Reasoning Plane"], body: WORLD_MODEL_BODY, archiveAncestry: ["old.zip"],
      identifiers: [{ identifier: "world-model", manifest: "package.json", field: "name" }],
      duplicateCluster: "cluster:wm",
    }),
    artifact({
      id: "arch-new", path: "backup.zip!/world-model-plan-revised.md",
      title: "World Model Plan Revised", headings: ["Reasoning Plane"],
      body: WORLD_MODEL_BODY + " Revised after the reasoning plane review.",
      archiveAncestry: ["backup.zip"],
      identifiers: [{ identifier: "world-model", manifest: "package.json", field: "name" }],
      duplicateCluster: "cluster:wm",
    }),
  ];
}

/** Case 7: byte-identical copies. */
export function exactDuplicates(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "dup-a", path: "a/report.md", hash: "sha256:identical", title: "Quarterly Report",
      body: "The quarterly report covers revenue, churn and headcount.",
      duplicateCluster: "cluster:dup",
    }),
    artifact({
      id: "dup-b", path: "b/report.md", hash: "sha256:identical", title: "Quarterly Report",
      body: "The quarterly report covers revenue, churn and headcount.",
      duplicateCluster: "cluster:dup",
    }),
  ];
}

/** Case 8: one project by declared identity, contradictory declared statuses. */
export function statusConflict(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "status-a", path: "gateway/design.md", title: "Gateway Design", status: "WIP",
      headings: ["Routing"], body: "The gateway routes requests by tenant and applies rate limits.",
      identifiers: [{ identifier: "gateway", manifest: "package.json", field: "name" }],
      references: ["gateway/rollout.md"],
    }),
    artifact({
      id: "status-b", path: "gateway/rollout.md", title: "Gateway Rollout", status: "Complete",
      headings: ["Routing"], body: "The gateway rollout applies rate limits per tenant in production.",
      identifiers: [{ identifier: "gateway", manifest: "package.json", field: "name" }],
    }),
  ];
}

/** Case 9: an explicit supersession declaration. */
export function supersession(): SemanticArtifactInput[] {
  return [
    artifact({
      id: "design-v2", path: "design-v2.md", title: "Design v2", supersedes: "design-v1.md",
      headings: ["Storage"], body: "Design v2 replaces the storage layer with content addressing.",
      identifiers: [{ identifier: "storage", manifest: "package.json", field: "name" }],
    }),
    artifact({
      id: "design-v1", path: "design-v1.md", title: "Design v1",
      headings: ["Storage"], body: "Design v1 describes the storage layer before content addressing.",
      identifiers: [{ identifier: "storage", manifest: "package.json", field: "name" }],
    }),
  ];
}

/** Case 10: an exact copy and a revision that carries unique sections. */
export function consolidationSet(): SemanticArtifactInput[] {
  const body = "The migration runbook lists the cutover steps and the rollback plan.";
  return [
    artifact({
      id: "cons-orig", path: "runbook.md", hash: "sha256:runbook", title: "Migration Runbook",
      body, duplicateCluster: "cluster:runbook",
    }),
    artifact({
      id: "cons-copy", path: "backup/runbook.md", hash: "sha256:runbook", title: "Migration Runbook",
      body, duplicateCluster: "cluster:runbook",
    }),
    artifact({
      id: "cons-revised", path: "runbook-revised.md", hash: "sha256:runbook-revised",
      title: "Migration Runbook Revised",
      body: body + " The revision adds a verification step and a comms checklist.",
      supersedes: "runbook.md",
      nearDuplicateIds: ["near:runbook"],
    }),
  ];
}
