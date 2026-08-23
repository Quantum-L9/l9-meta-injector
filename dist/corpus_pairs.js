"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIGNAL_FAMILY = exports.MAX_POSTINGS_FOR_PAIR_GENERATION = exports.ARCHIVE_CONTEXT_METHOD = exports.EXACT_DUPLICATE_METHOD_REF = exports.NEAR_DUPLICATE_METHOD_REF = exports.DEPENDENCY_OVERLAP_METHOD = exports.EXPLICIT_REFERENCE_METHOD = exports.DECLARED_IDENTIFIER_METHOD = exports.KEYPHRASE_OVERLAP_METHOD = exports.HEADING_OVERLAP_METHOD = exports.TITLE_OVERLAP_METHOD = exports.PAIR_SIGNAL_PROFILE_VERSION = exports.PAIR_SIGNAL_PROFILE_ID = void 0;
exports.pairSignalProfileHash = pairSignalProfileHash;
exports.buildReferenceIndex = buildReferenceIndex;
exports.resolveReference = resolveReference;
exports.buildSemanticPairs = buildSemanticPairs;
exports.referenceFixtureComparison = referenceFixtureComparison;
// corpus_pairs.ts — what two artifacts have in common, one signal at a time.
//
// The unit here is a pair and a list of independently-computed signals about it.
// Nothing in this module decides what a pair *means*: it measures title overlap,
// keyphrase overlap, whether one document explicitly names the other, whether two
// manifests declare the same identifier, and it stops. Fusion is a separate pass
// with a separate profile, because the measurement should stay stable when the
// policy for reading it changes.
//
// Two things dominate the design.
//
// The first is that all-pairs does not scale. Ten thousand artifacts is fifty
// million pairs, and almost all of them share nothing. So pairs are *generated*
// from inverted indexes — artifacts that share a keyphrase, a title token, a
// declared identifier, a reference, or a near-duplicate edge — and only generated
// pairs are scored. A pair no index proposes is not scored, and is therefore
// absent rather than zero. `referenceFixtureComparison` exists to prove the
// generated set matches the exhaustive set on a corpus small enough to compute
// both.
//
// The second is that a common term is a bad blocking key. A word in four thousand
// documents proposes eight million pairs on its own and discriminates nothing, so
// terms above a posting ceiling are skipped for *generation*. They still count
// toward a score once a pair exists on other grounds. The skip is reported rather
// than silent: a cap nobody can see reads as coverage nobody has.
const corpus_analysis_1 = require("./corpus_analysis");
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
exports.PAIR_SIGNAL_PROFILE_ID = "corpus-pair-signals/v1";
exports.PAIR_SIGNAL_PROFILE_VERSION = "1.0.0";
exports.TITLE_OVERLAP_METHOD = "title-token-jaccard/v1";
exports.HEADING_OVERLAP_METHOD = "heading-keyphrase-jaccard/v1";
exports.KEYPHRASE_OVERLAP_METHOD = "keyphrase-weighted-overlap/v1";
exports.DECLARED_IDENTIFIER_METHOD = "declared-identifier-match/v1";
exports.EXPLICIT_REFERENCE_METHOD = "explicit-reference/v1";
exports.DEPENDENCY_OVERLAP_METHOD = "dependency-overlap/v1";
exports.NEAR_DUPLICATE_METHOD_REF = "text-near-duplicate/v1";
exports.EXACT_DUPLICATE_METHOD_REF = "content-hash-equality/v1";
exports.ARCHIVE_CONTEXT_METHOD = "shared-archive-ancestry/v1";
/**
 * Documents a term may appear in and still be used to propose pairs.
 *
 * Above this it is corpus vocabulary rather than a shared subject, and using it
 * as a blocking key costs `n²/2` pairs to learn nothing. Chosen as a flat count
 * rather than a share of the corpus so that behaviour does not change underneath
 * an operator when the corpus grows.
 */
