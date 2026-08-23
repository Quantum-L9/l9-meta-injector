import { CorpusDuplicateCluster, CorpusRelation, NearDuplicateCandidate } from "./corpus_analysis";
import { CorpusCache, CorpusCacheStats } from "./corpus_cache";
import { ProjectCandidate, TopicCandidate } from "./corpus_candidates";
import { CorpusCoverage } from "./corpus_coverage";
import { CorpusDiff } from "./corpus_diff";
import { CorpusDocumentSignals } from "./corpus_document_signals";
import { ReadinessEvidence } from "./corpus_readiness";
import { CorpusRootBinding, CorpusRootSpec, rootIdentity } from "./corpus_roots";
import { CorpusSnapshot, VerificationMode } from "./corpus_snapshot";
import { CorpusResourceBudgets, CorpusSessionStore } from "./corpus_session";
import { DecoderRegistry } from "./documents";
import { DocumentWorkSignalExport } from "./corpus_work_signal_export";
import { LocalArchivePolicy } from "./local_archive_policy";
import type { DocumentIndex, DocumentIndexSummary } from "./corpus_documents";
import type { SemanticAnalysisResult } from "./corpus_semantic_run";
import type { EmbeddingPairScore } from "./corpus_pairs";
import type { EmbeddingProvider, EmbeddingRunReport } from "./corpus_embeddings";
import { RepositoryModelPacket } from "./repository_model";
import { LocalSourceManifest } from "./local_source_model";
export declare const CORPUS_CANDIDATES_SCHEMA = "l9.corpus-candidates/v1";
/** Decoder that turns exact bytes into the text every later layer reads. */
export declare const TEXT_DECODER_ID = "utf8-text-decoder";
export declare const TEXT_DECODER_VERSION = "1.0.0";
/** Decoder that reads a build manifest's declared name out of its body. */
export declare const MANIFEST_DECODER_ID = "manifest-identifier-reader";
export declare const MANIFEST_DECODER_VERSION = "1.0.0";
export interface CorpusScanInput {
    roots: readonly CorpusRootSpec[];
    producerVersion: string;
    /** Operator's name for the corpus. A label; it enters no identity. */
    corpusId?: string;
    /** Timestamp recorded in each per-root packet. Excluded from identity. */
    generatedAt?: string;
    /** Wall clock recorded in each root's acquisition manifest. Operational only. */
    observedAt?: string;
    /**
     * `full` reads every byte; `incremental` may carry a previous run's hash forward
     * when size and mtime have not moved. Default `full`.
     */
    verification?: VerificationMode;
    /** Force a full read even under `incremental`, and say so in the snapshot. */
    verifyContent?: boolean;
    /** Decoder set to use. Defaults to the registry this release ships. */
    decoderRegistry?: DecoderRegistry;
    /**
     * Emit a snapshot marked `partial` when a root cannot be read, instead of
     * failing the run. The snapshot is never labelled complete, and every missing
     * root is named in it.
     */
    allowPartialRoots?: boolean;
    cache?: CorpusCache;
    session?: CorpusSessionStore;
    /** Snapshot of a previous run; when present, `corpus-diff.json` is produced. */
    previousSnapshot?: CorpusSnapshot;
    /**
     * The operator's acceptance of a weaker root identity for history.
     *
     * A root nobody named is keyed by its mount point's final segment, and two
     * unrelated directories can share one. Comparing, resuming or reusing hashes
     * across runs on such a key is a continuity claim this tool cannot make, so it
     * refuses by default; this is the operator saying they know these are the same
     * disk. See `src/corpus_root_history.ts`.
     */
    allowInferredRootHistory?: boolean;
    expandArchives?: boolean;
    interpret?: boolean;
    archivePolicy?: Partial<LocalArchivePolicy>;
    omitPatterns?: string[];
    omitFile?: string;
    hashMaxBytes?: number;
    maxFileBytes?: number;
    nearDuplicates?: {
        enabled?: boolean;
        threshold?: number;
    };
    topics?: {
        enabled?: boolean;
        threshold?: number;
    };
    budgets?: Partial<Omit<CorpusResourceBudgets, "archive">>;
    scratchParent?: string;
    /** Semantic candidate discovery. On by default; costs one pass over recorded evidence. */
    semanticAnalysis?: boolean;
    /** Cosine scores from an embedding pass the caller ran. Absent means embeddings were off. */
    embeddingPairs?: readonly EmbeddingPairScore[];
    embeddingReport?: EmbeddingRunReport;
    /**
     * A provider to run the embedding pass with, in place of supplying its results.
     *
     * The two are alternatives, not a pair: a caller either ran the pass itself and
     * hands over `embeddingPairs` and `embeddingReport`, or hands over a provider
     * and lets the scan run it. The scan is the only place that can, because the
     * text to embed is the normalized text and that does not exist until the
     * decoders have run.
     *
     * Absent — the default — means no embedding pass, no network request, and no
     * model call of any kind.
     */
    embeddingProvider?: EmbeddingProvider;
    /** Cosine at or above which a pair is offered to fusion. Default 0.75. */
    embeddingPairThreshold?: number;
    /** Overrides for the bounded reasoning evidence packs. */
    packBudget?: {
        maxArtifactsPerPack?: number;
        maxTotalPackCharacters?: number;
    };
}
export interface CorpusScanDiagnostic {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    corpus_path?: string;
}
export interface CorpusCandidatesDocument {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    corpus_profile_hash: string;
    roots: ReturnType<typeof rootIdentity>[];
    analysis_profile: {
        corpus_profile_id: string;
        corpus_profile_version: string;
        exact_duplicate_method: string;
        exact_duplicate_version: string;
        near_duplicate_method: string;
        near_duplicate_version: string;
        near_duplicate_threshold: number;
        near_duplicate_enabled: boolean;
        topic_candidate_method: string;
        topic_candidate_version: string;
        topic_threshold: number;
        topic_candidates_enabled: boolean;
        project_candidate_method: string;
        project_candidate_version: string;
        candidate_profile_hash: string;
        interpretation_profile_hash: string;
    };
    summary: {
        artifact_count: number;
        archive_count: number;
        archive_member_count: number;
        root_count: number;
        exact_duplicate_cluster_count: number;
        exact_duplicate_artifact_count: number;
        cross_root_duplicate_cluster_count: number;
        recoverable_duplicate_bytes: number;
        near_duplicate_candidate_count: number;
        cross_root_near_duplicate_count: number;
        topic_candidate_count: number;
        cross_root_topic_candidate_count: number;
        project_candidate_count: number;
        cross_root_project_candidate_count: number;
    };
    artifacts: {
        virtual_source_id: string;
        corpus_path: string;
        root_id: string;
        artifact_type: string;
        content_hash: string | null;
        size_bytes: number | null;
        is_archive_member: boolean;
        exact_duplicate_cluster_id: string | null;
        near_duplicate_candidate_ids: string[];
        topic_candidate_ids: string[];
        project_candidate_ids: string[];
    }[];
    exact_duplicate_clusters: CorpusDuplicateCluster[];
    relations: CorpusRelation[];
    near_duplicate_candidates: NearDuplicateCandidate[];
    topic_candidates: TopicCandidate[];
    project_candidates: ProjectCandidate[];
    /** Restated so a consumer reading only this file sees the epistemic classes. */
    candidate_statement: string;
}
export declare const CANDIDATE_STATEMENT: string;
/**
 * v2 alongside `l9.document-index/v2`, and for the same reason: the single
 * `decoder` field named one decoder for a root that seven of them read.
 */
