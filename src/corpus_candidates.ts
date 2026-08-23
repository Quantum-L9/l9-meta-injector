// corpus_candidates.ts — the two groupings a corpus supports, both as candidates.
//
// A folder of twenty years of work has structure in it, and the structure is not
// the folder tree. The same project is on three disks under three names; the same
// subject is spread across a hundred notes filed by date. Two deterministic
// groupings recover some of that, and both are labelled candidates because
// neither is decidable:
//
//   PROJECT_CANDIDATE   a container holding an explicit project marker — a build
//                       manifest or a CI definition — with its members. Containers
//                       sharing a declared identifier join across roots and disks.
//
//   TOPIC_CANDIDATE     a connected group of documents whose salient vocabulary
//                       overlaps. Lexical, like the near-duplicate pass, and just
//                       as carefully not a claim about meaning.
//
// Neither grouping ranks, names, merges, moves or recommends anything, and neither
// calls a model. A project candidate is a container that carries a marker; a topic
// candidate is a set of documents that share words. What either one is *for* is
// somebody else's decision.
import { compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";

export const PROJECT_CANDIDATE_METHOD = "container-project-candidate/v1";
export const PROJECT_CANDIDATE_METHOD_VERSION = "1.0.0";

export const TOPIC_CANDIDATE_METHOD = "lexical-topic-candidate/v1";
export const TOPIC_CANDIDATE_METHOD_VERSION = "1.0.0";

/** Default salient-vocabulary overlap at which two documents join a topic. */
export const DEFAULT_TOPIC_THRESHOLD = 0.35;

/** Documents shorter than this are not scored; short text overlaps by accident. */
export const TOPIC_MIN_TOKENS = 20;

/** Salient terms kept per document, by frequency then code point. */
export const TOPIC_SALIENT_TERMS = 40;

/** A term in more than this share of eligible documents is corpus boilerplate. */
export const TOPIC_DOCUMENT_FREQUENCY_CEILING = 0.8;

/**
 * Corpus size below which no term is treated as boilerplate.
 *
 * "This term is in most of the corpus" is only a statement about vocabulary once
 * the corpus is big enough for *most* to mean something. Applying the ceiling to
 * four documents would strip the very terms that make two of them a topic.
 */
export const TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS = 5;

/** Shortest term considered salient. */
export const TOPIC_MIN_TERM_LENGTH = 3;

/**
 * Closed stopword list.
 *
 * Deliberately small and English-only. A large list tuned per corpus would make
 * the analysis depend on an unstated model of the language being analyzed; a
 * short list of function words removes the terms that would otherwise join every
 * document to every other one.
 */
export const TOPIC_STOPWORDS: readonly string[] = [
  "about", "after", "again", "all", "also", "and", "any", "are", "because", "been",
  "before", "being", "between", "both", "but", "can", "could", "did", "does", "doing",
  "done", "down", "each", "even", "every", "for", "from", "further", "had", "has",
  "have", "here", "how", "into", "its", "itself", "just", "may", "more", "most",
  "much", "must", "not", "now", "off", "once", "one", "only", "other", "our", "out",
  "over", "own", "same", "she", "should", "since", "some", "such", "than", "that",
  "the", "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "too", "under", "until", "use", "used", "very", "was", "way", "were",
  "what", "when", "where", "which", "while", "who", "why", "will", "with", "would",
  "you", "your",
];

const STOPWORDS = new Set(TOPIC_STOPWORDS);

// ───────────────────────────── project candidates ─────────────────────────────

/** Where a project marker was found and what, if anything, it declared. */
export interface ProjectMarker {
  virtual_source_id: string;
  root_id: string;
  /** Root-relative POSIX path, or an `archive.zip!/member` locator. */
  root_relative_path: string;
  corpus_path: string;
  /** `build_manifest` or `ci_definition`. */
  marker_kind: "build_manifest" | "ci_definition";
  /** Name the manifest body declared for itself, when one could be read. */
  declared_identifier?: string;
  /** Field the identifier was read from, and the 1-based line it was on. */
  declared_identifier_evidence?: { field: string; line: number };
}

export interface ProjectCandidateMemberInput {
  virtual_source_id: string;
  root_id: string;
  root_relative_path: string;
  corpus_path: string;
}

export interface ProjectCandidateContainer {
  root_id: string;
  /** Root-relative container path. `""` is the root itself. */
  container_path: string;
  corpus_container_path: string;
  marker_ids: string[];
  marker_kinds: string[];
  declared_identifiers: string[];
}

export interface ProjectCandidate {
  candidate_id: string;
  method: string;
  algorithm_version: string;
  /** Declared identifier, or `container:<directory name>` when none was declared. */
  project_key: string;
  /** True when the key came from a manifest body rather than a directory name. */
  identifier_is_declared: boolean;
  containers: ProjectCandidateContainer[];
  root_ids: string[];
  member_ids: string[];
  member_count: number;
  /** True when the candidate's members come from more than one root. */
  spans_roots: boolean;
}

/** Directory half of a root-relative path, honouring archive locators. */
export function containerOf(rootRelativePath: string): string {
  const slash = rootRelativePath.lastIndexOf("/");
  if (slash < 0) return "";
  // `a.zip!/x.md` has its member at the archive root; the container is the archive.
  if (rootRelativePath.endsWith("/") || slash === 0) return rootRelativePath.slice(0, slash);
  const head = rootRelativePath.slice(0, slash);
  return head.endsWith("!") ? `${head}/` : head;
}

/**
 * The project container a marker implies.
 *
 * A build manifest sits in its project's directory. A CI definition sits two
 * levels below it, in `.github/workflows/` or `.circleci/`, so the container is
 * the directory holding that dot-directory rather than the dot-directory itself.
 */
export function projectContainerForMarker(rootRelativePath: string): string {
  const container = containerOf(rootRelativePath);
  const segments = container.split("/");
  for (let index = segments.length - 1; index >= 0; index--) {
    if (segments[index] === ".github" || segments[index] === ".circleci") {
      return segments.slice(0, index).join("/");
    }
  }
  return container;
}

/**
 * Last path segment of a container, used as a fallback grouping key.
 *
 * The trailing separators are trimmed by scanning rather than by `/[!/]+$/`.
 * That pattern backtracks quadratically on a path that is mostly separators, and
 * these paths come out of archive member names this package does not control —
 * so a super-linear pattern here is a denial of service rather than a style
 * question.
 */
function containerName(containerPath: string): string {
  let end = containerPath.length;
  while (end > 0 && (containerPath[end - 1] === "!" || containerPath[end - 1] === "/")) end--;
  const cleaned = containerPath.slice(0, end);
  const slash = cleaned.lastIndexOf("/");
  return slash < 0 ? cleaned : cleaned.slice(slash + 1);
}

/** True when `candidate` is `container` itself or lies beneath it. */
export function isUnderContainer(containerPath: string, candidate: string): boolean {
  if (containerPath === "") return true;
  if (candidate === containerPath) return true;
  const prefix = containerPath.endsWith("/") ? containerPath : `${containerPath}/`;
  return candidate.startsWith(prefix);
}

/**
 * The key containers are grouped under, and the whole of that rule.
 *
 * A declared identifier joins containers across roots and disks. A container with
 * no declared name can only join others of the same directory name. A root-level
 * container with no declared name joins nothing at all, because the only name it
 * has left is its root, and a root is not a project.
 */
function projectGroupKey(input: {
  declared: string | undefined;
  containerName: string;
  rootLabel: string;
}): string {
  if (input.declared !== undefined) return `project:${input.declared}`;
  if (input.containerName.length > 0) return `container:${input.containerName}`;
  return `container:${input.rootLabel}`;
}

export interface BuildProjectCandidatesInput {
  markers: readonly ProjectMarker[];
  members: readonly ProjectCandidateMemberInput[];
  /** Label of each root, used to key a root-level container with no declared name. */
  rootLabels: ReadonlyMap<string, string>;
}

/**
 * Group markers into containers, containers into project candidates, and assign
 * every artifact to the innermost container that claims it.
 *
 * The innermost rule is what keeps a monorepo from swallowing its own packages:
 * `repo/package.json` and `repo/packages/api/package.json` are two containers, and
 * a file under `packages/api` belongs to the inner one alone.
 */
export function buildProjectCandidates(input: BuildProjectCandidatesInput): ProjectCandidate[] {
  const containers = new Map<string, ProjectCandidateContainer>();
  for (const marker of input.markers) {
    const containerPath = projectContainerForMarker(marker.root_relative_path);
    const slot = `${marker.root_id} ${containerPath}`;
    const existing = containers.get(slot) ?? {
      root_id: marker.root_id,
      container_path: containerPath,
      corpus_container_path: marker.corpus_path.slice(
        0,
        marker.corpus_path.length - marker.root_relative_path.length,
      ) + containerPath,
      marker_ids: [],
      marker_kinds: [],
      declared_identifiers: [],
    };
    existing.marker_ids.push(marker.virtual_source_id);
    if (!existing.marker_kinds.includes(marker.marker_kind)) {
      existing.marker_kinds.push(marker.marker_kind);
    }
    if (
      marker.declared_identifier !== undefined
      && !existing.declared_identifiers.includes(marker.declared_identifier)
    ) {
      existing.declared_identifiers.push(marker.declared_identifier);
    }
    containers.set(slot, existing);
  }

  // Assignment: longest container path wins, so a nested project keeps its files.
  const byRoot = new Map<string, ProjectCandidateContainer[]>();
  for (const container of containers.values()) {
    const bucket = byRoot.get(container.root_id);
    if (bucket === undefined) byRoot.set(container.root_id, [container]);
    else bucket.push(container);
  }
  for (const bucket of byRoot.values()) {
    bucket.sort((a, b) => b.container_path.length - a.container_path.length
      || compareCodePoints(a.container_path, b.container_path));
  }

  const assignment = new Map<string, string[]>();
  for (const member of input.members) {
    const bucket = byRoot.get(member.root_id);
    if (bucket === undefined) continue;
    const owner = bucket.find((container) =>
      isUnderContainer(container.container_path, member.root_relative_path));
    if (owner === undefined) continue;
    const slot = `${owner.root_id} ${owner.container_path}`;
    const members = assignment.get(slot);
    if (members === undefined) assignment.set(slot, [member.virtual_source_id]);
    else members.push(member.virtual_source_id);
  }

  // Grouping: a declared identifier joins containers across roots and disks; a
  // container with no declared name can only join others of the same directory
  // name, and a root-level container with no name joins nothing at all.
  const grouped = new Map<string, { declared: boolean; containers: ProjectCandidateContainer[] }>();
  for (const container of containers.values()) {
    const sortedIdentifiers = [...container.declared_identifiers].sort(compareCodePoints);
    const declared = sortedIdentifiers[0];
    const key = projectGroupKey({
      declared,
      containerName: containerName(container.container_path),
      rootLabel: input.rootLabels.get(container.root_id) ?? container.root_id,
    });
    const group = grouped.get(key) ?? { declared: declared !== undefined, containers: [] };
    group.declared = group.declared || declared !== undefined;
    group.containers.push(container);
    grouped.set(key, group);
  }

  const candidates: ProjectCandidate[] = [];
  for (const [projectKey, group] of grouped) {
    const orderedContainers = [...group.containers].sort(
      (a, b) => compareCodePoints(a.corpus_container_path, b.corpus_container_path),
    );
    const memberIds = new Set<string>();
    for (const container of orderedContainers) {
      for (const id of assignment.get(`${container.root_id} ${container.container_path}`) ?? []) {
        memberIds.add(id);
      }
      container.marker_ids.sort(compareCodePoints);
      container.marker_kinds.sort(compareCodePoints);
      container.declared_identifiers.sort(compareCodePoints);
    }
    const rootIds = [...new Set(orderedContainers.map((container) => container.root_id))]
      .sort(compareCodePoints);
    candidates.push({
      candidate_id: stableId("project-candidate", {
        algorithm_id: PROJECT_CANDIDATE_METHOD,
        algorithm_version: PROJECT_CANDIDATE_METHOD_VERSION,
        project_key: projectKey,
      }),
      method: PROJECT_CANDIDATE_METHOD,
      algorithm_version: PROJECT_CANDIDATE_METHOD_VERSION,
      project_key: projectKey,
      identifier_is_declared: group.declared,
      containers: orderedContainers,
      root_ids: rootIds,
      member_ids: [...memberIds].sort(compareCodePoints),
      member_count: memberIds.size,
      spans_roots: rootIds.length > 1,
    });
  }
  return candidates.sort((a, b) => compareCodePoints(a.project_key, b.project_key));
}

// ───────────────────────────── declared identifiers ─────────────────────────────

export interface DeclaredIdentifier {
  identifier: string;
  field: string;
  /** 1-based line the value was read from, so the claim can be checked. */
  line: number;
}

/** Manifest basenames whose body this module knows how to read a name out of. */
export const DECLARED_IDENTIFIER_MANIFESTS: readonly string[] = [
  "cargo.toml", "composer.json", "deno.json", "deno.jsonc", "go.mod", "package.json",
  "pom.xml", "pyproject.toml",
];

/** True when `readDeclaredIdentifier` claims this basename. */
export function readsDeclaredIdentifier(basename: string): boolean {
  return DECLARED_IDENTIFIER_MANIFESTS.includes(basename.toLowerCase());
}

const JSON_NAME_FIELDS: Readonly<Record<string, string>> = {
  "package.json": "name",
  "composer.json": "name",
  "deno.json": "name",
  "deno.jsonc": "name",
};

const TOML_NAME_SECTIONS: Readonly<Record<string, readonly string[]>> = {
  "cargo.toml": ["package"],
  "pyproject.toml": ["project", "tool.poetry"],
};

/** 1-based line of the first occurrence of a pattern, or 0 when absent. */
function lineOf(lines: readonly string[], predicate: (line: string) => boolean): number {
  for (let index = 0; index < lines.length; index++) if (predicate(lines[index])) return index + 1;
  return 0;
}

/**
 * Read the name a manifest declares for itself.
 *
 * Following ADR-031, nothing is inferred from the filename: the value comes from
 * the body, and the line it came from is carried with it. A manifest that
 * declares no name yields nothing rather than a guess derived from its directory.
 */
export function readDeclaredIdentifier(
  basename: string,
  text: string,
): DeclaredIdentifier | undefined {
  const name = basename.toLowerCase();
  const lines = text.split(/\r?\n/);

  const jsonField = JSON_NAME_FIELDS[name];
  if (jsonField !== undefined) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return undefined;
    }
    if (parsed === null || typeof parsed !== "object") return undefined;
    const value = (parsed as Record<string, unknown>)[jsonField];
    if (typeof value !== "string" || value.trim().length === 0) return undefined;
    const quoted = new RegExp(String.raw`"${jsonField}"\s*:`);
    return {
      identifier: value.trim(),
      field: jsonField,
      line: lineOf(lines, (line) => quoted.test(line)),
    };
  }

  if (name === "go.mod") {
    for (let index = 0; index < lines.length; index++) {
      const match = /^\s*module\s+(\S+)\s*$/.exec(lines[index]);
      if (match) return { identifier: match[1], field: "module", line: index + 1 };
    }
    return undefined;
  }

  if (name === "pom.xml") {
    for (let index = 0; index < lines.length; index++) {
      const match = /<artifactId>([^<]+)<\/artifactId>/.exec(lines[index]);
      if (match) return { identifier: match[1].trim(), field: "artifactId", line: index + 1 };
    }
    return undefined;
  }

  const sections = TOML_NAME_SECTIONS[name];
  if (sections !== undefined) {
    let current = "";
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
      if (section) {
        current = section[1].trim();
        continue;
      }
      if (!sections.includes(current)) continue;
      const match = /^\s*name\s*=\s*["']([^"']+)["']\s*$/.exec(line);
      if (match) return { identifier: match[1], field: `${current}.name`, line: index + 1 };
    }
    return undefined;
  }

  return undefined;
}

