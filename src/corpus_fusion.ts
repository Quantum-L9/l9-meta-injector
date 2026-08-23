// corpus_fusion.ts — from pair signals to typed candidates, under a stated policy.
//
// A pair with signals on it is not yet a claim. This module turns pairs into three
// kinds of candidate, and the entire difficulty is in *not* turning them into more
// than that.
//
// The rule that does most of the work is corroboration by independent family. A
// title overlap, a heading overlap and a keyphrase overlap look like three
// agreeing signals and are not: they are one document's vocabulary measured three
// ways, and they agree because they must. So evidence is counted by family —
// lexical, declared identity, graph, semantic model, context — and three lexical
// metrics count once. Without that rule every pair of documents written by the
// same person in the same style would corroborate itself into a strong candidate.
//
// The three candidate types answer three different questions, and keeping them
// apart is the point:
//
//   TOPIC_CANDIDATE          these documents show evidence of discussing related
//                            subject matter. Not that they are one project.
//   PROJECT_CANDIDATE        there is evidence these may belong to one body of
//                            work. Admission needs declared identity or an
//                            explicit graph edge or corroborated similarity —
//                            never similarity alone, and never a shared folder.
//   CONSOLIDATION_CANDIDATE  there is enough here that a person may want to look
//                            at these together. Not that anything should be
//                            merged or deleted.
//
// Exact duplication stays a fact and is carried through unchanged. It is also,
// deliberately, not evidence of a shared project: two byte-identical files prove
// a copy happened, and copies happen across projects all the time.
import { compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";
import { SIGNAL_FAMILY } from "./corpus_pairs";
import type { EvidenceFamily, PairSignal, PairSignalKind, SemanticPair } from "./corpus_pairs";
import type { ArtifactFeatureView } from "./corpus_semantics";

export const FUSION_PROFILE_ID = "semantic-fusion/v1";
export const FUSION_PROFILE_VERSION = "1.0.0";

export const TOPIC_CANDIDATE_SCHEMA = "l9.topic-candidates/v1";
export const PROJECT_CANDIDATE_SCHEMA = "l9.project-candidates/v1";
export const CONSOLIDATION_CANDIDATE_SCHEMA = "l9.consolidation-candidates/v1";
export const SEMANTIC_RELATIONS_SCHEMA = "l9.semantic-relations/v1";

/**
 * Score at or above which a graded signal counts as *strongly* supporting.
 *
 * Stated once, here, and bound into the profile hash. The contract's warning
 * against tuning thresholds until fixtures pass is the reason these are constants
 * rather than parameters: a threshold that moves to fit the corpus is a
 * description of the corpus.
 */
export const STRONG_SIGNAL_THRESHOLDS: Readonly<Partial<Record<PairSignalKind, number>>> = {
  title_overlap: 0.5,
  heading_overlap: 0.5,
  keyphrase_overlap: 0.5,
  dependency_overlap: 0.5,
  near_duplicate: 0.85,
};

/** Default cosine at which an embedding pair is *offered* at all. */
export const DEFAULT_EMBEDDING_PAIR_THRESHOLD = 0.75;
/** Default cosine at which an embedding signal counts as strong. */
export const DEFAULT_EMBEDDING_STRONG_THRESHOLD = 0.85;

/** Signals that are a source's own declaration rather than a measurement. */
const SOURCE_DECLARED: ReadonlySet<PairSignalKind> = new Set<PairSignalKind>([
  "declared_identifier_match",
  "explicit_reference",
]);

export type ConfidenceClass = "weak" | "moderate" | "strong";

export interface FusionOptions {
  embeddingStrongThreshold?: number;
}

export function fusionProfileHash(options: FusionOptions = {}): string {
  // Every threshold is encoded as a fixed-precision string. The canonical hasher
  // rejects non-integer numbers on purpose — float formatting differs between
  // runtimes — so a profile identity built from raw floats would not be portable.
  const thresholds: Record<string, string> = {};
  for (const [kind, value] of Object.entries(STRONG_SIGNAL_THRESHOLDS)) {
    if (value !== undefined) thresholds[kind] = value.toFixed(6);
  }
  return stableId("fusion-profile", {
    embedding_strong_threshold:
      (options.embeddingStrongThreshold ?? DEFAULT_EMBEDDING_STRONG_THRESHOLD).toFixed(6),
    profile_id: FUSION_PROFILE_ID,
    profile_version: FUSION_PROFILE_VERSION,
    signal_families: SIGNAL_FAMILY,
    strong_signal_thresholds: thresholds,
  });
}

// ───────────────────────────── pair classification ─────────────────────────────

function isStrong(signal: PairSignal, embeddingStrongThreshold: number): boolean {
  if (signal.kind === "archive_context") return false;
  if (signal.kind === "embedding_similarity") return signal.score >= embeddingStrongThreshold;
  if (SOURCE_DECLARED.has(signal.kind) || signal.kind === "exact_duplicate") return true;
  const threshold = STRONG_SIGNAL_THRESHOLDS[signal.kind];
  return threshold !== undefined && signal.score >= threshold;
}

export interface PairClassification {
  pair_id: string;
  artifact_a_id: string;
  artifact_b_id: string;
  confidence_class: ConfidenceClass;
  /** Families present, context excluded. Context corroborates nothing. */
  supporting_families: EvidenceFamily[];
  strong_families: EvidenceFamily[];
  family_counts: Record<EvidenceFamily, number>;
  has_exact_duplicate: boolean;
  /** True when the only non-context signal is an embedding score. */
  embedding_only: boolean;
  /** True when nothing but shared archive ancestry was found. */
  context_only: boolean;
}

/**
 * Classify one pair.
 *
 * `context_only` pairs get a classification so the accounting stays complete, but
 * every candidate builder below refuses them: a shared folder is where two files
 * are, not what they are about.
 */
export function classifyPair(
  pair: SemanticPair,
  options: FusionOptions = {},
): PairClassification {
  const embeddingStrongThreshold =
    options.embeddingStrongThreshold ?? DEFAULT_EMBEDDING_STRONG_THRESHOLD;

  const familyCounts: Record<EvidenceFamily, number> = {
    lexical: 0, declared_identity: 0, graph: 0, semantic_model: 0, context: 0,
  };
  const supporting = new Set<EvidenceFamily>();
  const strong = new Set<EvidenceFamily>();
  /** Distinct strong metric kinds seen per family, for the within-family rule. */
  const strongKindsByFamily = new Map<EvidenceFamily, Set<PairSignalKind>>();
  let hasExactDuplicate = false;
  let hasSourceDeclared = false;

  for (const signal of pair.signals) {
    const family = SIGNAL_FAMILY[signal.kind];
    familyCounts[family] += 1;
    if (signal.kind === "exact_duplicate") hasExactDuplicate = true;
    if (family === "context") continue;
    supporting.add(family);
    if (isStrong(signal, embeddingStrongThreshold)) {
      strong.add(family);
      const kinds = strongKindsByFamily.get(family) ?? new Set<PairSignalKind>();
      kinds.add(signal.kind);
      strongKindsByFamily.set(family, kinds);
      if (SOURCE_DECLARED.has(signal.kind)) hasSourceDeclared = true;
    }
  }

  const stronglyCorroboratedWithinFamily = [...strongKindsByFamily.values()].some(
    (kinds) => kinds.size >= 2,
  );

  const contextOnly = supporting.size === 0;
  const embeddingOnly = supporting.size === 1 && supporting.has("semantic_model");

  let confidence: ConfidenceClass;
  if (contextOnly) {
    confidence = "weak";
  } else if (embeddingOnly) {
    // A model saying two documents are close is a candidate and never more,
    // however close it says they are. This is also why the within-family rule
    // below cannot rescue it: the semantic-model family has exactly one metric,
    // so it can never corroborate itself.
    confidence = "weak";
  } else if (supporting.size >= 2 && strong.size >= 2) {
    confidence = "strong";
  } else if (supporting.size >= 2 || hasSourceDeclared) {
    confidence = "moderate";
  } else if (stronglyCorroboratedWithinFamily) {
    // The contract defines `weak` as *one* signal without corroboration and
    // `moderate` as *two independent families*, which leaves a real case
    // unnamed: a pair carrying several strong metrics inside one family. Two
    // documents sharing a title, their headings and their body vocabulary are
    // that case, and calling it weak would mean no topic candidate could ever
    // form from lexical evidence — which is the one thing topic candidates are
    // for.
    //
    // It resolves upward to moderate, and deliberately no further: `strong`
    // still requires two independent families, so this can never on its own
    // produce a strong relationship. Project admission is unaffected — it has
    // its own rule and still demands declared identity, a graph edge, or two
    // genuinely independent families.
    confidence = "moderate";
  } else {
    confidence = "weak";
  }

  const order = (values: Set<EvidenceFamily>): EvidenceFamily[] =>
    [...values].sort(compareCodePoints);

  return {
    pair_id: pair.pair_id,
    artifact_a_id: pair.artifact_a_id,
    artifact_b_id: pair.artifact_b_id,
    confidence_class: confidence,
    supporting_families: order(supporting),
    strong_families: order(strong),
    family_counts: familyCounts,
    has_exact_duplicate: hasExactDuplicate,
    embedding_only: embeddingOnly,
    context_only: contextOnly,
  };
}

// ───────────────────────────── clustering ─────────────────────────────

/**
 * Connected components over an edge set.
 *
 * Chosen over community detection deliberately: a component is a statement a
 * person can check by following edges, and every edge in it is in the output.
 * A modularity score is not checkable that way.
 */
function connectedComponents(
  edges: readonly { a: string; b: string }[],
): string[][] {
  const parent = new Map<string, string>();
  const find = (node: string): string => {
    let root = parent.get(node) ?? node;
    if (root !== node) {
      root = find(root);
      parent.set(node, root);
    }
    return root;
  };
  const union = (x: string, y: string): void => {
    const rx = find(x);
    const ry = find(y);
    if (rx === ry) return;
    // Union by code point keeps the representative deterministic.
    if (compareCodePoints(rx, ry) <= 0) parent.set(ry, rx);
    else parent.set(rx, ry);
  };

  for (const edge of edges) {
    if (!parent.has(edge.a)) parent.set(edge.a, edge.a);
    if (!parent.has(edge.b)) parent.set(edge.b, edge.b);
    union(edge.a, edge.b);
  }

  const groups = new Map<string, string[]>();
  for (const node of parent.keys()) {
    const root = find(node);
    const members = groups.get(root) ?? [];
    members.push(node);
    groups.set(root, members);
  }
  return [...groups.values()]
    .map((members) => [...new Set(members)].sort(compareCodePoints))
    .filter((members) => members.length > 1)
    .sort((a, b) => compareCodePoints(a[0] as string, b[0] as string));
}

// ───────────────────────────── candidate records ─────────────────────────────

export interface CandidateAnalysisProfile {
  fusion_profile_id: string;
  fusion_profile_version: string;
  fusion_profile_hash: string;
}

export interface TopicCandidate {
  candidate_id: string;
  candidate_type: "TOPIC_CANDIDATE";
  member_artifact_ids: string[];
  supporting_pair_ids: string[];
  evidence_family_counts: Record<EvidenceFamily, number>;
  lexical_signal_count: number;
  semantic_signal_count: number;
  explicit_reference_count: number;
  cross_archive: boolean;
  confidence_class: ConfidenceClass;
  ambiguity_class: string[];
  representative_keyphrases: string[];
  analysis_profile: CandidateAnalysisProfile;
}

export interface ProjectCandidate {
  candidate_id: string;
  candidate_type: "PROJECT_CANDIDATE";
  member_artifact_ids: string[];
  supporting_pair_ids: string[];
  declared_identifiers: string[];
  explicit_reference_count: number;
  dependency_signal_count: number;
  duplicate_cluster_count: number;
  near_duplicate_count: number;
  work_statuses: string[];
  work_kinds: string[];
  open_task_count: number;
  milestone_count: number;
  cross_archive: boolean;
  confidence_class: ConfidenceClass;
  ambiguity_class: string[];
  analysis_profile: CandidateAnalysisProfile;
}

export interface ConsolidationCandidate {
  candidate_id: string;
  candidate_type: "CONSOLIDATION_CANDIDATE";
  member_artifact_ids: string[];
  exact_duplicate_cluster_ids: string[];
  near_duplicate_candidate_ids: string[];
  supersession_assertion_ids: string[];
  project_candidate_ids: string[];
  cross_archive: boolean;
  content_hash_count: number;
  /** Distinct content hashes: 1 means every member is byte-identical. */
  unique_content_variant_count: number;
  work_statuses: string[];
  ambiguity_flags: string[];
  evidence_refs: string[];
  /** What admitted this candidate, so the reasoning router can read it. */
  evidence_class: string;
  analysis_profile: CandidateAnalysisProfile;
}

export const AMBIGUITY_CONFLICTING_STATUS = "conflicting_status";
export const AMBIGUITY_MULTIPLE_PROJECT_NAMES = "multiple_declared_project_names";
export const AMBIGUITY_AMBIGUOUS_SUPERSESSION = "ambiguous_supersession";
export const AMBIGUITY_MIXED_VERSION_LINEAGE = "mixed_version_lineage";
export const AMBIGUITY_WEAKLY_CONNECTED = "weakly_connected_members";

/** Statuses that contradict each other when declared inside one body of work. */
const TERMINAL_STATUSES = new Set(["complete", "completed", "done", "shipped", "released"]);
const ACTIVE_STATUSES = new Set(["wip", "in progress", "in-progress", "draft", "todo", "blocked"]);

function conflictingStatuses(statuses: readonly string[]): boolean {
  let terminal = false;
  let active = false;
  for (const status of statuses) {
    if (TERMINAL_STATUSES.has(status)) terminal = true;
    if (ACTIVE_STATUSES.has(status)) active = true;
  }
  return terminal && active;
}

export interface BuildCandidatesInput {
  views: readonly ArtifactFeatureView[];
  pairs: readonly SemanticPair[];
  options?: FusionOptions;
}

interface Context {
  byId: Map<string, ArtifactFeatureView>;
  pairById: Map<string, SemanticPair>;
  classifications: PairClassification[];
  profile: CandidateAnalysisProfile;
}

function contextOf(input: BuildCandidatesInput): Context {
  const options = input.options ?? {};
  return {
    byId: new Map(input.views.map((view) => [view.artifact_id, view])),
    pairById: new Map(input.pairs.map((pair) => [pair.pair_id, pair])),
    classifications: input.pairs.map((pair) => classifyPair(pair, options)),
    profile: {
      fusion_profile_id: FUSION_PROFILE_ID,
      fusion_profile_version: FUSION_PROFILE_VERSION,
      fusion_profile_hash: fusionProfileHash(options),
    },
  };
}

function crossArchive(members: readonly string[], byId: Map<string, ArtifactFeatureView>): boolean {
  const ancestries = new Set<string>();
  for (const id of members) {
    const view = byId.get(id);
    if (view === undefined) continue;
    ancestries.add(view.archive_ancestry.join("/"));
  }
  return ancestries.size > 1;
}

function signalCount(
  pairs: readonly SemanticPair[],
  predicate: (signal: PairSignal) => boolean,
): number {
  let count = 0;
  for (const pair of pairs) {
    for (const signal of pair.signals) {
      if (predicate(signal)) count += 1;
    }
  }
  return count;
}

/** Members' supporting pairs: those whose both endpoints are in the member set. */
function pairsWithin(
  members: readonly string[],
  classifications: readonly PairClassification[],
  pairById: Map<string, SemanticPair>,
): { classifications: PairClassification[]; pairs: SemanticPair[] } {
  const set = new Set(members);
  const inside = classifications.filter(
    (entry) => set.has(entry.artifact_a_id) && set.has(entry.artifact_b_id),
  );
  const pairs = inside
    .map((entry) => pairById.get(entry.pair_id))
    .filter((pair): pair is SemanticPair => pair !== undefined);
  return { classifications: inside, pairs };
}

function strongestClass(entries: readonly PairClassification[]): ConfidenceClass {
  if (entries.some((entry) => entry.confidence_class === "strong")) return "strong";
  if (entries.some((entry) => entry.confidence_class === "moderate")) return "moderate";
  return "weak";
}

// ───────────────────────────── topic candidates ─────────────────────────────

/**
 * Topic candidates: connected components over corroborated edges.
 *
 * Only moderate and strong edges are admitted. A weak edge — one lexical metric,
 * or an embedding score on its own — is exactly the kind that chains unrelated
 * documents into one enormous component, which is the failure mode that makes
 * clustering output useless rather than merely wrong.
 */
export function buildTopicCandidates(input: BuildCandidatesInput): TopicCandidate[] {
  const context = contextOf(input);
  const edges = context.classifications
    .filter((entry) => !entry.context_only && !entry.embedding_only)
    .filter((entry) => entry.confidence_class !== "weak")
    .map((entry) => ({ a: entry.artifact_a_id, b: entry.artifact_b_id }));

  return connectedComponents(edges).map((members) => {
    const within = pairsWithin(members, context.classifications, context.pairById);
    const families: Record<EvidenceFamily, number> = {
      lexical: 0, declared_identity: 0, graph: 0, semantic_model: 0, context: 0,
    };
    for (const entry of within.classifications) {
      for (const family of Object.keys(families) as EvidenceFamily[]) {
        families[family] += entry.family_counts[family];
      }
    }

    const keyphrases = new Map<string, number>();
    for (const id of members) {
      for (const keyphrase of context.byId.get(id)?.keyphrases ?? []) {
        keyphrases.set(
          keyphrase.normalized_term,
          (keyphrases.get(keyphrase.normalized_term) ?? 0) + keyphrase.weight,
        );
      }
    }

    const candidateId = stableId("l9.topic-candidate/v1", {
      fusion_profile: context.profile.fusion_profile_hash,
      member_artifact_ids: [...members].sort(compareCodePoints),
    });

    return {
      candidate_id: candidateId,
      candidate_type: "TOPIC_CANDIDATE" as const,
      member_artifact_ids: members,
      supporting_pair_ids: within.classifications.map((entry) => entry.pair_id).sort(compareCodePoints),
      evidence_family_counts: families,
      lexical_signal_count: signalCount(within.pairs, (s) => SIGNAL_FAMILY[s.kind] === "lexical"),
      semantic_signal_count: signalCount(within.pairs, (s) => s.kind === "embedding_similarity"),
      explicit_reference_count: signalCount(within.pairs, (s) => s.kind === "explicit_reference"),
      cross_archive: crossArchive(members, context.byId),
      confidence_class: strongestClass(within.classifications),
      ambiguity_class: within.classifications.every((entry) => entry.confidence_class === "moderate")
        ? [AMBIGUITY_WEAKLY_CONNECTED]
        : [],
      representative_keyphrases: [...keyphrases.entries()]
        .sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0]))
        .slice(0, 8)
        .map(([term]) => term),
      analysis_profile: context.profile,
    };
  });
}