exports.MAX_POSTINGS_FOR_PAIR_GENERATION = 64;
/**
 * Separator joining two artifact ids into one map key.
 *
 * A NUL, because it is the one byte an artifact id cannot contain — the same
 * reason `corpus_candidates.ts` uses one for its container keys. A space would
 * work for today's `vsrc:<hex>` ids and would quietly stop working for an id
 * shape that allowed one.
 *
 * Named rather than written inline: a bare "\u0000" in a template literal is
 * invisible in a diff, and a source file containing raw NUL bytes is treated as
 * binary by grep and most review tools.
 */
const PAIR_KEY_SEPARATOR = "\u0000";
/** Decimal places every reported score is rounded to, so replays are byte-identical. */
const SCORE_PRECISION = 6;
function round(value) {
    return Math.round(value * 10 ** SCORE_PRECISION) / 10 ** SCORE_PRECISION;
}
exports.SIGNAL_FAMILY = {
    title_overlap: "lexical",
    heading_overlap: "lexical",
    keyphrase_overlap: "lexical",
    near_duplicate: "lexical",
    exact_duplicate: "lexical",
    declared_identifier_match: "declared_identity",
    explicit_reference: "graph",
    dependency_overlap: "graph",
    embedding_similarity: "semantic_model",
    archive_context: "context",
};
function pairSignalProfileHash() {
    return (0, repository_model_1.stableId)("pair-signal-profile", {
        archive_context_method: exports.ARCHIVE_CONTEXT_METHOD,
        declared_identifier_method: exports.DECLARED_IDENTIFIER_METHOD,
        dependency_overlap_method: exports.DEPENDENCY_OVERLAP_METHOD,
        exact_duplicate_method: exports.EXACT_DUPLICATE_METHOD_REF,
        explicit_reference_method: exports.EXPLICIT_REFERENCE_METHOD,
        heading_overlap_method: exports.HEADING_OVERLAP_METHOD,
        keyphrase_overlap_method: exports.KEYPHRASE_OVERLAP_METHOD,
        near_duplicate_method: exports.NEAR_DUPLICATE_METHOD_REF,
        posting_ceiling: exports.MAX_POSTINGS_FOR_PAIR_GENERATION,
        profile_id: exports.PAIR_SIGNAL_PROFILE_ID,
        profile_version: exports.PAIR_SIGNAL_PROFILE_VERSION,
        title_overlap_method: exports.TITLE_OVERLAP_METHOD,
    });
}
// ───────────────────────────── scoring primitives ─────────────────────────────
function jaccardOf(left, right) {
    if (left.length === 0 || right.length === 0)
        return { score: 0, shared: [] };
    const a = new Set(left);
    const b = new Set(right);
    const shared = [];
    for (const value of a) {
        if (b.has(value))
            shared.push(value);
    }
    const union = new Set([...a, ...b]).size;
    shared.sort(ordering_1.compareCodePoints);
    return { score: union === 0 ? 0 : round(shared.length / union), shared };
}
/**
 * Weighted keyphrase overlap.
 *
 * The shared terms are scored by the weight each document gave them, so two
 * documents that both consider a term central count for more than two that both
 * mention it in passing. Normalized by the total weight available on the lighter
 * side, which keeps a short document able to match a long one.
 */