// ───────────────────────────── topic candidates ─────────────────────────────

export interface TopicDocumentInput {
  virtual_source_id: string;
  corpus_path: string;
  /** Term counts of the document's analysis tokens, already normalized. */
  term_counts: readonly (readonly [string, number])[];
  token_count: number;
}

export interface TopicCandidate {
  candidate_id: string;
  method: string;
  algorithm_version: string;
  threshold: number;
  member_ids: string[];
  member_paths: string[];
  member_count: number;
  root_ids: string[];
  spans_roots: boolean;
  /** Terms held by at least half the members, in code-point order. */
  shared_terms: string[];
}

/** The salient terms of one document: frequent, not too common, not a stopword. */
export function salientTerms(
  document: TopicDocumentInput,
  documentFrequency: ReadonlyMap<string, number>,
  eligibleDocumentCount: number,
): string[] {
  const ceiling = eligibleDocumentCount < TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS
    ? Number.POSITIVE_INFINITY
    : eligibleDocumentCount * TOPIC_DOCUMENT_FREQUENCY_CEILING;
  const kept = document.term_counts.filter(([term]) => {
    if (term.length < TOPIC_MIN_TERM_LENGTH) return false;
    if (STOPWORDS.has(term)) return false;
    // A term in nearly every document separates nothing; a term in exactly one
    // document is kept, because a corpus of near-unique vocabulary is normal.
    return (documentFrequency.get(term) ?? 0) <= ceiling;
  });
  const byFrequency = [...kept].sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0]));
  const salient = byFrequency.slice(0, TOPIC_SALIENT_TERMS).map(([term]) => term);
  return salient.sort(compareCodePoints);
}