// ───────────────────────────── project candidates ─────────────────────────────

/**
 * Whether an edge may join two artifacts into one body of work.
 *
 * Stricter than topic admission, and the strictness is the contract: declared
 * identity, an explicit graph edge, or similarity corroborated across two
 * independent families of which one is declared identity, graph or lexical. An
 * embedding score never qualifies on its own, and neither does a shared archive.
 */
export function isProjectEligibleEdge(entry: PairClassification): boolean {
  if (entry.context_only || entry.embedding_only) return false;
  if (entry.family_counts.declared_identity > 0) return true;
  if (entry.family_counts.graph > 0) return true;
  const independent = entry.supporting_families.length;
  const hasQualifying = entry.supporting_families.some(
    (family) => family === "declared_identity" || family === "graph" || family === "lexical",
  );
  return independent >= 2 && hasQualifying;
}

export function buildProjectCandidates(input: BuildCandidatesInput): ProjectCandidate[] {
  const context = contextOf(input);
  const edges = context.classifications
    .filter(isProjectEligibleEdge)
    .map((entry) => ({ a: entry.artifact_a_id, b: entry.artifact_b_id }));

  return connectedComponents(edges).map((members) => {
    const within = pairsWithin(members, context.classifications, context.pairById);
    const views = members
      .map((id) => context.byId.get(id))
      .filter((view): view is ArtifactFeatureView => view !== undefined);

    const identifiers = new Set<string>();
    const statuses = new Set<string>();
    const kinds = new Set<string>();
    const clusters = new Set<string>();
    let openTasks = 0;
    let milestones = 0;
    let supersessions = 0;
    for (const view of views) {
      for (const identifier of view.declared_project_identifiers) identifiers.add(identifier);
      for (const status of view.statuses) statuses.add(status);
      for (const kind of view.kinds) kinds.add(kind);
      if (view.exact_duplicate_cluster_id !== null) clusters.add(view.exact_duplicate_cluster_id);
      openTasks += view.task_terms.length > 0 ? 1 : 0;
      milestones += view.milestone_terms.length > 0 ? 1 : 0;
      supersessions += view.supersession_declarations.length;
    }

    const sortedStatuses = [...statuses].sort(compareCodePoints);
    const ambiguity: string[] = [];
    if (conflictingStatuses(sortedStatuses)) ambiguity.push(AMBIGUITY_CONFLICTING_STATUS);
    if (identifiers.size > 1) ambiguity.push(AMBIGUITY_MULTIPLE_PROJECT_NAMES);
    if (supersessions > 1) ambiguity.push(AMBIGUITY_AMBIGUOUS_SUPERSESSION);
    if (clusters.size > 0 && views.length > clusters.size + 1) {
      ambiguity.push(AMBIGUITY_MIXED_VERSION_LINEAGE);
    }
    if (within.classifications.every((entry) => entry.confidence_class !== "strong")) {
      ambiguity.push(AMBIGUITY_WEAKLY_CONNECTED);
    }

    const candidateId = stableId("l9.project-candidate/v1", {
      fusion_profile: context.profile.fusion_profile_hash,
      member_artifact_ids: [...members].sort(compareCodePoints),
    });

    return {
      candidate_id: candidateId,
      candidate_type: "PROJECT_CANDIDATE" as const,
      member_artifact_ids: members,
      supporting_pair_ids: within.classifications.map((entry) => entry.pair_id).sort(compareCodePoints),
      declared_identifiers: [...identifiers].sort(compareCodePoints),
      explicit_reference_count: signalCount(within.pairs, (s) => s.kind === "explicit_reference"),
      dependency_signal_count: signalCount(within.pairs, (s) => s.kind === "dependency_overlap"),
      duplicate_cluster_count: clusters.size,
      near_duplicate_count: signalCount(within.pairs, (s) => s.kind === "near_duplicate"),
      work_statuses: sortedStatuses,
      work_kinds: [...kinds].sort(compareCodePoints),
      open_task_count: openTasks,
      milestone_count: milestones,
      cross_archive: crossArchive(members, context.byId),
      confidence_class: strongestClass(within.classifications),
      ambiguity_class: [...new Set(ambiguity)].sort(compareCodePoints),
      analysis_profile: context.profile,
    };
  });
}

