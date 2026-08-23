// corpus_readiness.ts — measurable evidence about what a body of work contains.
//
// The question a strategy layer wants answered is "which of these two hundred
// half-finished projects should I build next". This module deliberately does not
// answer it. It answers the questions underneath it — does this thing have
// tests, does it have a build manifest, does it declare open tasks, how many
// distinct documents does it actually contain — and leaves the weighing to
// whoever is entitled to weigh.
//
// That boundary is enforced rather than described. `FORBIDDEN_READINESS_METRICS`
// names the values that must never appear in this package's output, and a test
// walks the emitted JSON to prove none of them do. A percentage complete, a
// readiness score or an abandonment probability would each be an invented number
// wearing the same authority as a file count, and a file count is the only kind
// of thing here that has earned it.
//
// Two evidence families feed a signal, and they are never mixed:
//
//   - a convention: a filename, an extension, or a path segment. Following
//     ADR-031, a convention is evidence of the convention and of nothing behind
//     it. `Makefile` means a file named `Makefile` exists, not that the project
//     builds.
//   - a declaration: an assertion the interpretation pass read out of a document
//     body and cited a line for.
import { compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";

/** Schema of the readiness evidence projection. */
export const READINESS_EVIDENCE_SCHEMA = "l9.readiness-evidence/v1";

export const READINESS_PROFILE_ID = "l9-meta-injector-readiness-evidence";
export const READINESS_PROFILE_VERSION = "1.0.0";

/** The complete signal vocabulary. Closed: an unlisted signal is never emitted. */
export const READINESS_SIGNALS = [
  "artifact.has_source_code",
  "artifact.has_tests",
  "artifact.has_build_manifest",
  "artifact.has_build_definition",
  "artifact.has_ci_definition",
  "artifact.has_container_definition",
  "artifact.has_deployment_definition",
  "artifact.has_specification",
  "artifact.has_documentation",
  "artifact.has_open_tasks",
  "artifact.has_blockers",
  "artifact.has_roadmap",
  "artifact.has_plan",
] as const;

export type ReadinessSignalName = (typeof READINESS_SIGNALS)[number];

/**
 * Metric names this package refuses to compute.
 *
 * Each one requires a judgement about worth, completion or intent that no count
 * of files supports. They are listed so the refusal is testable rather than
 * merely stated.
 */
export const FORBIDDEN_READINESS_METRICS: readonly string[] = [
  "abandonment_probability",
  "build_priority",
  "percent_complete",
  "production_readiness_score",
  "strategic_value",
];

export type ReadinessEvidenceClass =
  | "extension_convention"
  | "filename_convention"
  | "path_convention"
  | "declared_assertion";

// ───────────────────────────── closed vocabularies ─────────────────────────────

const SOURCE_EXTENSIONS = new Set([
  ".bash", ".c", ".cc", ".clj", ".cpp", ".cs", ".cxx", ".dart", ".erl", ".ex", ".exs",
  ".fs", ".go", ".h", ".hpp", ".hs", ".java", ".jl", ".js", ".jsx", ".kt", ".kts",
  ".lua", ".m", ".mjs", ".cjs", ".mm", ".php", ".pl", ".py", ".r", ".rb", ".rs",
  ".scala", ".sh", ".sql", ".svelte", ".swift", ".ts", ".tsx", ".vue", ".zsh",
]);

const BUILD_MANIFEST_NAMES = new Set([
  "build.gradle", "build.gradle.kts", "build.sbt", "cargo.toml", "cmakelists.txt",
  "composer.json", "deno.json", "deno.jsonc", "gemfile", "go.mod", "makefile",
  "meson.build", "mix.exs", "package.json", "pipfile", "pnpm-workspace.yaml",
  "pom.xml", "project.clj", "pubspec.yaml", "pyproject.toml", "requirements.txt",
  "setup.cfg", "setup.py", "settings.gradle", "settings.gradle.kts",
]);

const BUILD_MANIFEST_EXTENSIONS = new Set([".csproj", ".fsproj", ".sln", ".vbproj"]);

/** Files that define how something is assembled, as opposed to what it needs. */
const BUILD_DEFINITION_NAMES = new Set([
  "build.gradle", "build.gradle.kts", "build.sbt", "cmakelists.txt", "makefile",
  "meson.build", "mix.exs", "pom.xml", "settings.gradle", "settings.gradle.kts",
]);

const BUILD_DEFINITION_EXTENSIONS = new Set([".csproj", ".fsproj", ".sln", ".vbproj"]);

const CI_DEFINITION_NAMES = new Set([
  ".gitlab-ci.yml", ".gitlab-ci.yaml", ".travis.yml", "appveyor.yml",
  "azure-pipelines.yml", "azure-pipelines.yaml", "bitbucket-pipelines.yml",
  "cloudbuild.yaml", "jenkinsfile",
]);

const CONTAINER_DEFINITION_NAMES = new Set([
  "compose.yaml", "compose.yml", "containerfile", "docker-compose.yaml",
  "docker-compose.yml", "dockerfile",
]);

const DEPLOYMENT_DEFINITION_NAMES = new Set([
  "chart.yaml", "fly.toml", "kustomization.yaml", "kustomization.yml", "netlify.toml",
  "procfile", "render.yaml", "serverless.yml", "serverless.yaml", "vercel.json",
]);

const DEPLOYMENT_DEFINITION_EXTENSIONS = new Set([".tf", ".tfvars"]);

const SPECIFICATION_NAMES = new Set([
  "openapi.json", "openapi.yaml", "openapi.yml", "swagger.json", "swagger.yaml",
]);

const SPECIFICATION_EXTENSIONS = new Set([".graphql", ".proto", ".thrift"]);

const DOCUMENTATION_EXTENSIONS = new Set([".markdown", ".md", ".rst", ".txt", ".adoc"]);

/** Path segments that mark a test tree. Matched against a whole segment only. */
const TEST_SEGMENTS = new Set(["__tests__", "spec", "specs", "test", "tests", "testing"]);

/** Basename markers that mark a test file, in either the prefix or suffix form. */
const TEST_NAME = /(^|[._-])(test|tests|spec|specs)([._-]|$)/;

const STATUS_BLOCKED = new Set(["blocked"]);

/**
 * Declared status vocabularies.
 *
 * These read a document's own claim about itself and nothing more. A file
 * declaring `status: complete` is a file that says so; whether it is complete is
 * not a question a filename or a front-matter line can answer.
 */
const WIP_STATUSES = new Set(["wip", "in-progress", "in_progress", "active", "ongoing"]);
const DRAFT_STATUSES = new Set(["draft", "proposed", "idea", "sketch"]);
const COMPLETE_STATUSES = new Set(["complete", "completed", "done", "shipped", "released", "accepted"]);

// ───────────────────────────── inputs and outputs ─────────────────────────────

/** One assertion, reduced to the two fields readiness reads. */
export interface ReadinessAssertion {
  predicate: string;
  object: string;
}

export interface ReadinessArtifactInput {
  virtual_source_id: string;
  corpus_path: string;
  /**
   * Path inside its root, POSIX, possibly a `archive.zip!/member` locator.
   * Never absolute: conventions are read from the corpus, not from a mount point.
   */
  root_relative_path: string;
  content_hash: string | null;
  size_bytes: number | null;
  assertions?: readonly ReadinessAssertion[];
  /** True when this artifact exists only inside an archive. */
  is_archive_member?: boolean;
  /** The archive it lives in, so archives can be counted per body of work. */
  archive_id?: string | null;
  /** True when a decoder produced a normalized document from these bytes. */
  decoded?: boolean;
  /** True when the extension is a document format no decoder in this release reads. */
  unsupported_format?: boolean;
}

export interface ReadinessSignal {
  signal: ReadinessSignalName;
  evidence_class: ReadinessEvidenceClass;
  /** The exact thing that decided the signal: a filename, a segment, a predicate. */
  evidence: string;
}

export interface ReadinessArtifactEvidence {
  virtual_source_id: string;
  corpus_path: string;
  signals: ReadinessSignal[];
}

/**
 * Counts for one body of work, grouped by the question each group answers.
 *
 * Every field is a count of things observed. None of them is combined with any
 * other, weighted, or projected forward: a strategy layer that wants a ratio can
 * divide two of these, and will then own the ratio. The grouping is not cosmetic
 * — it keeps the corpus denominators beside the counts drawn from them, so "two
 * test files" is never read without "out of how many files".
 */
export interface BodyOfWorkMetrics {
  /** How much of the corpus this body is. The base for everything below. */
  corpus: {
    artifact_count: number;
    root_count: number;
    archive_count: number;
    total_bytes: number;
  };
  implementation: {
    source_artifact_count: number;
    /** Extensions of the source artifacts, by count, in code-point order. */
    language_distribution: { language: string; artifact_count: number }[];
    /** Files declaring dependencies or package identity: package.json, go.mod. */
    manifest_count: number;
    /** Files defining a build procedure: Makefile, CMakeLists.txt, build.gradle. */
    build_definition_count: number;
  };
  validation: {
    /**
     * Files a test convention claims. Structural evidence only: it means files
     * named or placed like tests exist, never that any test was run or passed.
     */
    structural_test_artifact_count: number;
    ci_definition_count: number;
  };
  delivery: {
    container_definition_count: number;
    deployment_definition_count: number;
  };
  knowledge: {
    specification_count: number;
    documentation_count: number;
    plan_count: number;
    roadmap_count: number;
  };
  /** What the documents declare about their own state. Declarations, not verdicts. */
  work_state: {
    wip_count: number;
    draft_count: number;
    blocked_count: number;
    complete_declared_count: number;
    open_task_count: number;
    completed_task_count: number;
    milestone_count: number;
  };
  dependency: {
    explicit_dependency_count: number;
    explicit_blocker_count: number;
  };
  reuse_and_duplication: {
    exact_duplicate_cluster_count: number;
    exact_duplicate_artifact_count: number;
    near_duplicate_candidate_count: number;
    consolidation_candidate_count: number;
    explicit_supersession_count: number;
    /** Groups of members that are lexically near-duplicates of one another. */
    content_variant_count: number;
  };
  /**
   * What is not known about this body, kept beside what is.
   *
   * A body whose documents are mostly undecodable produces thin evidence, and a
   * reader who cannot see that will mistake thin evidence for a thin project.
   */
  uncertainty: {
    /** Members declaring two different `work.status` values. */
    conflicting_status_count: number;
    /** Document formats no decoder in this release reads: PDF, DOCX, and so on. */
    unsupported_document_count: number;
    /** Members with exact bytes on record that no decoder turned into a document. */
    undecoded_artifact_count: number;
    /** Members with no content hash at all: unreadable, or over the hash budget. */
    coverage_gap_count: number;
  };
  /** Distinct content, counted once per hash. Deterministic; not a value estimate. */
  unique_content: {
    distinct_content_hash_count: number;
    distinct_content_bytes: number;
    method: string;
  };
}

/** How `unique_content` is arrived at, stated in the document that carries it. */
export const UNIQUE_CONTENT_METHOD =
  "Distinct sha256 content hashes among this body's members, counted once each, with the "
  + "bytes of one member per hash. It measures how much of the body is not a copy of the rest "
  + "of it. It is not a measure of importance, value, or effort.";

export interface BodyOfWork {
  body_id: string;
  /** `project_candidate` or `explicit_project_identifier`. */
  origin: "project_candidate" | "explicit_project_identifier";
  /** The project candidate or declared identifier this body was derived from. */
  origin_ref: string;
  member_ids: string[];
  member_count: number;
  root_ids: string[];
  metrics: BodyOfWorkMetrics;
  /** Signals that hold for at least one member, with the member count for each. */
  signal_counts: { signal: ReadinessSignalName; artifact_count: number }[];
}

export interface ReadinessEvidence {
  schema: string;
  profile: {
    profile_id: string;
    profile_version: string;
    profile_hash: string;
    signal_vocabulary: readonly string[];
    forbidden_metrics: readonly string[];
  };
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  artifact_evidence: ReadinessArtifactEvidence[];
  bodies_of_work: BodyOfWork[];
  signal_totals: { signal: ReadinessSignalName; artifact_count: number }[];
  /** Restated in the emitted document so a consumer reading only JSON sees it. */
  no_ranking_statement: string;
}

export const NO_RANKING_STATEMENT =
  "Counts and cited evidence only. This document contains no priority, no score, "
  + "no percentage complete and no judgement of value; deriving one is a downstream "
  + "decision this producer does not make.";

// ───────────────────────────── signal detection ─────────────────────────────

function basenameOf(rootRelativePath: string): string {
  const tail = rootRelativePath.slice(rootRelativePath.lastIndexOf("/") + 1);
  return tail.toLowerCase();
}

function extensionOf(basename: string): string {
  const dot = basename.lastIndexOf(".");
  return dot <= 0 ? "" : basename.slice(dot);
}

/** Path segments, with archive locators split so a member's own path is read. */
function segmentsOf(rootRelativePath: string): string[] {
  return rootRelativePath
    .split(/!\/|\//)
    .map((segment) => segment.toLowerCase())
    .filter((segment) => segment.length > 0);
}

function push(
  into: ReadinessSignal[],
  signal: ReadinessSignalName,
  evidenceClass: ReadinessEvidenceClass,
  evidence: string,
): void {
  if (into.some((existing) => existing.signal === signal)) return;
  into.push({ signal, evidence_class: evidenceClass, evidence });
}

/** Signals decided by the artifact's name, extension or position in the tree. */
function conventionSignals(rootRelativePath: string): ReadinessSignal[] {
  const signals: ReadinessSignal[] = [];
  const basename = basenameOf(rootRelativePath);
  const extension = extensionOf(basename);
  const segments = segmentsOf(rootRelativePath);
  const parents = segments.slice(0, -1);

  if (SOURCE_EXTENSIONS.has(extension)) {
    push(signals, "artifact.has_source_code", "extension_convention", extension);
    const testSegment = parents.find((segment) => TEST_SEGMENTS.has(segment));
    if (testSegment !== undefined) {
      push(signals, "artifact.has_tests", "path_convention", `${testSegment}/`);
    } else if (TEST_NAME.test(basename.slice(0, basename.length - extension.length))) {
      push(signals, "artifact.has_tests", "filename_convention", basename);
    }
  }

  // A manifest declares what a project depends on and what it is called; a build
  // definition declares how it is assembled. Several files are honestly both, and
  // are counted in both — `pom.xml` really does declare dependencies and really
  // does define a build. Neither signal says the project builds.
  if (BUILD_MANIFEST_NAMES.has(basename) || BUILD_MANIFEST_EXTENSIONS.has(extension)) {
    push(
      signals,
      "artifact.has_build_manifest",
      BUILD_MANIFEST_NAMES.has(basename) ? "filename_convention" : "extension_convention",
      BUILD_MANIFEST_NAMES.has(basename) ? basename : extension,
    );
  }
  if (BUILD_DEFINITION_NAMES.has(basename) || BUILD_DEFINITION_EXTENSIONS.has(extension)) {
    push(
      signals,
      "artifact.has_build_definition",
      BUILD_DEFINITION_NAMES.has(basename) ? "filename_convention" : "extension_convention",
      BUILD_DEFINITION_NAMES.has(basename) ? basename : extension,
    );
  }

  // A workflow file is CI evidence because of where it sits, not what it is named:
  // `.github/workflows/anything.yml` is a workflow, `anything.yml` elsewhere is not.
  const workflowIndex = parents.indexOf("workflows");
  const inGithubWorkflows = workflowIndex > 0 && parents[workflowIndex - 1] === ".github";
  if (inGithubWorkflows && (extension === ".yml" || extension === ".yaml")) {
    push(signals, "artifact.has_ci_definition", "path_convention", ".github/workflows/");
  } else if (CI_DEFINITION_NAMES.has(basename)) {
    push(signals, "artifact.has_ci_definition", "filename_convention", basename);
  } else if (parents.includes(".circleci") && basename === "config.yml") {
    push(signals, "artifact.has_ci_definition", "path_convention", ".circleci/config.yml");
  }

  if (CONTAINER_DEFINITION_NAMES.has(basename) || extension === ".dockerfile") {
    push(
      signals,
      "artifact.has_container_definition",
      CONTAINER_DEFINITION_NAMES.has(basename) ? "filename_convention" : "extension_convention",
      CONTAINER_DEFINITION_NAMES.has(basename) ? basename : extension,
    );
  }

  if (DEPLOYMENT_DEFINITION_NAMES.has(basename)) {
    push(signals, "artifact.has_deployment_definition", "filename_convention", basename);
  } else if (DEPLOYMENT_DEFINITION_EXTENSIONS.has(extension)) {
    push(signals, "artifact.has_deployment_definition", "extension_convention", extension);
  } else if (parents.includes("helm") && (basename === "values.yaml" || basename === "values.yml")) {
    push(signals, "artifact.has_deployment_definition", "path_convention", "helm/");
  }

  if (SPECIFICATION_NAMES.has(basename)) {
    push(signals, "artifact.has_specification", "filename_convention", basename);
  } else if (SPECIFICATION_EXTENSIONS.has(extension)) {
    push(signals, "artifact.has_specification", "extension_convention", extension);
  }

  if (DOCUMENTATION_EXTENSIONS.has(extension)) {
    push(signals, "artifact.has_documentation", "extension_convention", extension);
  }

  return signals;
}

/** Signals decided by something a document declared and cited. */
function declaredSignals(assertions: readonly ReadinessAssertion[]): ReadinessSignal[] {
  const signals: ReadinessSignal[] = [];
  for (const assertion of assertions) {
    switch (assertion.predicate) {
      case "work.task.open":
        push(signals, "artifact.has_open_tasks", "declared_assertion", "work.task.open");
        break;
      case "work.blocked_by":
        push(signals, "artifact.has_blockers", "declared_assertion", "work.blocked_by");
        break;
      case "work.status":
        if (STATUS_BLOCKED.has(assertion.object)) {
          push(signals, "artifact.has_blockers", "declared_assertion", "work.status=blocked");
        }
        break;
      case "work.kind":
        if (assertion.object === "roadmap") {
          push(signals, "artifact.has_roadmap", "declared_assertion", "work.kind=roadmap");
        } else if (assertion.object === "plan") {
          push(signals, "artifact.has_plan", "declared_assertion", "work.kind=plan");
        } else if (assertion.object === "specification") {
          push(signals, "artifact.has_specification", "declared_assertion", "work.kind=specification");
        }
        break;
      default:
        break;
    }
  }
  return signals;
}

function compareSignals(a: ReadinessSignal, b: ReadinessSignal): number {
  return compareCodePoints(a.signal, b.signal);
}

/** Every signal that holds for one artifact, each carrying the evidence for it. */
export function readinessSignalsFor(input: ReadinessArtifactInput): ReadinessSignal[] {
  const signals = conventionSignals(input.root_relative_path);
  for (const declared of declaredSignals(input.assertions ?? [])) {
    push(signals, declared.signal, declared.evidence_class, declared.evidence);
  }
  return signals.sort(compareSignals);
}

/** Signal evidence for every artifact that carries at least one signal. */
export function buildReadinessArtifactEvidence(
  artifacts: readonly ReadinessArtifactInput[],
): ReadinessArtifactEvidence[] {
  const out: ReadinessArtifactEvidence[] = [];
  for (const artifact of artifacts) {
    const signals = readinessSignalsFor(artifact);
    if (signals.length === 0) continue;
    out.push({
      virtual_source_id: artifact.virtual_source_id,
      corpus_path: artifact.corpus_path,
      signals,
    });
  }
  return out.sort((a, b) => compareCodePoints(a.corpus_path, b.corpus_path));
}

// ───────────────────────────── aggregation ─────────────────────────────

/** Corpus-wide facts a body of work's metrics are read out of. */
export interface BodyOfWorkContext {
  /** Signals already computed for every artifact, keyed by virtual source id. */
  signalsById: ReadonlyMap<string, readonly ReadinessSignal[]>;
  /** Every artifact input, keyed by virtual source id. */
  artifactsById: ReadonlyMap<string, ReadinessArtifactInput>;
  /** Root id of each artifact. */
  rootById: ReadonlyMap<string, string>;
  /** Members of each exact-duplicate cluster, keyed by virtual source id. */
  exactDuplicateIds: ReadonlySet<string>;
  /** Which exact-duplicate cluster each artifact belongs to, when it belongs to one. */
  clusterByArtifact?: ReadonlyMap<string, string>;
  /** Consolidation candidates each artifact is a member of. */
  consolidationsByArtifact?: ReadonlyMap<string, readonly string[]>;
  /** Near-duplicate candidate pairs, as ordered id pairs. */
  nearDuplicatePairs: readonly (readonly [string, string])[];
}

function emptyMetrics(): BodyOfWorkMetrics {
  return {
    corpus: { artifact_count: 0, root_count: 0, archive_count: 0, total_bytes: 0 },
    implementation: {
      source_artifact_count: 0,
      language_distribution: [],
      manifest_count: 0,
      build_definition_count: 0,
    },
    validation: { structural_test_artifact_count: 0, ci_definition_count: 0 },
    delivery: { container_definition_count: 0, deployment_definition_count: 0 },
    knowledge: {
      specification_count: 0,
      documentation_count: 0,
      plan_count: 0,
      roadmap_count: 0,
    },
    work_state: {
      wip_count: 0,
      draft_count: 0,
      blocked_count: 0,
      complete_declared_count: 0,
      open_task_count: 0,
      completed_task_count: 0,
      milestone_count: 0,
    },
    dependency: { explicit_dependency_count: 0, explicit_blocker_count: 0 },
    reuse_and_duplication: {
      exact_duplicate_cluster_count: 0,
      exact_duplicate_artifact_count: 0,
      near_duplicate_candidate_count: 0,
      consolidation_candidate_count: 0,
      explicit_supersession_count: 0,
      content_variant_count: 0,
    },
    uncertainty: {
      conflicting_status_count: 0,
      unsupported_document_count: 0,
      undecoded_artifact_count: 0,
      coverage_gap_count: 0,
    },
    unique_content: {
      distinct_content_hash_count: 0,
      distinct_content_bytes: 0,
      method: UNIQUE_CONTENT_METHOD,
    },
  };
}

/** Where each signal is tallied. `null` means the signal is not a count here. */
const SIGNAL_METRIC: Readonly<Record<ReadinessSignalName, ((m: BodyOfWorkMetrics) => void) | null>> = {
  "artifact.has_source_code": (m) => { m.implementation.source_artifact_count += 1; },
  "artifact.has_tests": (m) => { m.validation.structural_test_artifact_count += 1; },
  "artifact.has_build_manifest": (m) => { m.implementation.manifest_count += 1; },
  "artifact.has_build_definition": (m) => { m.implementation.build_definition_count += 1; },
  "artifact.has_ci_definition": (m) => { m.validation.ci_definition_count += 1; },
  "artifact.has_container_definition": (m) => { m.delivery.container_definition_count += 1; },
  "artifact.has_deployment_definition": (m) => { m.delivery.deployment_definition_count += 1; },
  "artifact.has_specification": (m) => { m.knowledge.specification_count += 1; },
  "artifact.has_documentation": (m) => { m.knowledge.documentation_count += 1; },
  // Tallied from the assertions themselves, so one document with five open tasks
  // counts five rather than one.
  "artifact.has_open_tasks": null,
  "artifact.has_blockers": null,
  "artifact.has_roadmap": (m) => { m.knowledge.roadmap_count += 1; },
  "artifact.has_plan": (m) => { m.knowledge.plan_count += 1; },
};

/**
 * Connected components of size two or more in a pair graph.
 *
 * Used for `candidate_version_count`: a run of documents each lexically close to
 * the next is one group of candidate versions, not several. Nothing about the
 * grouping says which member is newest, best, or the one to keep.
 */
function componentCount(
  memberIds: ReadonlySet<string>,
  pairs: readonly (readonly [string, string])[],
): number {
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let root = parent.get(id) ?? id;
    while (root !== (parent.get(root) ?? root)) root = parent.get(root) as string;
    let cursor = id;
    while (cursor !== root) {
      const next = parent.get(cursor) ?? cursor;
      parent.set(cursor, root);
      cursor = next;
    }
    return root;
  };
  const union = (a: string, b: string): void => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  let joined = false;
  for (const [a, b] of pairs) {
    if (!memberIds.has(a) || !memberIds.has(b)) continue;
    parent.set(a, parent.get(a) ?? a);
    parent.set(b, parent.get(b) ?? b);
    union(a, b);
    joined = true;
  }
  if (!joined) return 0;
  const roots = new Set<string>();
  for (const id of parent.keys()) roots.add(find(id));
  return roots.size;
}

/** Metrics for one member set. Pure counting over already-established facts. */
export function buildBodyOfWorkMetrics(
  memberIds: readonly string[],
  context: BodyOfWorkContext,
): BodyOfWorkMetrics {
  const metrics = emptyMetrics();
  const members = new Set(memberIds);
  const contentHashes = new Map<string, number>();
  const roots = new Set<string>();
  const archives = new Set<string>();
  const clusters = new Set<string>();
  const consolidations = new Set<string>();
  const languages = new Map<string, number>();
  const declaredStatuses = new Map<string, string[]>();

  for (const id of memberIds) {
    for (const signal of context.signalsById.get(id) ?? []) {
      const tally = SIGNAL_METRIC[signal.signal];
      if (tally !== null) tally(metrics);
      // The language of a source artifact is its extension, and it is read from
      // the signal's own evidence rather than re-derived, so the distribution can
      // never disagree with the count it breaks down.
      if (signal.signal === "artifact.has_source_code"
        && signal.evidence_class === "extension_convention") {
        languages.set(signal.evidence, (languages.get(signal.evidence) ?? 0) + 1);
      }
    }

    const root = context.rootById.get(id);
    if (root !== undefined) roots.add(root);
    const cluster = context.clusterByArtifact?.get(id);
    if (cluster !== undefined) clusters.add(cluster);
    for (const candidate of context.consolidationsByArtifact?.get(id) ?? []) {
      consolidations.add(candidate);
    }

    const artifact = context.artifactsById.get(id);
    if (artifact === undefined) continue;
    if (artifact.archive_id !== undefined && artifact.archive_id !== null) {
      archives.add(artifact.archive_id);
    }
    metrics.corpus.total_bytes += artifact.size_bytes ?? 0;

    for (const assertion of artifact.assertions ?? []) {
      switch (assertion.predicate) {
        case "work.task.open": metrics.work_state.open_task_count += 1; break;
        case "work.task.completed": metrics.work_state.completed_task_count += 1; break;
        case "work.milestone": metrics.work_state.milestone_count += 1; break;
        case "work.blocked_by":
          metrics.work_state.blocked_count += 1;
          metrics.dependency.explicit_blocker_count += 1;
          break;
        case "work.depends_on": metrics.dependency.explicit_dependency_count += 1; break;
        case "work.supersedes":
        case "work.superseded_by":
          metrics.reuse_and_duplication.explicit_supersession_count += 1;
          break;
        case "work.status": {
          const value = assertion.object.trim().toLowerCase();
          const seen = declaredStatuses.get(id) ?? [];
          seen.push(value);
          declaredStatuses.set(id, seen);
          if (WIP_STATUSES.has(value)) metrics.work_state.wip_count += 1;
          else if (DRAFT_STATUSES.has(value)) metrics.work_state.draft_count += 1;
          else if (COMPLETE_STATUSES.has(value)) metrics.work_state.complete_declared_count += 1;
          else if (STATUS_BLOCKED.has(value)) metrics.work_state.blocked_count += 1;
          break;
        }
        default: break;
      }
    }

    if (context.exactDuplicateIds.has(id)) {
      metrics.reuse_and_duplication.exact_duplicate_artifact_count += 1;
    }

    // Three disjoint kinds of not-knowing, kept apart because they mean different
    // things: a format nothing here reads, bytes a decoder could not turn into
    // text, and a file whose bytes were never established at all.
    if (artifact.content_hash === null) metrics.uncertainty.coverage_gap_count += 1;
    else if (artifact.unsupported_format === true) metrics.uncertainty.unsupported_document_count += 1;
    else if (artifact.decoded === false) metrics.uncertainty.undecoded_artifact_count += 1;

    if (artifact.content_hash !== null && !contentHashes.has(artifact.content_hash)) {
      contentHashes.set(artifact.content_hash, artifact.size_bytes ?? 0);
    }
  }

  // A body whose documents disagree about their own state — one says complete,
  // another says wip — is reported as ambiguous rather than resolved by picking
  // one. Every member that declared a status participates in the disagreement.
  const distinctStatuses = new Set([...declaredStatuses.values()].flat());
  if (distinctStatuses.size > 1) {
    metrics.uncertainty.conflicting_status_count = declaredStatuses.size;
  }

  const localPairs = context.nearDuplicatePairs.filter(([a, b]) => members.has(a) && members.has(b));
  metrics.corpus.artifact_count = members.size;
  metrics.corpus.root_count = roots.size;
  metrics.corpus.archive_count = archives.size;
  metrics.implementation.language_distribution = [...languages.entries()]
    .map(([language, artifact_count]) => ({ language, artifact_count }))
    .sort((a, b) => compareCodePoints(a.language, b.language));
  metrics.reuse_and_duplication.exact_duplicate_cluster_count = clusters.size;
  metrics.reuse_and_duplication.consolidation_candidate_count = consolidations.size;
  metrics.reuse_and_duplication.near_duplicate_candidate_count = localPairs.length;
  metrics.reuse_and_duplication.content_variant_count = componentCount(members, localPairs);
  metrics.unique_content.distinct_content_hash_count = contentHashes.size;
  metrics.unique_content.distinct_content_bytes = [...contentHashes.values()].reduce(
    (sum, bytes) => sum + bytes,
    0,
  );
  return metrics;
}

function signalCounts(
  memberIds: readonly string[],
  signalsById: ReadonlyMap<string, readonly ReadinessSignal[]>,
): { signal: ReadinessSignalName; artifact_count: number }[] {
  const counts = new Map<ReadinessSignalName, number>();
  for (const id of memberIds) {
    for (const signal of signalsById.get(id) ?? []) {
      counts.set(signal.signal, (counts.get(signal.signal) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([signal, artifact_count]) => ({ signal, artifact_count }))
    .sort((a, b) => compareCodePoints(a.signal, b.signal));
}

export interface BodyOfWorkSpec {
  origin: BodyOfWork["origin"];
  origin_ref: string;
  member_ids: readonly string[];
}

/** Build one body of work from its members and the corpus-wide context. */
export function buildBodyOfWork(spec: BodyOfWorkSpec, context: BodyOfWorkContext): BodyOfWork {
  const memberIds = [...spec.member_ids].sort(compareCodePoints);
  const rootIds = [
    ...new Set(memberIds.map((id) => context.rootById.get(id)).filter((id): id is string => !!id)),
  ].sort(compareCodePoints);
  return {
    body_id: stableId("body-of-work", { origin: spec.origin, origin_ref: spec.origin_ref }),
    origin: spec.origin,
    origin_ref: spec.origin_ref,
    member_ids: memberIds,
    member_count: memberIds.length,
    root_ids: rootIds,
    metrics: buildBodyOfWorkMetrics(memberIds, context),
    signal_counts: signalCounts(memberIds, context.signalsById),
  };
}

/** Hash binding the readiness rules that produced a document. */
export function readinessProfileHash(): string {
  return stableId("readiness-profile", {
    forbidden_metrics: [...FORBIDDEN_READINESS_METRICS].sort(compareCodePoints),
    profile_id: READINESS_PROFILE_ID,
    profile_version: READINESS_PROFILE_VERSION,
    signal_vocabulary: [...READINESS_SIGNALS].sort(compareCodePoints),
  });
}

export interface BuildReadinessEvidenceInput {
  corpusSourceSnapshotId: string;
  corpusAnalysisId: string;
  artifacts: readonly ReadinessArtifactInput[];
  bodies: readonly BodyOfWorkSpec[];
  context: BodyOfWorkContext;
}

/** Assemble `readiness-evidence.json`. Counts and citations, never a ranking. */
export function buildReadinessEvidence(input: BuildReadinessEvidenceInput): ReadinessEvidence {
  const artifactEvidence = buildReadinessArtifactEvidence(input.artifacts);
  const bodies = input.bodies
    .map((spec) => buildBodyOfWork(spec, input.context))
    .sort((a, b) => compareCodePoints(a.origin_ref, b.origin_ref) || compareCodePoints(a.body_id, b.body_id));
  return {
    schema: READINESS_EVIDENCE_SCHEMA,
    profile: {
      profile_id: READINESS_PROFILE_ID,
      profile_version: READINESS_PROFILE_VERSION,
      profile_hash: readinessProfileHash(),
      signal_vocabulary: [...READINESS_SIGNALS],
      forbidden_metrics: [...FORBIDDEN_READINESS_METRICS],
    },
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    artifact_evidence: artifactEvidence,
    bodies_of_work: bodies,
    signal_totals: signalCounts(
      [...input.context.signalsById.keys()],
      input.context.signalsById,
    ),
    no_ranking_statement: NO_RANKING_STATEMENT,
  };
}
