"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.KEYPHRASE_STOPWORDS = exports.KEYPHRASE_MIN_TERM_LENGTH = exports.MAX_KEYPHRASES_PER_ARTIFACT = exports.KEYPHRASE_FIELD_WEIGHTS = exports.KEYPHRASE_WEIGHTING_ALGORITHM = exports.KEYPHRASE_STEMMING_PROFILE = exports.KEYPHRASE_STOPWORD_PROFILE = exports.KEYPHRASE_TOKENIZER_VERSION = exports.KEYPHRASE_PROFILE_VERSION = exports.KEYPHRASE_PROFILE_ID = void 0;
exports.stemToken = stemToken;
exports.analysisTerms = analysisTerms;
exports.keyphraseProfileHash = keyphraseProfileHash;
exports.normalizeReferenceTarget = normalizeReferenceTarget;
exports.buildFeatureViews = buildFeatureViews;
// corpus_semantics.ts — one analysis view per artifact, and the terms that make it findable.
//
// Everything here is a re-projection of evidence that already exists. The scan
// established what each document declares — its title, its headings, its status,
// what it depends on, what it supersedes — and filed those as assertions with a
// cited line each. The corpus pass established which artifacts are byte-identical
// and which are lexically close. This module reads both and produces one flat
// per-artifact record that a pairwise pass can compare without going back to the
// source.
//
// Not re-reading the source is the point, not an optimization. An analysis that
// re-opened files would be free to see something the recorded evidence does not
// contain, and every conclusion drawn from it would then be uncheckable against
// the packet that is supposed to justify it.
//
// The keyphrase half exists because titles alone do not find related documents.
// Two notes about the same subsystem often share no heading and no filename, and
// the thing they do share is vocabulary that is common *in them* and rare in the
// rest of the corpus. That is what TF-IDF measures, and it is worth being precise
// about what it does not measure: a high-scoring term is a term this document
// uses distinctively. It is not the document's topic, and this module never calls
// it one.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
// ───────────────────────────── keyphrase profile ─────────────────────────────
exports.KEYPHRASE_PROFILE_ID = "corpus-keyphrases/v1";
exports.KEYPHRASE_PROFILE_VERSION = "1.0.0";
/** Tokenizer identity. Unicode word tokens over NFKC-normalized, lowercased text. */
exports.KEYPHRASE_TOKENIZER_VERSION = "unicode-word/v1";
/** Stopword list identity. Closed, English function words, versioned as a set. */
exports.KEYPHRASE_STOPWORD_PROFILE = "en-function-words/v1";
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
exports.KEYPHRASE_STEMMING_PROFILE = "trailing-plural-s/v1";
/** Weighting algorithm identity. */
exports.KEYPHRASE_WEIGHTING_ALGORITHM = "field-weighted-tf-idf/v1";
/**
 * How much each field counts toward a term's frequency.
 *
 * A word in a title is evidence about the whole document; the same word in one
 * paragraph is evidence about that paragraph. The ratios are stated here rather
 * than tuned per corpus, because a weighting that changed with the corpus would
 * make two runs incomparable.
 */
exports.KEYPHRASE_FIELD_WEIGHTS = {
    title: 4,
    heading: 3,
    declared_identifier: 3,
    body: 1,
};
/** Keyphrases kept per artifact, highest weight first. Bounded so a pack stays bounded. */
exports.MAX_KEYPHRASES_PER_ARTIFACT = 24;
/** Shortest term that can be a keyphrase. Two-letter tokens carry no topic. */
exports.KEYPHRASE_MIN_TERM_LENGTH = 3;
/** Decimal places a reported weight is rounded to, so replays are byte-identical. */
const WEIGHT_PRECISION = 6;
/**
 * Closed stopword list: English function words only.
 *
 * Short on purpose. A long list tuned to a corpus encodes an unstated model of
 * what that corpus is about, and then the analysis is partly a description of the
 * list. These are words that would otherwise join every document to every other.
 */