// ───────────────────────────── consolidation candidates ─────────────────────────────

export const CONSOLIDATION_EVIDENCE_EXACT_DUPLICATE = "exact_duplicate_cluster";
export const CONSOLIDATION_EVIDENCE_NEAR_DUPLICATE = "near_duplicate_relation";
export const CONSOLIDATION_EVIDENCE_SUPERSESSION = "explicit_supersession";
export const CONSOLIDATION_EVIDENCE_PROJECT_VERSIONS = "project_candidate_with_multiple_versions";

export interface BuildConsolidationInput extends BuildCandidatesInput {
  projectCandidates: readonly ProjectCandidate[];
}

/**
 * Consolidation candidates: groups worth looking at together.
 *
 * Admission is deliberately mechanical — a duplicate cluster, a near-duplicate
 * edge, a declared supersession, or a project candidate holding several content
 * variants. The record carries `unique_content_variant_count` because it is the
 * number that decides whether a human needs to read anything: a group whose
 * members are all byte-identical has one variant and nothing to adjudicate.
 */
export function buildConsolidationCandidates(
  input: BuildConsolidationInput,
): ConsolidationCandidate[] {
  const context = contextOf(input);
  const groups = new Map<string, { members: Set<string>; evidence: Set<string> }>();

  const record = (key: string, members: readonly string[], evidence: string): void => {
    const existing = groups.get(key) ?? { members: new Set<string>(), evidence: new Set<string>() };
    for (const member of members) existing.members.add(member);
    existing.evidence.add(evidence);
    groups.set(key, existing);
  };

  // Exact duplicate clusters.
  const byCluster = new Map<string, string[]>();
  for (const view of input.views) {
    if (view.exact_duplicate_cluster_id === null) continue;
    const members = byCluster.get(view.exact_duplicate_cluster_id) ?? [];
    members.push(view.artifact_id);
    byCluster.set(view.exact_duplicate_cluster_id, members);
  }
  for (const [clusterId, members] of byCluster) {
    if (members.length < 2) continue;
    record(`cluster:${clusterId}`, members, CONSOLIDATION_EVIDENCE_EXACT_DUPLICATE);
  }

  // Near-duplicate and declared-supersession pairs.
  for (const pair of input.pairs) {
    const hasNear = pair.signals.some((signal) => signal.kind === "near_duplicate");
    const hasSupersession = pair.signals.some(
      (signal) => signal.kind === "explicit_reference"
        && signal.detail.some((entry) => entry.includes("supersede")),
    );
    if (!hasNear && !hasSupersession) continue;
    record(
      `pair:${pair.pair_id}`,
      [pair.artifact_a_id, pair.artifact_b_id],
      hasSupersession ? CONSOLIDATION_EVIDENCE_SUPERSESSION : CONSOLIDATION_EVIDENCE_NEAR_DUPLICATE,
    );
  }

  // Project candidates that hold more than one *version of something*.
  //
  // Distinct content hashes are not enough on their own. A project with a plan
  // and a spec in it has two hashes and nothing to consolidate — admitting it
  // would make every multi-file project a consolidation candidate, which is a
  // false-positive generator rather than a finding. What is needed is evidence
  // of a lineage: a near-duplicate edge between members, or a member declaring
  // it supersedes another.
  const projectByKey = new Map<string, string>();
  for (const project of input.projectCandidates) {
    const members = new Set(project.member_artifact_ids);
    const hashes = new Set(
      project.member_artifact_ids
        .map((id) => context.byId.get(id)?.content_hash)
        .filter((hash): hash is string => typeof hash === "string"),
    );
    if (hashes.size < 2) continue;

    const hasVersionLineage = input.pairs.some(
      (pair) => members.has(pair.artifact_a_id)
        && members.has(pair.artifact_b_id)
        && pair.signals.some((signal) => signal.kind === "near_duplicate"),
    ) || project.member_artifact_ids.some(
      (id) => (context.byId.get(id)?.supersession_declarations.length ?? 0) > 0,
    );
    if (!hasVersionLineage) continue;

    const key = `project:${project.candidate_id}`;
    projectByKey.set(key, project.candidate_id);
    record(key, project.member_artifact_ids, CONSOLIDATION_EVIDENCE_PROJECT_VERSIONS);
  }

  const out: ConsolidationCandidate[] = [];
  for (const [key, group] of groups) {
    const members = [...group.members].sort(compareCodePoints);
    if (members.length < 2) continue;
    const views = members
      .map((id) => context.byId.get(id))
      .filter((view): view is ArtifactFeatureView => view !== undefined);

    const hashes = new Set(
      views.map((view) => view.content_hash).filter((hash): hash is string => typeof hash === "string"),
    );
    const clusters = new Set(
      views
        .map((view) => view.exact_duplicate_cluster_id)
        .filter((id): id is string => typeof id === "string"),
    );
    const nearIds = new Set<string>();
    for (const view of views) {
      for (const id of view.near_duplicate_candidate_ids) nearIds.add(id);
    }
    const supersessionIds = new Set<string>();
    for (const view of views) {
      for (const declaration of view.supersession_declarations) supersessionIds.add(declaration.assertion_id);
    }
    const statuses = new Set<string>();
    for (const view of views) {
      for (const status of view.statuses) statuses.add(status);
    }

    const within = pairsWithin(members, context.classifications, context.pairById);
    const evidenceRefs = new Set<string>();
    for (const pair of within.pairs) {
      for (const ref of pair.evidence_refs) evidenceRefs.add(ref);
    }

    const sortedStatuses = [...statuses].sort(compareCodePoints);
    const flags: string[] = [];
    if (conflictingStatuses(sortedStatuses)) flags.push(AMBIGUITY_CONFLICTING_STATUS);
    if (supersessionIds.size > 1) flags.push(AMBIGUITY_AMBIGUOUS_SUPERSESSION);
    if (hashes.size > 1 && clusters.size > 0) flags.push(AMBIGUITY_MIXED_VERSION_LINEAGE);

    const evidenceClass = [...group.evidence].sort(compareCodePoints).join("+");
    const projectId = projectByKey.get(key);

    out.push({
      candidate_id: stableId("l9.consolidation-candidate/v1", {
        evidence_class: evidenceClass,
        fusion_profile: context.profile.fusion_profile_hash,
        member_artifact_ids: members,
      }),
      candidate_type: "CONSOLIDATION_CANDIDATE" as const,
      member_artifact_ids: members,
      exact_duplicate_cluster_ids: [...clusters].sort(compareCodePoints),
      near_duplicate_candidate_ids: [...nearIds].sort(compareCodePoints),
      supersession_assertion_ids: [...supersessionIds].sort(compareCodePoints),
      project_candidate_ids: projectId === undefined ? [] : [projectId],
      cross_archive: crossArchive(members, context.byId),
      content_hash_count: hashes.size,
      unique_content_variant_count: hashes.size,
      work_statuses: sortedStatuses,
      ambiguity_flags: [...new Set(flags)].sort(compareCodePoints),
      evidence_refs: [...evidenceRefs].sort(compareCodePoints),
      evidence_class: evidenceClass,
      analysis_profile: context.profile,
    });
  }

  return out.sort((a, b) => compareCodePoints(a.candidate_id, b.candidate_id));
}
