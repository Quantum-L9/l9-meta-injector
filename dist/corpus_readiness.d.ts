/** Schema of the readiness evidence projection. */
export declare const READINESS_EVIDENCE_SCHEMA = "l9.readiness-evidence/v1";
export declare const READINESS_PROFILE_ID = "l9-meta-injector-readiness-evidence";
export declare const READINESS_PROFILE_VERSION = "1.0.0";
/** The complete signal vocabulary. Closed: an unlisted signal is never emitted. */
export declare const READINESS_SIGNALS: readonly ["artifact.has_source_code", "artifact.has_tests", "artifact.has_build_manifest", "artifact.has_build_definition", "artifact.has_ci_definition", "artifact.has_container_definition", "artifact.has_deployment_definition", "artifact.has_specification", "artifact.has_documentation", "artifact.has_open_tasks", "artifact.has_blockers", "artifact.has_roadmap", "artifact.has_plan"];
export type ReadinessSignalName = (typeof READINESS_SIGNALS)[number];
/**
 * Metric names this package refuses to compute.
 *
 * Each one requires a judgement about worth, completion or intent that no count
 * of files supports. They are listed so the refusal is testable rather than
 * merely stated.
 */
export declare const FORBIDDEN_READINESS_METRICS: readonly string[];
export type ReadinessEvidenceClass = "extension_convention" | "filename_convention" | "path_convention" | "declared_assertion";
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
        language_distribution: {
            language: string;
            artifact_count: number;
        }[];
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
export declare const UNIQUE_CONTENT_METHOD: string;
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
    signal_counts: {
        signal: ReadinessSignalName;
        artifact_count: number;
    }[];
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
    signal_totals: {
        signal: ReadinessSignalName;
        artifact_count: number;
    }[];
    /** Restated in the emitted document so a consumer reading only JSON sees it. */
    no_ranking_statement: string;
}
export declare const NO_RANKING_STATEMENT: string;
/** Every signal that holds for one artifact, each carrying the evidence for it. */
export declare function readinessSignalsFor(input: ReadinessArtifactInput): ReadinessSignal[];
/** Signal evidence for every artifact that carries at least one signal. */
export declare function buildReadinessArtifactEvidence(artifacts: readonly ReadinessArtifactInput[]): ReadinessArtifactEvidence[];
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
/** Metrics for one member set. Pure counting over already-established facts. */
export declare function buildBodyOfWorkMetrics(memberIds: readonly string[], context: BodyOfWorkContext): BodyOfWorkMetrics;
export interface BodyOfWorkSpec {
    origin: BodyOfWork["origin"];
    origin_ref: string;
    member_ids: readonly string[];
}
/** Build one body of work from its members and the corpus-wide context. */
export declare function buildBodyOfWork(spec: BodyOfWorkSpec, context: BodyOfWorkContext): BodyOfWork;
/** Hash binding the readiness rules that produced a document. */
export declare function readinessProfileHash(): string;
export interface BuildReadinessEvidenceInput {
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
    artifacts: readonly ReadinessArtifactInput[];
    bodies: readonly BodyOfWorkSpec[];
    context: BodyOfWorkContext;
}
/** Assemble `readiness-evidence.json`. Counts and citations, never a ranking. */
export declare function buildReadinessEvidence(input: BuildReadinessEvidenceInput): ReadinessEvidence;