exports.KEYPHRASE_STOPWORDS = [
    "a", "all", "also", "am", "an", "and", "any", "are", "as", "at", "be",
    "been", "being", "but", "by", "can", "could", "did", "do", "does", "doing",
    "done", "for", "from", "had", "has", "have", "having", "he", "her", "here",
    "hers", "him", "his", "how", "i", "if", "in", "into", "is", "it", "its", "just",
    "may", "me", "might", "more", "most", "must", "my", "no", "nor", "not", "now",
    "of", "off", "on", "once", "one", "only", "or", "other", "our", "out", "over",
    "own", "same", "shall", "she", "should", "so", "some", "such", "than", "that",
    "the", "their", "them", "then", "there", "these", "they", "this", "those",
    "through", "to", "too", "under", "until", "up", "us", "very", "was", "we",
    "were", "what", "when", "where", "which", "while", "who", "whom", "why",
    "will", "with", "would", "you", "your",
];
const STOPWORD_SET = new Set(exports.KEYPHRASE_STOPWORDS);
/** Suffixes that look plural and are not. */
const NON_PLURAL_SUFFIXES = ["ss", "us", "is", "as", "os"];
/**
 * Apply the versioned stemmer to one already-normalized token.
 *
 * Exported because the pair pass must stem the same way, and two implementations
 * of one rule is how the two sides quietly stop agreeing.
 */
function stemToken(token) {
    if (token.length <= 3 || !token.endsWith("s"))
        return token;
    for (const suffix of NON_PLURAL_SUFFIXES) {
        if (token.endsWith(suffix))
            return token;
    }
    return token.slice(0, -1);
}
/** Normalize, tokenize, drop stopwords and short tokens, then stem. */
function analysisTerms(text) {
    const out = [];
    for (const token of (0, corpus_analysis_1.analysisTokens)((0, corpus_analysis_1.normalizeForAnalysis)(text))) {
        if (token.length < exports.KEYPHRASE_MIN_TERM_LENGTH)
            continue;
        if (STOPWORD_SET.has(token))
            continue;
        const stemmed = stemToken(token);
        if (stemmed.length < exports.KEYPHRASE_MIN_TERM_LENGTH)
            continue;
        if (STOPWORD_SET.has(stemmed))
            continue;
        out.push(stemmed);
    }
    return out;
}
/** Identity of the keyphrase profile, binding every input that changes its output. */
function keyphraseProfileHash() {
    return (0, repository_model_1.stableId)("keyphrase-profile", {
        field_weights: exports.KEYPHRASE_FIELD_WEIGHTS,
        max_keyphrases_per_artifact: exports.MAX_KEYPHRASES_PER_ARTIFACT,
        min_term_length: exports.KEYPHRASE_MIN_TERM_LENGTH,
        profile_id: exports.KEYPHRASE_PROFILE_ID,
        profile_version: exports.KEYPHRASE_PROFILE_VERSION,
        stemming_profile: exports.KEYPHRASE_STEMMING_PROFILE,
        stopword_profile: exports.KEYPHRASE_STOPWORD_PROFILE,
        stopwords: [...exports.KEYPHRASE_STOPWORDS].sort(ordering_1.compareCodePoints),
        tokenizer_version: exports.KEYPHRASE_TOKENIZER_VERSION,
        weighting_algorithm: exports.KEYPHRASE_WEIGHTING_ALGORITHM,
    });
}
/** Package-manager manifests whose declared name is a publishable package name. */
const PACKAGE_MANIFESTS = new Set([
    "cargo.toml", "composer.json", "deno.json", "deno.jsonc", "package.json", "pyproject.toml",
]);
const TITLE_PREDICATE = "document.title";
const HEADING_PREDICATE = "document.heading";
const STATUS_PREDICATE = "work.status";
const KIND_PREDICATE = "work.kind";
const MILESTONE_PREDICATE = "work.milestone";
const OPEN_TASK_PREDICATE = "work.task.open";
const COMPLETED_TASK_PREDICATE = "work.task.completed";
const BLOCKED_PREDICATE = "work.blocked_by";
const DEPENDS_PREDICATE = "work.depends_on";
const REFERENCE_PREDICATE = "work.references";
const SUPERSESSION_PREDICATES = new Set(["work.supersedes", "work.superseded_by"]);
function sortedUnique(values) {
    return [...new Set(values)].sort(ordering_1.compareCodePoints);
}
/**
 * Normalize a reference target so two spellings of one path compare equal.
 *
 * A reference is written by a person: `./docs/a.md`, `docs/a.md` and `DOCS/A.MD`
 * all name one file. Leading `./`, a leading slash and case are removed; nothing
 * else is, because collapsing further would start merging genuinely different
 * targets.
 */
