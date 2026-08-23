/** Schema of the complete payload. One record per line. */
export declare const DOCUMENT_WORK_SIGNALS_SCHEMA = "l9.document-work-signals/v1";
/** Schema of the payload's completeness and integrity receipt. */
export declare const DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA = "l9.document-work-signals-manifest/v1";
/** Where the payload and its manifest are written inside a generation. */
export declare const DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE = "document-work-signals.jsonl";
export declare const DOCUMENT_WORK_SIGNALS_MANIFEST_FILE = "document-work-signals.manifest.json";
/**
 * One structured document work signal, as a downstream consumer receives it.
 *
 * Every field is either something the consumer needs to resolve the claim
 * against the corpus — the artifact, the exact bytes, the decoding, the block —
 * or the claim itself. Nothing here names an output directory, a scratch path,
 * a cache location, a hostname or a clock: the same signal read from the same
 * bytes is the same record wherever it is written.
 */
export interface DocumentWorkSignalRecord {
    /** Stable across runs and output locations. Never derived from a path. */
    signal_id: string;
    /**
     * The artifact as the corpus identifies it.
     *
     * Resolves against `corpus-snapshot.json` and `document-index.json`.
     */
    artifact_id: string;
    /**
     * The same artifact as its root's Repository Model Packet identifies it.
     *
     * Two ids because there are two identity domains and a consumer works in one
     * of them: the corpus id addresses an artifact inside this corpus, and the
     * packet id addresses it inside the root's own bundle. A payload carrying only
     * the first would leave a Topology adapter — which reads packets — unable to
     * attach any of these claims to the artifact it already knows.
     */
    rmp_artifact_id: string;
    /** Corpus-relative, or a virtual `archive.zip!/member` locator. Never absolute. */
    source_path: string;
    format: string;
    /** Hash of the source bytes, not of the decoded text. */
    raw_content_hash: string | null;
    normalized_document_id: string | null;
    decoder_id: string;
    decoder_version: string;
    block_id: string;
    block_kind: string;
    /** The block's own coordinate. Its `kind` says which shape it is. */
    structured_locator: Record<string, unknown>;
    predicate: string;
    object: string;
    bounded_excerpt: string;
    evidence_class: string;
    authority: string;
    confidence: string;
    extractor_id: string;
    /** Version of the profile the extractor ran under. */
    extractor_profile_version: string;
}
export interface DocumentWorkSignalFormatCount {
    format: string;
    document_count: number;
    signal_count: number;
}
export interface DocumentWorkSignalPredicateCount {
    predicate: string;
    signal_count: number;
}
export interface DocumentWorkSignalManifest {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    /** Identity of the rules that read the blocks. */
    profile_id: string;
    profile_version: string;
    profile_hash: string;
    /** Generation-relative name of the payload this manifest describes. */
    payload_file: string;
    record_count: number;
    /** Distinct artifacts that stated at least one signal. */
    document_count: number;
    by_format: DocumentWorkSignalFormatCount[];
    by_predicate: DocumentWorkSignalPredicateCount[];
    /** Length in bytes of the exact emitted payload. */
    payload_byte_length: number;
    /** SHA-256 of the exact emitted UTF-8 bytes. */
    payload_artifact_hash: string;
    /** SHA-256 over the records themselves, independent of where they were written. */
    payload_semantic_hash: string;
}
/** The payload, its manifest, and the bytes of each. */
export interface DocumentWorkSignalExport {
    records: DocumentWorkSignalRecord[];
    manifest: DocumentWorkSignalManifest;
    payloadJsonl: string;
    manifestJson: string;
}
/** Reference to the payload, small enough to sit inside the snapshot. */
export interface DocumentWorkSignalsRef {
    schema: string;
    manifest_ref: string;
    payload_ref: string;
    record_count: number;
    payload_semantic_hash: string;
    payload_artifact_hash: string;
}
/** One record, canonically rendered onto a single line. */
export declare function renderDocumentWorkSignalRecord(record: DocumentWorkSignalRecord): string;
export interface BuildDocumentWorkSignalExportInput {
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
    profile: {
        profile_id: string;
        profile_version: string;
        profile_hash: string;
    };
    /** Every signal the run produced, in any order. */
    records: readonly DocumentWorkSignalRecord[];
}
/**
 * Build the complete payload and its manifest.
 *
 * Refuses a duplicate `signal_id` rather than collapsing it. Two records under
 * one id mean either that the identity formula is losing a distinction it must
 * keep or that a signal was produced twice; both are defects, and a payload that
 * silently deduplicated them would report a record count no consumer could
 * reconcile against the corpus.
 */
export declare function buildDocumentWorkSignalExport(input: BuildDocumentWorkSignalExportInput): DocumentWorkSignalExport;
/** The snapshot-sized reference to a payload. */
export declare function documentWorkSignalsRef(manifest: DocumentWorkSignalManifest): DocumentWorkSignalsRef;
export interface VerifyDocumentWorkSignalExportInput {
    manifest: DocumentWorkSignalManifest;
    /** The payload exactly as it was written or read back. */
    payloadJsonl: string;
    /** Artifact ids the corpus observed. A signal naming anything else is dangling. */
    knownArtifactIds: ReadonlySet<string>;
    /** Normalized document ids the corpus produced. */
    knownNormalizedDocumentIds: ReadonlySet<string>;
    /**
     * `signal_count` from the sampled report, which states the complete total.
     *
     * The two documents are built from one array and must agree; if they ever
     * disagree, one of them is lying about how much the corpus found, and which
     * one is not knowable from either document alone.
     */
    reportSignalCount: number;
}
/**
 * Prove a payload is the complete set its manifest claims, before anything is
 * published.
 *
 * Every check here answers a question a consumer would otherwise have to take on
 * trust, and each returns a stated reason rather than a boolean: a validation
 * that fails without saying which record broke it sends a reader to the whole
 * file.
 */
export declare function verifyDocumentWorkSignalExport(input: VerifyDocumentWorkSignalExportInput): string[];
