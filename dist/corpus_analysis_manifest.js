"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ANALYSIS_MANIFEST_VERSION = exports.CANDIDATE_KINDS = void 0;
exports.buildAnalysisManifest = buildAnalysisManifest;
exports.diffAnalysisManifests = diffAnalysisManifests;
// corpus_analysis_manifest.ts — what a run concluded, in a form a later run can diff.
//
// A snapshot records what was on the disks. Two snapshots therefore answer "did
// the bytes change" and cannot answer "did the conclusions change", and the diff
// used to report that gap as `candidate_added: 0` — a number that was never
// computed, printed in a field a reader takes as a measurement. Three zeros
// beside `comparable: false` read as "nothing changed" to everyone who does not
// read the flag first, which is a fake-completion surface in exactly the way a
// missing field is not.
//
// So a run now writes down its candidates: an id, a kind, and a hash over the
// part of the candidate that carries meaning. Two runs' manifests diff exactly:
//
//   - in the later manifest and not the earlier → added
//   - in the earlier and not the later          → removed
//   - in both with different payload hashes     → changed
//
// A snapshot written before this existed has no manifest, and the diff reports
// `null` for all three. Null is a different claim from zero and is the true one:
// there is nothing to compare, rather than nothing that changed.
//
// The payload hash deliberately excludes ordering-only and path-only detail.
// A candidate whose members moved on disk but which still names the same
// documents is the same candidate; a candidate that gained a member is not. That
// is the line a reader means by "changed", and hashing the rendered candidate
// wholesale would cross it every time a path was tidied.
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
exports.CANDIDATE_KINDS = [
    "exact_duplicate_cluster",
    "near_duplicate",
    "topic",
    "project",
];
exports.ANALYSIS_MANIFEST_VERSION = "1.0.0";
/**
 * Hash one candidate's meaning.
 *
 * `stableId` refuses non-integer numbers, which is why a score is carried as its
 * six-place decimal string rather than as a float: the precision the report
 * shows is the precision the diff compares, and a run that reported 0.871 twice
 * cannot be called changed because the seventh place moved.
 */
function payloadHash(kind, payload) {
    return (0, repository_model_1.stableId)(`candidate-payload:${kind}`, payload);
}
/** Build the manifest a run writes into its snapshot. */
function buildAnalysisManifest(input) {
    const entries = [];
    for (const cluster of input.exactDuplicateClusters) {
        entries.push({
            candidate_id: cluster.cluster_id,
            candidate_kind: "exact_duplicate_cluster",
            semantic_payload_hash: payloadHash("exact_duplicate_cluster", {
                content_hash: cluster.content_hash,
                member_ids: [...cluster.artifact_ids].sort(ordering_1.compareCodePoints),
            }),
        });
    }
    for (const candidate of input.nearDuplicates) {
        entries.push({
            candidate_id: candidate.candidate_id,
            candidate_kind: "near_duplicate",
            semantic_payload_hash: payloadHash("near_duplicate", {
                member_ids: [candidate.artifact_a_id, candidate.artifact_b_id].sort(ordering_1.compareCodePoints),
                score: candidate.score.toFixed(6),
            }),
        });
    }
    for (const candidate of input.topics) {
        entries.push({
            candidate_id: candidate.candidate_id,
            candidate_kind: "topic",
            semantic_payload_hash: payloadHash("topic", {
                member_ids: [...candidate.member_ids].sort(ordering_1.compareCodePoints),
                shared_terms: [...candidate.shared_terms].sort(ordering_1.compareCodePoints),
            }),
        });
    }
    for (const candidate of input.projects) {
        entries.push({
            candidate_id: candidate.candidate_id,
            candidate_kind: "project",
            semantic_payload_hash: payloadHash("project", {
                identifier_is_declared: candidate.identifier_is_declared,
                member_ids: [...candidate.member_ids].sort(ordering_1.compareCodePoints),
                project_key: candidate.project_key,
            }),
        });
    }
    entries.sort((a, b) => (0, ordering_1.compareCodePoints)(a.candidate_kind, b.candidate_kind)
        || (0, ordering_1.compareCodePoints)(a.candidate_id, b.candidate_id));
    const counts = Object.fromEntries(exports.CANDIDATE_KINDS.map((kind) => [kind, entries.filter((e) => e.candidate_kind === kind).length]));
    return { manifest_version: exports.ANALYSIS_MANIFEST_VERSION, entries, counts };
}
/**
 * Diff two analysis manifests.
 *
 * Missing on either side is `null` with a reason, never zero: a run that cannot
 * compare has not found that nothing changed.
 */
function diffAnalysisManifests(previous, current) {
    const absent = (reason) => ({
        candidate_added: null,
        candidate_removed: null,
        candidate_changed: null,
        candidate_unchanged: null,
        not_computed_reason: reason,
        by_kind: [],
    });
    if (previous === null || previous === undefined) {
        return absent(current === null || current === undefined
            ? "neither snapshot carries an analysis manifest"
            : "the previous snapshot predates the analysis manifest, so its candidates are unknown");
    }
    if (current === null || current === undefined) {
        return absent("this run produced no analysis manifest, so there is nothing to compare against");
    }
    if (previous.manifest_version !== current.manifest_version) {
        // Two payload definitions are two different questions. Comparing hashes
        // across them would report every candidate as changed, which is worse than
        // saying the comparison is not available.
        return absent(`manifest versions differ (${previous.manifest_version} vs ${current.manifest_version}); `
            + "payload hashes from different definitions are not comparable");
    }
    const before = new Map(previous.entries.map((entry) => [entry.candidate_id, entry]));
    const after = new Map(current.entries.map((entry) => [entry.candidate_id, entry]));
    const perKind = new Map();
    const bump = (kind, field) => {
        const tally = perKind.get(kind) ?? { added: 0, removed: 0, changed: 0, unchanged: 0 };
        tally[field] += 1;
        perKind.set(kind, tally);
    };
    let added = 0;
    let removed = 0;
    let changed = 0;
    let unchanged = 0;
    for (const [id, entry] of after) {
        const previousEntry = before.get(id);
        if (previousEntry === undefined) {
            added += 1;
            bump(entry.candidate_kind, "added");
            continue;
        }
        if (previousEntry.semantic_payload_hash === entry.semantic_payload_hash) {
            unchanged += 1;
            bump(entry.candidate_kind, "unchanged");
            continue;
        }
        changed += 1;
        bump(entry.candidate_kind, "changed");
    }
    for (const [id, entry] of before) {
        if (after.has(id))
            continue;
        removed += 1;
        bump(entry.candidate_kind, "removed");
    }
    return {
        candidate_added: added,
        candidate_removed: removed,
        candidate_changed: changed,
        candidate_unchanged: unchanged,
        not_computed_reason: null,
        by_kind: [...perKind.entries()]
            .map(([candidate_kind, tally]) => ({ candidate_kind, ...tally }))
            .sort((a, b) => (0, ordering_1.compareCodePoints)(a.candidate_kind, b.candidate_kind)),
    };
}
//# sourceMappingURL=corpus_analysis_manifest.js.map