function normalizeReferenceTarget(target) {
    const trimmed = target.trim().replace(/\\/g, "/");
    const withoutPrefix = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
    return (0, corpus_analysis_1.normalizeForAnalysis)(withoutPrefix).trim();
}
/** Terms per field, plus which assertions each term came from. */
function collectFieldTerms(artifact) {
    const fields = { title: [], heading: [], declared_identifier: [], body: [] };
    const refsByTerm = new Map();
    const displayByTerm = new Map();
    const noteDisplay = (term, surface) => {
        const counts = displayByTerm.get(term) ?? new Map();
        counts.set(surface, (counts.get(surface) ?? 0) + 1);
        displayByTerm.set(term, counts);
    };
    const noteRef = (term, assertionId) => {
        const refs = refsByTerm.get(term) ?? new Set();
        refs.add(assertionId);
        refsByTerm.set(term, refs);
    };
    const ingest = (text, field, assertionId) => {
        const surfaces = (0, corpus_analysis_1.analysisTokens)((0, corpus_analysis_1.normalizeForAnalysis)(text));
        const terms = analysisTerms(text);
        for (const term of terms) {
            fields[field].push(term);
            if (assertionId !== null)
                noteRef(term, assertionId);
        }
        // Surface spellings are recorded from the same normalized token stream, so a
        // display term is always something that actually appeared in the document.
        for (const surface of surfaces) {
            const stemmed = stemToken(surface);
            if (terms.includes(stemmed))
                noteDisplay(stemmed, surface);
        }
    };
    for (const assertion of artifact.assertions ?? []) {
        if (assertion.predicate === TITLE_PREDICATE)
            ingest(assertion.object, "title", assertion.assertion_id);
        else if (assertion.predicate === HEADING_PREDICATE)
            ingest(assertion.object, "heading", assertion.assertion_id);
    }
    for (const declared of artifact.declared_identifiers ?? []) {
        ingest(declared.identifier, "declared_identifier", null);
    }
    if (artifact.body_text !== undefined)
        ingest(artifact.body_text, "body", null);
    for (const [rawTerm, count] of artifact.body_term_counts ?? []) {
        if (rawTerm.length < exports.KEYPHRASE_MIN_TERM_LENGTH || STOPWORD_SET.has(rawTerm))
            continue;
        const term = stemToken(rawTerm);
        if (term.length < exports.KEYPHRASE_MIN_TERM_LENGTH || STOPWORD_SET.has(term))
            continue;
        for (let i = 0; i < count; i += 1)
            fields.body.push(term);
        noteDisplay(term, rawTerm);
    }
    return { fields, refsByTerm, displayByTerm };
}
/** The strongest field a term appeared in, by weight. */
function strongestField(fields, term) {
    const order = ["title", "heading", "declared_identifier", "body"];
    for (const field of order) {
        if (fields[field].includes(term))
            return field;
    }
    return "body";
}
function prepare(artifact) {
    const { fields, refsByTerm, displayByTerm } = collectFieldTerms(artifact);
    const weightedCounts = new Map();
    for (const field of Object.keys(fields)) {
        const weight = exports.KEYPHRASE_FIELD_WEIGHTS[field];
        for (const term of fields[field]) {
            weightedCounts.set(term, (weightedCounts.get(term) ?? 0) + weight);
        }
    }
    return { input: artifact, fields, refsByTerm, displayByTerm, weightedCounts };
}
/** The surface spelling seen most often; ties break by code point. */
function displayTermFor(prepared, term) {
    const counts = prepared.displayByTerm.get(term);
    if (counts === undefined || counts.size === 0)
        return term;
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || (0, ordering_1.compareCodePoints)(a[0], b[0]))[0]?.[0] ?? term;
}
function keyphrasesFor(prepared, documentFrequency, documentCount) {
    const scored = [];
    for (const [term, weightedCount] of prepared.weightedCounts) {
        const df = documentFrequency.get(term) ?? 0;
        if (df === 0)
            continue;
        // Smoothed IDF. A term in every document scores 0 and drops out, which is the
        // whole point: corpus boilerplate is not what makes a document findable.
        const idf = Math.log((documentCount + 1) / (df + 1));
        if (idf <= 0)
            continue;
        const weight = Math.round(weightedCount * idf * 10 ** WEIGHT_PRECISION) / 10 ** WEIGHT_PRECISION;
        if (weight <= 0)
            continue;
        scored.push({
            normalized_term: term,
            display_term: displayTermFor(prepared, term),
            weight,
            evidence_source: strongestField(prepared.fields, term),
            source_block_refs: [...(prepared.refsByTerm.get(term) ?? [])].sort(ordering_1.compareCodePoints),
        });
    }
    scored.sort((a, b) => b.weight - a.weight || (0, ordering_1.compareCodePoints)(a.normalized_term, b.normalized_term));
    return scored.slice(0, exports.MAX_KEYPHRASES_PER_ARTIFACT);
}
function featureViewFor(prepared, keyphrases) {
    const artifact = prepared.input;
    const assertions = artifact.assertions ?? [];
    const declared = artifact.declared_identifiers ?? [];
    const byPredicate = (predicate) => assertions.filter((a) => a.predicate === predicate).map((a) => a.object);
    const taskTerms = new Set();
    for (const predicate of [OPEN_TASK_PREDICATE, COMPLETED_TASK_PREDICATE]) {
        for (const object of byPredicate(predicate)) {
            for (const term of analysisTerms(object))
                taskTerms.add(term);
        }
    }
    const milestoneTerms = new Set();
    for (const object of byPredicate(MILESTONE_PREDICATE)) {
        for (const term of analysisTerms(object))
            milestoneTerms.add(term);
    }
    return {
        artifact_id: artifact.artifact_id,
        root_id: artifact.root_id,
        corpus_path: artifact.corpus_path,
        root_relative_path: artifact.root_relative_path,
        content_hash: artifact.content_hash,
        normalized_document_id: artifact.normalized_document_id,
        normalized_title_tokens: sortedUnique(prepared.fields.title),
        normalized_heading_tokens: sortedUnique(prepared.fields.heading),
        keyphrases,
        normalized_reference_targets: sortedUnique(byPredicate(REFERENCE_PREDICATE).map(normalizeReferenceTarget).filter((t) => t.length > 0)),
        declared_project_identifiers: sortedUnique(declared.map((entry) => (0, corpus_analysis_1.normalizeForAnalysis)(entry.identifier).trim()).filter((v) => v.length > 0)),
        declared_package_names: sortedUnique(declared
            .filter((entry) => PACKAGE_MANIFESTS.has(entry.manifest.toLowerCase()))
            .map((entry) => (0, corpus_analysis_1.normalizeForAnalysis)(entry.identifier).trim())
            .filter((v) => v.length > 0)),
        declared_service_names: [],
        declared_dependencies: sortedUnique(byPredicate(DEPENDS_PREDICATE).map(normalizeReferenceTarget).filter((t) => t.length > 0)),
        statuses: sortedUnique(byPredicate(STATUS_PREDICATE).map((v) => (0, corpus_analysis_1.normalizeForAnalysis)(v).trim())),
        kinds: sortedUnique(byPredicate(KIND_PREDICATE).map((v) => (0, corpus_analysis_1.normalizeForAnalysis)(v).trim())),
        task_terms: [...taskTerms].sort(ordering_1.compareCodePoints),
        milestone_terms: [...milestoneTerms].sort(ordering_1.compareCodePoints),
        blockers: sortedUnique(byPredicate(BLOCKED_PREDICATE).map((v) => (0, corpus_analysis_1.normalizeForAnalysis)(v).trim())),
        supersession_declarations: assertions
            .filter((a) => SUPERSESSION_PREDICATES.has(a.predicate))
            .map((a) => ({
            predicate: a.predicate,
            object: normalizeReferenceTarget(a.object),
            assertion_id: a.assertion_id,
        }))
            .sort((a, b) => (0, ordering_1.compareCodePoints)(a.predicate, b.predicate)
            || (0, ordering_1.compareCodePoints)(a.object, b.object)
            || (0, ordering_1.compareCodePoints)(a.assertion_id, b.assertion_id)),
        archive_ancestry: [...(artifact.archive_ancestry ?? [])],
        is_archive_member: artifact.is_archive_member,
        exact_duplicate_cluster_id: artifact.exact_duplicate_cluster_id ?? null,
        near_duplicate_candidate_ids: [...(artifact.near_duplicate_candidate_ids ?? [])].sort(ordering_1.compareCodePoints),
        embedding_ref: artifact.embedding_ref ?? null,
    };
}
/**
 * Build every feature view in one pass.
 *
 * Corpus-wide, because inverse document frequency is a fact about the corpus: the
 * same document scored alone and scored among ten thousand others has different
 * keyphrases, and only the second is meaningful.
 */
function buildFeatureViews(artifacts) {
    const prepared = artifacts.map(prepare);
    const documentFrequency = new Map();
    for (const entry of prepared) {
        for (const term of entry.weightedCounts.keys()) {
            documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
        }
    }
    return prepared
        .map((entry) => featureViewFor(entry, keyphrasesFor(entry, documentFrequency, prepared.length)))
        .sort((a, b) => (0, ordering_1.compareCodePoints)(a.corpus_path, b.corpus_path)
        || (0, ordering_1.compareCodePoints)(a.artifact_id, b.artifact_id));
}
//# sourceMappingURL=corpus_semantics.js.map