function keyphraseOverlap(a, b) {
    const left = new Map(a.keyphrases.map((k) => [k.normalized_term, k.weight]));
    const right = new Map(b.keyphrases.map((k) => [k.normalized_term, k.weight]));
    if (left.size === 0 || right.size === 0)
        return { score: 0, shared: [] };
    let sharedWeight = 0;
    const shared = [];
    for (const [term, weight] of left) {
        const other = right.get(term);
        if (other === undefined)
            continue;
        sharedWeight += Math.min(weight, other);
        shared.push(term);
    }
    if (shared.length === 0)
        return { score: 0, shared: [] };
    const leftTotal = [...left.values()].reduce((sum, w) => sum + w, 0);
    const rightTotal = [...right.values()].reduce((sum, w) => sum + w, 0);
    const denominator = Math.min(leftTotal, rightTotal);
    shared.sort(ordering_1.compareCodePoints);
    return {
        score: denominator === 0 ? 0 : round(Math.min(1, sharedWeight / denominator)),
        shared,
    };
}
/** Shared enclosing archives, outermost first. */
function sharedAncestry(a, b) {
    const right = new Set(b.archive_ancestry);
    return a.archive_ancestry.filter((entry) => right.has(entry));
}
function buildReferenceIndex(views) {
    const byPath = new Map();
    const byBasename = new Map();
    for (const view of views) {
        const normalized = (0, corpus_analysis_1.normalizeForAnalysis)(view.root_relative_path).trim();
        const existing = byPath.get(normalized) ?? [];
        existing.push(view.artifact_id);
        byPath.set(normalized, existing);
        const basename = normalized.split("/").pop() ?? normalized;
        const byName = byBasename.get(basename) ?? [];
        byName.push(view.artifact_id);
        byBasename.set(basename, byName);
    }
    return { byPath, byBasename };
}
function resolveReference(index, target) {
    const exact = index.byPath.get(target);
    if (exact?.length === 1)
        return exact[0];
    // A path that resolves to several artifacts (the same relative path on two
    // roots) is not a reference to one of them.
    if (exact !== undefined)
        return null;
    const basename = target.split("/").pop() ?? target;
    const byName = index.byBasename.get(basename);
    if (byName?.length === 1)
        return byName[0];
    return null;
}
// ───────────────────────────── candidate generation ─────────────────────────────
function addPosting(index, key, artifactId) {
    const existing = index.get(key) ?? [];
    existing.push(artifactId);
    index.set(key, existing);
}
function pairsFromIndex(index, out, ceiling) {
    let skipped = 0;
    for (const postings of index.values()) {
        if (postings.length < 2)
            continue;
        if (postings.length > ceiling) {
            skipped += 1;
            continue;
        }
        const ordered = [...postings].sort(ordering_1.compareCodePoints);
        for (let i = 0; i < ordered.length; i += 1) {
            for (let j = i + 1; j < ordered.length; j += 1) {
                const [a, b] = (0, ordering_1.canonicalPair)(ordered[i], ordered[j]);
                out.add(`${a}${PAIR_KEY_SEPARATOR}${b}`);
            }
        }
    }
    return skipped;
}
/**
 * Score one pair.
 *
 * Extracted from `buildSemanticPairs` so that the loop reads as "generate, score,
 * identify, emit" rather than as one long function whose shape hides where a
 * signal is decided. Every branch is independent of every other: a signal that
 * does not fire is absent, never zero.
 */