export declare const DOCUMENT_COVERAGE_SCHEMA = "l9.document-coverage/v2";
/** Per-root document coverage: what the decoders reached inside one root. */
export interface RootDocumentCoverage extends DocumentIndexSummary {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    root_id: string;
    root_key: string;
    /** `id@version` for every decoder in the registry this run used. */
    decoder_profiles: string[];
}
/**
 * Everything one root produces on its own.
 *
 * A root's packet, acquisition manifest and document index are facts about that
 * root and are written under it, not folded into a corpus-wide file. A corpus is
 * an analysis across roots; it is not a filesystem that replaces them, and an
 * operator who later wants only the old SSD should find it whole in one place.
 */
export interface CorpusRootPacket {
    root_id: string;
    root_key: string;
    /** Directory name under `roots/`. A function of the root key alone. */
    directory: string;
    packet: RepositoryModelPacket;
    localSourceManifest: LocalSourceManifest;
    documentIndex: DocumentIndex;
    documentCoverage: RootDocumentCoverage;
}
export interface CorpusScanResult {
    snapshot: CorpusSnapshot;
    /** Each root's independent RMP. One per observed root, ordered by root id. */
    rootPackets: CorpusRootPacket[];
    candidates: CorpusCandidatesDocument;
    readiness: ReadinessEvidence;
    coverage: CorpusCoverage;
    diff: CorpusDiff | null;
    diagnostics: CorpusScanDiagnostic[];
    cacheStats: CorpusCacheStats;
    /** Roots as bound, including the absolute paths. Operational. */
    bindings: CorpusRootBinding[];
    /** How the mtime hint scored against the hashes, when a previous snapshot existed. */
    precheck: {
        predicted_unchanged: number;
        confirmed_unchanged: number;
        contradicted: number;
    };
    /** Bytes and files the acquisition pass actually read. */
    scanned: {
        files: number;
        bytes: number;
    };
    /** The normalized documents, written down rather than discarded with the run. */
    documentIndex: DocumentIndex;
    /** What each decoder read, and whether what it read reached the analysis. */
    documentSignals: CorpusDocumentSignals;
    /**
     * Every structured document work signal, complete and never sampled.
     *
     * `documentSignals` above is the report: complete counts, a bounded sample of
     * the evidence. This is the machine payload a downstream consumer reads, and
     * the two are built from one array so they cannot come to disagree about how
     * much the corpus found.
     */
    documentWorkSignals: DocumentWorkSignalExport;
    /** Candidate discovery over recorded evidence. Null when it was switched off. */
    semantic: SemanticAnalysisResult | null;
}
/**
 * True when some decoder in `registry` claims this artifact.
 *
 * This is the coverage denominator, so it has to be the same question the derive
 * stage asks. Deriving eligibility from a second hand-maintained extension list
 * is how "decoder_eligible_count" drifts away from what actually gets decoded.
 */
