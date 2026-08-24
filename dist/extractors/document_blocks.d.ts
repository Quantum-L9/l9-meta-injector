import { BlockKind, BlockLocator } from "../documents/decoder";
/** Identity of the block-signal policy. Bumped when these rules change. */
export declare const DOCUMENT_BLOCK_PROFILE_ID = "meta-injector-document-block-signals";
export declare const DOCUMENT_BLOCK_PROFILE_VERSION = "1.0.0";
/** The single extractor this profile runs, named in every assertion it produces. */
export declare const DOCUMENT_BLOCK_EXTRACTOR_ID = "document-block-work-intelligence/v1";
/** One block, as this reader needs it. */
export interface DocumentBlockView {
    block_id: string;
    kind: BlockKind;
    text: string;
    locator: BlockLocator;
}
/** Where a claim was read from, in the coordinate system its format has. */
export interface DocumentBlockEvidence {
    normalized_document_id: string | null;
    decoder_id: string;
    decoder_version: string;
    block_id: string;
    block_kind: BlockKind;
    /** The block's own locator, verbatim. Its `kind` says which shape it is. */
    locator: BlockLocator;
}
/**
 * A claim a decoded document makes about itself, with block-bound evidence.
 *
 * The field set is the one a reader needs to go back to the source and check:
 * which artifact, which exact bytes, which decoding of them, which block inside
 * that decoding, and what the block said.
 */
export interface DocumentBlockAssertion {
    assertion_id: string;
    /** The artifact this document was decoded from. */
    subject_id: string;
    predicate: string;
    object: string;
    /** Root-relative POSIX path, possibly an `archive.zip!/member` locator. */
    source_path: string;
    /** Hash of the *source bytes*, not of the decoded text. */
    source_content_hash: string | null;
    format: string;
    evidence: DocumentBlockEvidence;
    evidence_excerpt: string;
    evidence_class: "declared" | "observed";
    authority: "source";
    confidence: "low" | "medium" | "high";
    extractor_id: string;
}
export interface ReadDocumentBlocksInput {
    /** Repository-model artifact id these assertions are filed against. */
    subjectId: string;
    sourcePath: string;
    sourceContentHash: string | null;
    normalizedDocumentId: string | null;
    decoderId: string;
    decoderVersion: string;
    format: string;
    blocks: readonly DocumentBlockView[];
}
/**
 * Hash of the rules this pass applies.
 *
 * A caller that caches block signals keys them on this, so a change to the
 * vocabulary invalidates what the previous vocabulary produced rather than
 * serving it under the new profile's name.
 */
export declare function documentBlockProfileHash(): string;
/**
 * Read every work signal a decoded document states about itself.
 *
 * Never throws on malformed content: a document that cannot be read is a fact
 * about the corpus rather than a crash, and the decoder has already recorded the
 * ones that could not be opened at all.
 */
export declare function readDocumentBlockSignals(input: ReadDocumentBlocksInput): DocumentBlockAssertion[];