function scorePair(a, b, context) {
    const { key, referenceIndex, nearByPair, embeddingByPair } = context;
    const signals = [];
    const evidenceRefs = new Set();
    const title = jaccardOf(a.normalized_title_tokens, b.normalized_title_tokens);
    if (title.score > 0) {
        signals.push({
            kind: "title_overlap", method: exports.TITLE_OVERLAP_METHOD, score: title.score,
            categorical: false, fact: false, detail: title.shared,
        });
    }
    const heading = jaccardOf(a.normalized_heading_tokens, b.normalized_heading_tokens);
    if (heading.score > 0) {
        signals.push({
            kind: "heading_overlap", method: exports.HEADING_OVERLAP_METHOD, score: heading.score,
            categorical: false, fact: false, detail: heading.shared,
        });
    }
    const keyphrase = keyphraseOverlap(a, b);
    if (keyphrase.score > 0) {
        signals.push({
            kind: "keyphrase_overlap", method: exports.KEYPHRASE_OVERLAP_METHOD, score: keyphrase.score,
            categorical: false, fact: false, detail: keyphrase.shared,
        });
    }
    const identifiers = jaccardOf(a.declared_project_identifiers, b.declared_project_identifiers);
    if (identifiers.shared.length > 0) {
        signals.push({
            kind: "declared_identifier_match", method: exports.DECLARED_IDENTIFIER_METHOD, score: 1,
            categorical: true, fact: false, detail: identifiers.shared,
        });
    }
    const referenceDetail = [];
    for (const [from, to] of [[a, b], [b, a]]) {
        for (const target of from.normalized_reference_targets) {
            if (resolveReference(referenceIndex, target) === to.artifact_id) {
                referenceDetail.push(`${from.artifact_id} references ${target}`);
            }
        }
        // A declared dependency that resolves to another artifact is a graph edge
        // in exactly the way a reference is: the document named the other one. It
        // is kept separate from `dependency_overlap`, which is the different fact
        // that two documents depend on the same third thing.
        for (const target of from.declared_dependencies) {
            if (resolveReference(referenceIndex, target) === to.artifact_id) {
                referenceDetail.push(`${from.artifact_id} depends on ${target}`);
            }
        }
        for (const declaration of from.supersession_declarations) {
            if (resolveReference(referenceIndex, declaration.object) === to.artifact_id) {
                referenceDetail.push(`${from.artifact_id} ${declaration.predicate} ${declaration.object}`);
                evidenceRefs.add(declaration.assertion_id);
            }
        }
    }
    if (referenceDetail.length > 0) {
        referenceDetail.sort(ordering_1.compareCodePoints);
        signals.push({
            kind: "explicit_reference", method: exports.EXPLICIT_REFERENCE_METHOD, score: 1,
            categorical: true, fact: false, detail: referenceDetail,
        });
    }
    const dependencies = jaccardOf(a.declared_dependencies, b.declared_dependencies);
    if (dependencies.score > 0) {
        signals.push({
            kind: "dependency_overlap", method: exports.DEPENDENCY_OVERLAP_METHOD, score: dependencies.score,
            categorical: false, fact: false, detail: dependencies.shared,
        });
    }
    const nearScore = nearByPair.get(key);
    if (nearScore !== undefined) {
        signals.push({
            kind: "near_duplicate", method: exports.NEAR_DUPLICATE_METHOD_REF, score: round(nearScore),
            categorical: false, fact: false, detail: [],
        });
    }
    const isExactDuplicate = a.exact_duplicate_cluster_id !== null
        && a.exact_duplicate_cluster_id === b.exact_duplicate_cluster_id;
    if (isExactDuplicate) {
        signals.push({
            kind: "exact_duplicate", method: exports.EXACT_DUPLICATE_METHOD_REF, score: 1,
            categorical: true, fact: true, detail: [a.exact_duplicate_cluster_id],
        });
    }
    const embeddingScore = embeddingByPair.get(key);
    if (embeddingScore !== undefined) {
        signals.push({
            kind: "embedding_similarity", method: "cosine/v1", score: round(embeddingScore),
            categorical: false, fact: false, detail: [],
        });
    }
    const ancestry = sharedAncestry(a, b);
    if (ancestry.length > 0) {
        signals.push({
            kind: "archive_context", method: exports.ARCHIVE_CONTEXT_METHOD, score: 1,
            categorical: true, fact: false, detail: ancestry,
        });
    }
    return { signals, evidenceRefs };
}
/**
 * Score every pair some index proposes.
 *
 * Ordering is by pair id so the output is stable; scoring is independent per
 * pair, so the generated set decides coverage and nothing else does.
 */