function jaccardOfSets(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  const [small, large] = left.size <= right.size ? [left, right] : [right, left];
  for (const term of small) if (large.has(term)) shared++;
  const union = left.size + right.size - shared;
  return union === 0 ? 0 : shared / union;
}

/** Round a threshold the way every other score in this package is rounded. */
function roundTopicScore(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** One topic candidate from its members. Shared by the indexed and zero paths. */
function buildTopicCandidate(
  members: readonly { document: TopicDocumentInput; terms: Set<string> }[],
  threshold: number,
  rootById: ReadonlyMap<string, string>,
): TopicCandidate {
  const ordered = [...members].sort(
    (a, b) => compareCodePoints(a.document.corpus_path, b.document.corpus_path),
  );
  const memberIds = ordered.map((member) => member.document.virtual_source_id);
  const termCounts = new Map<string, number>();
  for (const member of ordered) {
    for (const term of member.terms) termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
  }
  const half = ordered.length / 2;
  const sharedTerms = [...termCounts.entries()]
    .filter(([, count]) => count >= half)
    .map(([term]) => term)
    .sort(compareCodePoints);
  const rootIds = [
    ...new Set(memberIds.map((id) => rootById.get(id)).filter((id): id is string => !!id)),
  ].sort(compareCodePoints);
  return {
    candidate_id: stableId("topic-candidate", {
      algorithm_id: TOPIC_CANDIDATE_METHOD,
      algorithm_version: TOPIC_CANDIDATE_METHOD_VERSION,
      member_ids: [...memberIds].sort(compareCodePoints),
      threshold: threshold.toFixed(6),
    }),
    method: TOPIC_CANDIDATE_METHOD,
    algorithm_version: TOPIC_CANDIDATE_METHOD_VERSION,
    threshold: roundTopicScore(threshold),
    member_ids: memberIds,
    member_paths: ordered.map((member) => member.document.corpus_path),
    member_count: memberIds.length,
    root_ids: rootIds,
    spans_roots: rootIds.length > 1,
    shared_terms: sharedTerms,
  };
}

export interface BuildTopicCandidatesInput {
  documents: readonly TopicDocumentInput[];
  threshold?: number;
  /** Root of each document, used only to report whether a topic spans disks. */
  rootById: ReadonlyMap<string, string>;
}

/**
 * Connected groups of documents whose salient vocabulary overlaps.
 *
 * Reached through an inverted index over salient terms, for the same reason the
 * near-duplicate pass uses one: two documents sharing no salient term score
 * exactly zero and cannot qualify at any positive threshold, so comparing them is
 * provably unnecessary rather than merely unlikely to matter.
 */
export function buildTopicCandidates(input: BuildTopicCandidatesInput): TopicCandidate[] {
  const threshold = input.threshold ?? DEFAULT_TOPIC_THRESHOLD;
  const eligible = input.documents.filter((document) => document.token_count >= TOPIC_MIN_TOKENS);
  if (eligible.length < 2) return [];

  // At a threshold of zero every pair qualifies by definition, including two
  // documents sharing no term at all. The salient-term index below can only reach
  // pairs that share one, so it would silently under-report — the same reason the
  // near-duplicate pass keeps an exhaustive path at zero. Every eligible document
  // is one component, which is what "every pair joins" means.
  if (roundTopicScore(threshold) <= 0) {
    return [buildTopicCandidate(eligible.map((document) => ({ document, terms: new Set<string>() })), threshold, input.rootById)];
  }

  const documentFrequency = new Map<string, number>();
  for (const document of eligible) {
    for (const [term] of document.term_counts) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  const features = eligible.map((document) => ({
    document,
    terms: new Set(salientTerms(document, documentFrequency, eligible.length)),
  }));

  const postings = new Map<string, number[]>();
  for (let index = 0; index < features.length; index++) {
    for (const term of features[index].terms) {
      const bucket = postings.get(term);
      if (bucket === undefined) postings.set(term, [index]);
      else bucket.push(index);
    }
  }

  const parent = features.map((_feature, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const union = (a: number, b: number): void => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent[rootA] = rootB;
  };

  const compared = new Set<number>();
  for (const bucket of postings.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i++) {
      for (let j = i + 1; j < bucket.length; j++) {
        const [left, right] = [bucket[i], bucket[j]];
        if (find(left) === find(right)) continue;
        const key = left * features.length + right;
        if (compared.has(key)) continue;
        compared.add(key);
        if (jaccardOfSets(features[left].terms, features[right].terms) < threshold) continue;
        union(left, right);
      }
    }
  }

  const components = new Map<number, number[]>();
  for (let index = 0; index < features.length; index++) {
    const root = find(index);
    const bucket = components.get(root);
    if (bucket === undefined) components.set(root, [index]);
    else bucket.push(index);
  }

  const candidates: TopicCandidate[] = [];
  for (const bucket of components.values()) {
    if (bucket.length < 2) continue;
    candidates.push(buildTopicCandidate(bucket.map((index) => features[index]), threshold, input.rootById));
  }
  return candidates.sort(
    (a, b) =>
      b.member_count - a.member_count
      || compareCodePoints(a.member_paths[0] ?? "", b.member_paths[0] ?? "")
      || compareCodePoints(a.candidate_id, b.candidate_id),
  );
}

/** Hash binding every rule the candidate passes apply. */
export function candidateProfileHash(input: {
  topicThreshold: number;
  nearDuplicateThreshold: number;
}): string {
  return stableId("candidate-profile", {
    near_duplicate_threshold: input.nearDuplicateThreshold.toFixed(6),
    project_method: PROJECT_CANDIDATE_METHOD,
    project_method_version: PROJECT_CANDIDATE_METHOD_VERSION,
    topic_df_ceiling: TOPIC_DOCUMENT_FREQUENCY_CEILING.toFixed(6),
    topic_df_min_documents: TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS,
    topic_method: TOPIC_CANDIDATE_METHOD,
    topic_method_version: TOPIC_CANDIDATE_METHOD_VERSION,
    topic_min_term_length: TOPIC_MIN_TERM_LENGTH,
    topic_min_tokens: TOPIC_MIN_TOKENS,
    topic_salient_terms: TOPIC_SALIENT_TERMS,
    topic_stopwords: [...TOPIC_STOPWORDS].sort(compareCodePoints),
    topic_threshold: input.topicThreshold.toFixed(6),
  });
}
