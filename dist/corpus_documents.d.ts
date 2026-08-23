/**
 * Schema of the normalized-document index.
 *
 * v2 because v1 could not truthfully say what the corpus now knows. It carried a
 * single `decoder` for the whole index and repeated it on every entry, so a
 * `.docx` row named the text decoder; and it carried no format, no block count
 * and no locator type at all. Those are not additions to what v1 meant — they
 * correct what it said. Overloading the v1 name would leave a reader unable to
 * tell an index whose decoder fields are accurate from one whose are not.
 */
export declare const DOCUMENT_INDEX_SCHEMA = "l9.document-index/v2";
/**
 * One normalized document, or one artifact that could not become a document.
 *
 * `corpus_path` is root-scoped (`root::path`) and, for an archive member, carries
 * the `archive.zip!/member` locator that names where inside the archive it lived.
 * No absolute path appears: a document read from `/Volumes/OldSSD` and the same
 * document read from `/mnt/backup` are one document.
 */
export interface NormalizedDocumentEntry {
    /** The artifact this document was decoded from. */
    artifact_id: string;
    root_id: string;
    corpus_path: string;
    /** Path inside its root, POSIX, possibly an `archive.zip!/member` locator. */
    root_relative_path: string;
    /** Hash of the *source bytes*, not of the decoded text. */
    content_hash: string | null;
    /**
     * `H(content_hash, decoder_id, decoder_version)`.
     *
     * Null exactly when there is no content hash to derive it from. Two artifacts
     * with identical bytes share one normalized document id, which is what lets a
     * duplicate be decoded once and read twice.
     */
    normalized_document_id: string | null;
    /** The decoder that actually read these bytes, not the corpus's default one. */
    decoder_id: string;
    decoder_version: string;
    /** What the decoder read the bytes *as*. Null when nothing decoded them. */
    format: string | null;
    /** Blocks the decoding produced. Null when it did not decode. */
    block_count: number | null;
    /**
     * The coordinate system this document's blocks cite.
     *
     * Null when the document has no blocks, and also null in the case a document
     * cites more than one kind — where `structured_locator_types` below has the
     * full answer. A singular field that silently picked one of several would be a
     * claim about the document that no block supports.
     */
    structured_locator_type: string | null;
    /** Every locator kind the blocks cite, distinct and in code-point order. */
    structured_locator_types: string[];
    /** False when no decoder claimed the artifact, or decoding refused. */
    decoded: boolean;
    /** Why it was not decoded. Null when it was. */
    undecoded_reason: string | null;
    /** Source bytes considered. Null when the artifact was never opened. */
    byte_length: number | null;
    /** Tokens in the normalized text. Null when it was not decoded. */
    token_count: number | null;
    /** Hash of the normalized analysis text. Null when it was not decoded. */
    normalized_content_hash: string | null;
    is_archive_member: boolean;
    /** Enclosing archives, outermost first. Empty for a file on disk. */
    archive_ancestry: string[];
}
export interface DocumentIndexSummary {
    artifact_count: number;
    decoded_count: number;
    undecoded_count: number;
    /** Distinct `normalized_document_id` values: duplicates collapse to one. */
    distinct_document_count: number;
    archive_member_count: number;
    total_token_count: number;
    /** Why artifacts were not decoded, by reason, in code-point order. */
    undecoded_by_reason: {
        reason: string;
        count: number;
    }[];
    /**
     * What was decoded, by format.
     *
     * The count an operator asks for by name — "how many of my Word documents did
     * you read" — and the one a corpus-wide total carried by Markdown cannot
     * answer.
     */
    by_format: {
        format: string;
        decoder_id: string;
        decoder_version: string;
        decoded_count: number;
        block_count: number;
        structured_locator_types: string[];
    }[];
}
export interface DocumentIndex {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    /** `id@version` for every decoder in the registry this run used. */
    decoder_profiles: string[];
    summary: DocumentIndexSummary;
    documents: NormalizedDocumentEntry[];
}
/** One artifact as the scan knows it, reduced to the fields the index records. */
export interface DocumentIndexArtifactInput {
    artifactId: string;
    rootId: string;
    corpusPath: string;
    rootRelativePath: string;
    contentHash: string | null;
    sizeBytes: number | null;
    isArchiveMember: boolean;
    archiveAncestry?: readonly string[];
    /** What the decoder established, or undefined when it never ran. */
    normalized?: {
        decodes: boolean;
        reason: string | null;
        byte_length: number;
        normalized_content_hash: string | null;
        token_count: number;
        /** The format the bytes were read as, and by which decoder. */
        format?: string;
        decoder_id?: string;
        decoder_version?: string;
        block_count?: number;
        /** Locator kinds the blocks cite, in any order. */
        locator_kinds?: readonly string[];
    };
    /** Identity of the decoded document, when one exists. */
    normalizedDocumentId?: string | null;
}
export interface BuildDocumentIndexInput {
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
    /**
     * Decoder to name for an artifact whose record does not name one.
     *
     * Only reached for an artifact nothing decoded, where the field says which
     * decoder would have been asked rather than which one read it.
     */
    decoderId: string;
    decoderVersion: string;
    /** `id@version` for every decoder in the registry, in any order. */
    decoderProfiles: readonly string[];
    artifacts: readonly DocumentIndexArtifactInput[];
}
/**
 * Why an artifact has no document.
 *
 * Kept as a closed vocabulary so the summary can group by it. "No decoder claimed
 * this extension" and "a decoder tried and the bytes were not text" are different
 * facts about a corpus, and a single `undecoded` count would hide which one an
 * operator is looking at.
 */
export declare const UNDECODED_REASON_NOT_ELIGIBLE = "no_decoder_claims_this_artifact";
/**
 * Summarize a set of index entries.
 *
 * Exported and used for both the corpus index and each per-root one, because the
 * per-root summary used to be a second hand-written copy of these counts. Two
 * implementations of "how many did we decode" drift, and the one nobody looks at
 * drifts first — a per-root file is exactly the one nobody looks at until they
 * need it.
 */
export declare function summarizeDocuments(documents: readonly NormalizedDocumentEntry[]): DocumentIndexSummary;
/** Build the index. Ordering is by corpus path, then artifact id, both code-point. */
export declare function buildDocumentIndex(input: BuildDocumentIndexInput): DocumentIndex;
/** Canonical bytes of a document index. */
export declare function renderDocumentIndex(index: DocumentIndex): string;
/** The decoded documents only, keyed by artifact id, for a downstream pass. */
export declare function decodedDocumentsByArtifact(index: DocumentIndex): Map<string, NormalizedDocumentEntry>;
