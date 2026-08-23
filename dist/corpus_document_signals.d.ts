export declare const CORPUS_DOCUMENT_SIGNALS_SCHEMA = "l9.corpus-document-signals/v1";
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
export interface DocumentSignalsInput {
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
    decoderProfiles: readonly string[];
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
