export declare const KEYPHRASE_PROFILE_ID = "corpus-keyphrases/v1";
export declare const KEYPHRASE_PROFILE_VERSION = "1.0.0";
/** Tokenizer identity. Unicode word tokens over NFKC-normalized, lowercased text. */
export declare const KEYPHRASE_TOKENIZER_VERSION = "unicode-word/v1";
/** Stopword list identity. Closed, English function words, versioned as a set. */
export declare const KEYPHRASE_STOPWORD_PROFILE = "en-function-words/v1";
/**
 * Stemmer identity.
 *
 * Deliberately the smallest useful rule: strip a trailing plural `s`. Singular
 * and plural spellings of one noun are the most common way two documents about
 * the same thing fail to match on vocabulary, and nothing else in English is
 * worth the false merges a fuller stemmer causes without a lexicon.
 *
 * The exclusions matter more than the rule. `-ss` (process), `-us` (status) and
 * `-is` (analysis) are not plurals, and stripping them produces terms that are
 * not words and that collide with unrelated ones.
 */
export declare const KEYPHRASE_STEMMING_PROFILE = "trailing-plural-s/v1";
/** Weighting algorithm identity. */
export declare const KEYPHRASE_WEIGHTING_ALGORITHM = "field-weighted-tf-idf/v1";
/**
 * How much each field counts toward a term's frequency.
 *
 * A word in a title is evidence about the whole document; the same word in one
 * paragraph is evidence about that paragraph. The ratios are stated here rather
 * than tuned per corpus, because a weighting that changed with the corpus would
 * make two runs incomparable.
 */
export declare const KEYPHRASE_FIELD_WEIGHTS: Readonly<Record<KeyphraseField, number>>;
/** Keyphrases kept per artifact, highest weight first. Bounded so a pack stays bounded. */
export declare const MAX_KEYPHRASES_PER_ARTIFACT = 24;
/** Shortest term that can be a keyphrase. Two-letter tokens carry no topic. */
export declare const KEYPHRASE_MIN_TERM_LENGTH = 3;
export type KeyphraseField = "title" | "heading" | "declared_identifier" | "body";
/**
 * Closed stopword list: English function words only.
 *
 * Short on purpose. A long list tuned to a corpus encodes an unstated model of
 * what that corpus is about, and then the analysis is partly a description of the
 * list. These are words that would otherwise join every document to every other.
 */
export declare const KEYPHRASE_STOPWORDS: readonly string[];
/**
 * Apply the versioned stemmer to one already-normalized token.
 *
 * Exported because the pair pass must stem the same way, and two implementations
 * of one rule is how the two sides quietly stop agreeing.
 */
export declare function stemToken(token: string): string;
/** Normalize, tokenize, drop stopwords and short tokens, then stem. */
export declare function analysisTerms(text: string): string[];
/** Identity of the keyphrase profile, binding every input that changes its output. */
export declare function keyphraseProfileHash(): string;
/** One assertion, reduced to the fields the feature view reads. */
export interface SemanticAssertion {
    assertion_id: string;
    predicate: string;
    object: string;
}
/** A project or package name a manifest declared, with the manifest that declared it. */
export interface SemanticDeclaredIdentifier {
    identifier: string;
    /** Manifest basename, lowercased, e.g. `package.json`. */
    manifest: string;
    /** The field inside the manifest, e.g. `name` or `module`. */
    field: string;
}
export interface SemanticArtifactInput {
    artifact_id: string;
    root_id: string;
    corpus_path: string;
    root_relative_path: string;
    content_hash: string | null;
    normalized_document_id: string | null;
    is_archive_member: boolean;
    archive_ancestry?: readonly string[];
    /**
     * Body text, when a caller has it in hand (tests, small documents).
     *
     * The scan does not: it caches a document's *term counts* and never its body,
     * so `body_term_counts` is the production path and this is the convenience one.
     */
    body_text?: string;
    /**
     * Already-tokenized body, as the lexical cache stores it.
     *
     * Using counts rather than text is why this pass never needs the document back.
     * Terms arrive raw — untokenized by this module's rules — so stopwords and the
     * versioned stemmer are applied here, exactly as they would be to text.
     */
    body_term_counts?: readonly (readonly [string, number])[];
    assertions?: readonly SemanticAssertion[];
    declared_identifiers?: readonly SemanticDeclaredIdentifier[];
    exact_duplicate_cluster_id?: string | null;
    near_duplicate_candidate_ids?: readonly string[];
    /** Cache reference to this document's embedding, when embeddings ran. */
    embedding_ref?: string | null;
}
export interface Keyphrase {
    /** Stemmed, lowercased term. What the pair pass compares. */
    normalized_term: string;
    /** The most frequent surface spelling, for a person reading the report. */
    display_term: string;
    /** Field-weighted TF-IDF, six places. */
    weight: number;
    /** Strongest field the term appeared in. */
    evidence_source: KeyphraseField;
    /** Assertions the term was read out of. Empty when it came only from the body. */
    source_block_refs: string[];
}
/**
 * Everything the pairwise pass is allowed to look at.
 *
 * Flat, per-artifact, and derived entirely from recorded evidence. A field that
 * is empty means the corpus declared nothing of that kind, never that the
 * analysis chose not to look.
 */
export interface ArtifactFeatureView {
    artifact_id: string;
    root_id: string;
    corpus_path: string;
    root_relative_path: string;
    content_hash: string | null;
    normalized_document_id: string | null;
    normalized_title_tokens: string[];
    normalized_heading_tokens: string[];
    keyphrases: Keyphrase[];
    normalized_reference_targets: string[];
    declared_project_identifiers: string[];
    declared_package_names: string[];
    /**
     * Always empty in this release.
     *
     * No extractor declares a service name: the manifests read here name packages
     * and modules. The field is kept because a pair signal is defined over it, and
     * an absent field would read as "no service names were declared" rather than
     * "nothing in this release can declare one".
     */
    declared_service_names: string[];
    declared_dependencies: string[];
    statuses: string[];
    kinds: string[];
    task_terms: string[];
    milestone_terms: string[];
    blockers: string[];
    supersession_declarations: {
        predicate: string;
        object: string;
        assertion_id: string;
    }[];
    archive_ancestry: string[];
    is_archive_member: boolean;
    exact_duplicate_cluster_id: string | null;
    near_duplicate_candidate_ids: string[];
    embedding_ref: string | null;
}
/**
 * Normalize a reference target so two spellings of one path compare equal.
 *
 * A reference is written by a person: `./docs/a.md`, `docs/a.md` and `DOCS/A.MD`
 * all name one file. Leading `./`, a leading slash and case are removed; nothing
 * else is, because collapsing further would start merging genuinely different
 * targets.
 */
export declare function normalizeReferenceTarget(target: string): string;
/**
 * Build every feature view in one pass.
 *
 * Corpus-wide, because inverse document frequency is a fact about the corpus: the
 * same document scored alone and scored among ten thousand others has different
 * keyphrases, and only the second is meaningful.
 */
export declare function buildFeatureViews(artifacts: readonly SemanticArtifactInput[]): ArtifactFeatureView[];