export declare function isDecodable(rootRelativePath: string, registry: DecoderRegistry): boolean;
/** True when the lexical passes claim this artifact. */
export declare function isLexicallyAnalyzable(rootRelativePath: string): boolean;
/**
 * True for a format whose source bytes are themselves the text.
 *
 * The distinction decides two things that must not drift apart: whether the file
 * is probed for UTF-8 before being opened, and whether its statements are read
 * from its lines or from its blocks. A `.md` file has lines an operator can open
 * the file to; a `.docx` has no lines at all, and the two are read accordingly.
 */
export declare function isTextFamilyFormat(format: string): boolean;
/**
 * Observe every root, derive the corpus, and project it.
 *
 * Asynchronous because the decode stage is bounded rather than unbounded: the
 * budgets decide how many documents are in flight and how many bytes of text are
 * held at once, and both of those need something to wait on.
 */
export declare function runCorpusScan(input: CorpusScanInput): Promise<CorpusScanResult>;
/** Canonical bytes of the candidate projection. */
export declare function renderCorpusCandidates(document: CorpusCandidatesDocument): string;
/** Canonical bytes of one root's document coverage. */
export declare function renderDocumentCoverage(coverage: RootDocumentCoverage): string;
/** Canonical bytes of the readiness projection. */
export declare function renderReadinessEvidence(evidence: ReadinessEvidence): string;
