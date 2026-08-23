/** Schema of the readiness evidence projection. */
export declare const READINESS_EVIDENCE_SCHEMA = "l9.readiness-evidence/v1";
export declare const READINESS_PROFILE_ID = "l9-meta-injector-readiness-evidence";
export declare const READINESS_PROFILE_VERSION = "1.0.0";
/** The complete signal vocabulary. Closed: an unlisted signal is never emitted. */
export declare const READINESS_SIGNALS: readonly ["artifact.has_source_code", "artifact.has_tests", "artifact.has_build_manifest", "artifact.has_ci_definition", "artifact.has_container_definition", "artifact.has_deployment_definition", "artifact.has_specification", "artifact.has_documentation", "artifact.has_open_tasks", "artifact.has_blockers", "artifact.has_roadmap", "artifact.has_plan"];
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
 * Counts for one body of work.
 *
 * Every field is a count of things observed. None of them is combined with any
 * other, weighted, or projected forward: a strategy layer that wants a ratio can
 * divide two of these itself and own the meaning of the result.
 */
export interface BodyOfWorkMetrics {
    source_file_count: number;
    test_file_count: number;
    manifest_count: number;
    ci_definition_count: number;
    container_definition_count: number;
    deployment_definition_count: number;
    specification_count: number;
    documentation_count: number;
    open_task_count: number;
    completed_task_count: number;
    blocker_count: number;
    plan_count: number;
    roadmap_count: number;
    exact_duplicate_count: number;
    near_duplicate_count: number;
    candidate_version_count: number;
    supersession_declaration_count: number;
    /** Distinct content hashes among the members. Exact duplicates collapse to one. */
    unique_content_estimate: number;
    /** Bytes of those distinct hashes, counted once each. */
    unique_content_bytes_estimate: number;
}
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
