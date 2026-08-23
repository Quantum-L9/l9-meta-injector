export declare const PROJECT_CANDIDATE_METHOD = "container-project-candidate/v1";
export declare const PROJECT_CANDIDATE_METHOD_VERSION = "1.0.0";
export declare const TOPIC_CANDIDATE_METHOD = "lexical-topic-candidate/v1";
export declare const TOPIC_CANDIDATE_METHOD_VERSION = "1.0.0";
/** Default salient-vocabulary overlap at which two documents join a topic. */
export declare const DEFAULT_TOPIC_THRESHOLD = 0.35;
/** Documents shorter than this are not scored; short text overlaps by accident. */
export declare const TOPIC_MIN_TOKENS = 20;
/** Salient terms kept per document, by frequency then code point. */
export declare const TOPIC_SALIENT_TERMS = 40;
/** A term in more than this share of eligible documents is corpus boilerplate. */
export declare const TOPIC_DOCUMENT_FREQUENCY_CEILING = 0.8;
/**
 * Corpus size below which no term is treated as boilerplate.
 *
 * "This term is in most of the corpus" is only a statement about vocabulary once
 * the corpus is big enough for *most* to mean something. Applying the ceiling to
 * four documents would strip the very terms that make two of them a topic.
 */
export declare const TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS = 5;
/** Shortest term considered salient. */
export declare const TOPIC_MIN_TERM_LENGTH = 3;
/**
 * Closed stopword list.
 *
 * Deliberately small and English-only. A large list tuned per corpus would make
 * the analysis depend on an unstated model of the language being analyzed; a
 * short list of function words removes the terms that would otherwise join every
 * document to every other one.
 */
export declare const TOPIC_STOPWORDS: readonly string[];
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
    declared_identifier_evidence?: {
        field: string;
        line: number;
    };
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
export declare function containerOf(rootRelativePath: string): string;
/**
 * The project container a marker implies.
 *
 * A build manifest sits in its project's directory. A CI definition sits two
 * levels below it, in `.github/workflows/` or `.circleci/`, so the container is
 * the directory holding that dot-directory rather than the dot-directory itself.
 */
export declare function projectContainerForMarker(rootRelativePath: string): string;
/** True when `candidate` is `container` itself or lies beneath it. */
export declare function isUnderContainer(containerPath: string, candidate: string): boolean;
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
export declare function buildProjectCandidates(input: BuildProjectCandidatesInput): ProjectCandidate[];
export interface DeclaredIdentifier {
    identifier: string;
    field: string;
    /** 1-based line the value was read from, so the claim can be checked. */
    line: number;
}
/** Manifest basenames whose body this module knows how to read a name out of. */
export declare const DECLARED_IDENTIFIER_MANIFESTS: readonly string[];
/** True when `readDeclaredIdentifier` claims this basename. */
export declare function readsDeclaredIdentifier(basename: string): boolean;
/**
 * Read the name a manifest declares for itself.
 *
 * Following ADR-031, nothing is inferred from the filename: the value comes from
 * the body, and the line it came from is carried with it. A manifest that
 * declares no name yields nothing rather than a guess derived from its directory.
 */
export declare function readDeclaredIdentifier(basename: string, text: string): DeclaredIdentifier | undefined;
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
export declare function salientTerms(document: TopicDocumentInput, documentFrequency: ReadonlyMap<string, number>, eligibleDocumentCount: number): string[];
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
export declare function buildTopicCandidates(input: BuildTopicCandidatesInput): TopicCandidate[];
/** Hash binding every rule the candidate passes apply. */
export declare function candidateProfileHash(input: {
    topicThreshold: number;
    nearDuplicateThreshold: number;
}): string;
