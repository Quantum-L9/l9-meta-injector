/**
 * Schema of this projection.
 *
 * Renamed from `l9.corpus-document-signals/v1` when the document gained the
 * block-bound evidence records below. A reader that understood the old name was
 * reading a document of counts; this one carries claims and the coordinates they
 * were read at, which is a different contract rather than more of the same one.
 */
export declare const CORPUS_DOCUMENT_SIGNALS_SCHEMA = "l9.document-signals/v1";
/**
 * How many evidence records the document lists per format.
 *
 * The listing is a sample; the counts beside it are complete. A corpus of ten
 * thousand decoded documents states far more than a person will read, and a file
 * that grew without bound would be one nobody opens. What is never bounded is the
 * *count*: `signal_count` is every claim read, `listed_signal_count` is how many
 * appear below it, and their difference is stated rather than left to subtraction.
 */
export declare const MAX_LISTED_SIGNALS_PER_FORMAT = 50;
/** A count keyed by a name, sorted by name so the document is canonical. */
export interface NameCount {
    name: string;
    count: number;
}
/** One decoder's work over the corpus. */
export interface FormatSignal {
    format: string;
    decoder_id: string;
    decoder_version: string;
    /** Artifacts this decoder claimed. */
    eligible_count: number;
    /** Of those, the ones it turned into a normalized document. */
    decoded_count: number;
    /** Blocks produced across those documents. */
    block_count: number;
    /** Why the rest were refused, by the decoder's own reason code. */
    refusals: NameCount[];
    /** The locator kinds this format actually cited, in code-point order. */
    locator_kinds: string[];
}
/** Whether decoded text reached the analysis, or only the coverage report. */
export interface AnalysisParticipation {
    decoded_document_count: number;
    /** Decoded documents that produced at least one interpretation assertion. */
    interpreted_count: number;
    /** Decoded documents that entered lexical analysis. */
    lexically_analyzed_count: number;
    /** Decoded documents named by at least one candidate of any kind. */
    candidate_member_count: number;
    /**
     * The same participation counts, per format.
     *
     * A corpus-wide total can be carried entirely by the Markdown in it. Split by
     * format, a decoder that opens documents nothing downstream reads has nowhere
     * to hide.
     */
    by_format: {
        format: string;
        decoded_count: number;
        interpreted_count: number;
        lexically_analyzed_count: number;
        candidate_member_count: number;
    }[];
}
/** A real locator, printed so the coordinate claim can be read off the report. */
export interface LocatorExample {
    format: string;
    block_id: string;
    kind: string;
    locator: Record<string, unknown>;
}
/**
 * One claim a decoded document made, with everything needed to check it.
 *
 * A reader holding this record can find the artifact by id, confirm the bytes by
 * hash, identify which decoding of those bytes was read, open the block by id,
 * and go to the coordinate the block's own format has. Nothing here is a line
 * number: a Word document has none, and a plausible one would make this record
 * look checkable while being uncheckable.
 */
export interface DocumentSignalRecord {
    artifact_id: string;
    source_path: string;
    format: string;
    /** Hash of the source bytes, not of the decoded text. */
    raw_content_hash: string | null;
    normalized_document_id: string | null;
    decoder_id: string;
    decoder_version: string;
    block_id: string;
    block_kind: string;
    /** The block's own coordinate. Its `kind` field says which shape it is. */
    structured_locator: Record<string, unknown>;
    predicate: string;
    object: string;
    bounded_excerpt: string;
    evidence_class: string;
    confidence: string;
    extractor_id: string;
}
/** What the decoded documents of one format were found to state. */
export interface FormatSignalEvidence {
    format: string;
    /** Documents of this format that stated at least one claim. */
    documents_with_signals: number;
    /** Every claim read from this format. Complete, never sampled. */
    signal_count: number;
    /** Claims listed in `records` below. */
    listed_signal_count: number;
    /** `signal_count - listed_signal_count`, stated rather than implied. */
    omitted_signal_count: number;
    /** Which predicates this format produced, and how many of each. */
    predicates: NameCount[];
    records: DocumentSignalRecord[];
}
/** The whole block-bound evidence layer, by format. */
export interface DocumentSignalEvidence {
    /** Identity of the rules that read the blocks. */
    profile_id: string;
    profile_version: string;
    profile_hash: string;
    extractor_id: string;
    document_count: number;
    signal_count: number;
    predicates: NameCount[];
    by_format: FormatSignalEvidence[];
}
export interface CorpusDocumentSignals {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    /** `id@version` for every decoder in the registry this run used. */
    decoder_profiles: string[];
    formats: FormatSignal[];
    block_kinds: NameCount[];
    locator_kinds: NameCount[];
    analysis_participation: AnalysisParticipation;
    locator_examples: LocatorExample[];
    /** What the decoded documents actually said, bound to where they said it. */
    block_signals: DocumentSignalEvidence;
}
/** One artifact as this builder needs it. */
export interface DocumentSignalInput {
    virtual_source_id: string;
    format: string;
    decoder_id: string;
    decoder_version: string;
    decoded: boolean;
    /** The decoder's refusal reason when `decoded` is false. */
    reason: string | null;
    blocks: readonly {
        block_id: string;
        kind: string;
        locator: Record<string, unknown>;
    }[];
}
/** One block-bound claim, as the scan hands it over. */
export interface DocumentSignalAssertionInput {
    artifact_id: string;
    source_path: string;
    format: string;
    raw_content_hash: string | null;
    normalized_document_id: string | null;
    decoder_id: string;
    decoder_version: string;
    block_id: string;
    block_kind: string;
    structured_locator: Record<string, unknown>;
    predicate: string;
    object: string;
    bounded_excerpt: string;
    evidence_class: string;
    confidence: string;
    extractor_id: string;
}
export interface DocumentSignalsInput {
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
    decoderProfiles: readonly string[];
    /** Identity of the block-reading rules, so a claim names the rules that read it. */
    blockProfile: {
        profile_id: string;
        profile_version: string;
        profile_hash: string;
        extractor_id: string;
    };
    /** Every claim read out of a decoded document's blocks, in any order. */
    blockSignals: readonly DocumentSignalAssertionInput[];
    documents: readonly DocumentSignalInput[];
    /** Artifact ids that produced at least one interpretation assertion. */
    interpreted: ReadonlySet<string>;
    /** Artifact ids that entered lexical analysis. */
    lexicallyAnalyzed: ReadonlySet<string>;
    /** Artifact ids named by at least one candidate. */
    candidateMembers: ReadonlySet<string>;
}
/** Build the document-signals projection for one run. */
export declare function buildCorpusDocumentSignals(input: DocumentSignalsInput): CorpusDocumentSignals;
/** Canonical bytes of the document-signals projection. */
export declare function renderCorpusDocumentSignals(signals: CorpusDocumentSignals): string;