function buildSemanticPairs(input) {
    const views = [...input.views].sort((a, b) => (0, ordering_1.compareCodePoints)(a.artifact_id, b.artifact_id));
    const byId = new Map(views.map((view) => [view.artifact_id, view]));
    const profileHash = pairSignalProfileHash();
    const diagnostics = [];
    const keyphraseIndex = new Map();
    const titleIndex = new Map();
    const identifierIndex = new Map();
    const duplicateIndex = new Map();
    for (const view of views) {
        for (const keyphrase of view.keyphrases)
            addPosting(keyphraseIndex, keyphrase.normalized_term, view.artifact_id);
        for (const token of view.normalized_title_tokens)
            addPosting(titleIndex, token, view.artifact_id);
        for (const identifier of view.declared_project_identifiers)
            addPosting(identifierIndex, identifier, view.artifact_id);
        if (view.exact_duplicate_cluster_id !== null) {
            addPosting(duplicateIndex, view.exact_duplicate_cluster_id, view.artifact_id);
        }
    }
    const generated = new Set();
    let skippedTerms = 0;
    if (input.exhaustive === true) {
        for (let i = 0; i < views.length; i += 1) {
            for (let j = i + 1; j < views.length; j += 1) {
                const [a, b] = (0, ordering_1.canonicalPair)(views[i].artifact_id, views[j].artifact_id);
                generated.add(`${a}${PAIR_KEY_SEPARATOR}${b}`);
            }
        }
    }
    else {
        skippedTerms += pairsFromIndex(keyphraseIndex, generated, exports.MAX_POSTINGS_FOR_PAIR_GENERATION);
        skippedTerms += pairsFromIndex(titleIndex, generated, exports.MAX_POSTINGS_FOR_PAIR_GENERATION);
        // Declared identifiers and duplicate clusters are identity, not vocabulary:
        // no ceiling applies, because a large cluster is exactly the case that matters.
        pairsFromIndex(identifierIndex, generated, Number.MAX_SAFE_INTEGER);
        pairsFromIndex(duplicateIndex, generated, Number.MAX_SAFE_INTEGER);
        const referenceIndex = buildReferenceIndex(views);
        for (const view of views) {
            const targets = [...view.normalized_reference_targets, ...view.declared_dependencies];
            for (const target of targets) {
                const resolved = resolveReference(referenceIndex, target);
                if (resolved === null || resolved === view.artifact_id)
                    continue;
                const [a, b] = (0, ordering_1.canonicalPair)(view.artifact_id, resolved);
                generated.add(`${a}${PAIR_KEY_SEPARATOR}${b}`);
            }
            for (const declaration of view.supersession_declarations) {
                const resolved = resolveReference(referenceIndex, declaration.object);
                if (resolved === null || resolved === view.artifact_id)
                    continue;
                const [a, b] = (0, ordering_1.canonicalPair)(view.artifact_id, resolved);
                generated.add(`${a}${PAIR_KEY_SEPARATOR}${b}`);
            }
        }
        for (const near of input.nearDuplicatePairs ?? []) {
            const [a, b] = (0, ordering_1.canonicalPair)(near.artifact_a_id, near.artifact_b_id);
            generated.add(`${a}${PAIR_KEY_SEPARATOR}${b}`);
        }
        for (const embedding of input.embeddingPairs ?? []) {
            const [a, b] = (0, ordering_1.canonicalPair)(embedding.artifact_a_id, embedding.artifact_b_id);
            generated.add(`${a}${PAIR_KEY_SEPARATOR}${b}`);
        }
    }
    if (skippedTerms > 0) {
        diagnostics.push({
            code: "corpus.pair_generation.high_frequency_terms_skipped",
            severity: "info",
            message: `${skippedTerms} term(s) appear in more than ${exports.MAX_POSTINGS_FOR_PAIR_GENERATION} documents and `
                + "were not used to propose pairs; they still contribute to the score of pairs proposed on "
                + "other grounds",
        });
    }
    const nearByPair = new Map();
    for (const near of input.nearDuplicatePairs ?? []) {
        const [a, b] = (0, ordering_1.canonicalPair)(near.artifact_a_id, near.artifact_b_id);
        nearByPair.set(`${a}${PAIR_KEY_SEPARATOR}${b}`, near.score);
    }
    const embeddingByPair = new Map();
    for (const embedding of input.embeddingPairs ?? []) {
        const [a, b] = (0, ordering_1.canonicalPair)(embedding.artifact_a_id, embedding.artifact_b_id);
        embeddingByPair.set(`${a}${PAIR_KEY_SEPARATOR}${b}`, embedding.score);
    }
    const referenceIndex = buildReferenceIndex(views);
    const pairs = [];
    for (const key of generated) {
        const [aId, bId] = key.split(PAIR_KEY_SEPARATOR);
        const a = byId.get(aId);
        const b = byId.get(bId);
        if (a === undefined || b === undefined)
            continue;
        const scored = scorePair(a, b, { key, referenceIndex, nearByPair, embeddingByPair });
        const signals = scored.signals;
        const evidenceRefs = scored.evidenceRefs;
        if (signals.length === 0)
            continue;
        // Ordered before the identity is computed, not after.
        //
        // These are pushed in whatever order the checks above happen to run, which is
        // an artefact of how this function is written rather than a fact about the
        // pair. Hashing that order would make every pair id in every corpus depend on
        // the source-code order of the pushes — so reordering two blocks here, a pure
        // refactor, would silently invalidate every previously emitted id.
        const orderedSignals = [...signals].sort((x, y) => (0, ordering_1.compareCodePoints)(x.kind, y.kind));
        // Only signals that fired contribute to identity, so a pair's id does not
        // change when an unrelated signal is added to a later version of this module.
        const featureIdentities = [
            a.normalized_document_id ?? a.content_hash ?? aId,
            b.normalized_document_id ?? b.content_hash ?? bId,
        ].sort(ordering_1.compareCodePoints);
        const pairId = (0, repository_model_1.stableId)("semantic-pair", {
            artifact_a_id: aId,
            artifact_b_id: bId,
            feature_identities: featureIdentities,
            pair_signal_profile_hash: profileHash,
            // Scores are fixed-precision strings here, never floats: the canonical
            // hasher refuses non-integer numbers precisely because float repr differs
            // between runtimes, and an identity that did that would not be stable.
            signals: orderedSignals.map((signal) => ({
                kind: signal.kind,
                score: signal.score.toFixed(6),
            })),
        });
        pairs.push({
            pair_id: pairId,
            artifact_a_id: aId,
            artifact_b_id: bId,
            signals: orderedSignals,
            evidence_refs: [...evidenceRefs].sort(ordering_1.compareCodePoints),
            analysis_profile: {
                pair_signal_profile_id: exports.PAIR_SIGNAL_PROFILE_ID,
                pair_signal_profile_version: exports.PAIR_SIGNAL_PROFILE_VERSION,
                pair_signal_profile_hash: profileHash,
            },
        });
    }
    pairs.sort((x, y) => (0, ordering_1.compareCodePoints)(x.artifact_a_id, y.artifact_a_id)
        || (0, ordering_1.compareCodePoints)(x.artifact_b_id, y.artifact_b_id));
    return {
        pairs,
        diagnostics,
        generation: {
            artifact_count: views.length,
            generated_pair_count: generated.size,
            scored_pair_count: pairs.length,
            exhaustive_pair_count: (views.length * (views.length - 1)) / 2,
            skipped_high_frequency_terms: skippedTerms,
            posting_ceiling: exports.MAX_POSTINGS_FOR_PAIR_GENERATION,
        },
    };
}
/**
 * Compare index-generated pairs against exhaustive scoring on the same input.
 *
 * The scalability claim is that blocking loses nothing that matters. That is a
 * claim about a specific corpus, so it is checked rather than argued: score every
 * pair both ways and report which scored pairs the generated set missed.
 */
function referenceFixtureComparison(input) {
    const blocked = buildSemanticPairs({ ...input, exhaustive: false });
    const full = buildSemanticPairs({ ...input, exhaustive: true });
    const seen = new Set(blocked.pairs.map((pair) => `${pair.artifact_a_id}${PAIR_KEY_SEPARATOR}${pair.artifact_b_id}`));
    const missed = full.pairs
        .filter((pair) => !seen.has(`${pair.artifact_a_id}${PAIR_KEY_SEPARATOR}${pair.artifact_b_id}`))
        .map((pair) => pair.pair_id)
        .sort(ordering_1.compareCodePoints);
    return { generated: blocked.pairs.length, exhaustive: full.pairs.length, missedPairIds: missed };
}
//# sourceMappingURL=corpus_pairs.js.map