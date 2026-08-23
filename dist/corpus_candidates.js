"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DECLARED_IDENTIFIER_MANIFESTS = exports.TOPIC_STOPWORDS = exports.TOPIC_MIN_TERM_LENGTH = exports.TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS = exports.TOPIC_DOCUMENT_FREQUENCY_CEILING = exports.TOPIC_SALIENT_TERMS = exports.TOPIC_MIN_TOKENS = exports.DEFAULT_TOPIC_THRESHOLD = exports.TOPIC_CANDIDATE_METHOD_VERSION = exports.TOPIC_CANDIDATE_METHOD = exports.PROJECT_CANDIDATE_METHOD_VERSION = exports.PROJECT_CANDIDATE_METHOD = void 0;
exports.containerOf = containerOf;
exports.projectContainerForMarker = projectContainerForMarker;
exports.isUnderContainer = isUnderContainer;
exports.buildProjectCandidates = buildProjectCandidates;
exports.readsDeclaredIdentifier = readsDeclaredIdentifier;
exports.readDeclaredIdentifier = readDeclaredIdentifier;
exports.salientTerms = salientTerms;
exports.topicPrefixLength = topicPrefixLength;
exports.buildTopicCandidates = buildTopicCandidates;
exports.buildTopicCandidatesExhaustive = buildTopicCandidatesExhaustive;
exports.candidateProfileHash = candidateProfileHash;
// corpus_candidates.ts — the two groupings a corpus supports, both as candidates.
//
// A folder of twenty years of work has structure in it, and the structure is not
// the folder tree. The same project is on three disks under three names; the same
// subject is spread across a hundred notes filed by date. Two deterministic
// groupings recover some of that, and both are labelled candidates because
// neither is decidable:
//
//   PROJECT_CANDIDATE   a container holding an explicit project marker — a build
//                       manifest or a CI definition — with its members. Containers
//                       sharing a declared identifier join across roots and disks.
//
//   TOPIC_CANDIDATE     a connected group of documents whose salient vocabulary
//                       overlaps. Lexical, like the near-duplicate pass, and just
//                       as carefully not a claim about meaning.
//
// Neither grouping ranks, names, merges, moves or recommends anything, and neither
// calls a model. A project candidate is a container that carries a marker; a topic
// candidate is a set of documents that share words. What either one is *for* is
// somebody else's decision.
const ordering_1 = require("./ordering");
const repository_model_1 = require("./repository_model");
exports.PROJECT_CANDIDATE_METHOD = "container-project-candidate/v1";
exports.PROJECT_CANDIDATE_METHOD_VERSION = "1.0.0";
exports.TOPIC_CANDIDATE_METHOD = "lexical-topic-candidate/v1";
// Bumped when the pass moved from an index over every salient term to one over
// each document's rarest-first prefix. The bound is exact, so the candidates are
// the same ones; the method that found them is not, and an analysis identity that
// did not move would claim two different algorithms were one.
exports.TOPIC_CANDIDATE_METHOD_VERSION = "1.1.0";
/** Default salient-vocabulary overlap at which two documents join a topic. */
exports.DEFAULT_TOPIC_THRESHOLD = 0.35;
/** Documents shorter than this are not scored; short text overlaps by accident. */
exports.TOPIC_MIN_TOKENS = 20;
/** Salient terms kept per document, by frequency then code point. */
exports.TOPIC_SALIENT_TERMS = 40;
/** A term in more than this share of eligible documents is corpus boilerplate. */
exports.TOPIC_DOCUMENT_FREQUENCY_CEILING = 0.8;
/**
 * Corpus size below which no term is treated as boilerplate.
 *
 * "This term is in most of the corpus" is only a statement about vocabulary once
 * the corpus is big enough for *most* to mean something. Applying the ceiling to
 * four documents would strip the very terms that make two of them a topic.
 */
exports.TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS = 5;
/** Shortest term considered salient. */
exports.TOPIC_MIN_TERM_LENGTH = 3;
/**
 * Closed stopword list.
 *
 * Deliberately small and English-only. A large list tuned per corpus would make
 * the analysis depend on an unstated model of the language being analyzed; a
 * short list of function words removes the terms that would otherwise join every
 * document to every other one.
 */
exports.TOPIC_STOPWORDS = [
    "about", "after", "again", "all", "also", "and", "any", "are", "because", "been",
    "before", "being", "between", "both", "but", "can", "could", "did", "does", "doing",
    "done", "down", "each", "even", "every", "for", "from", "further", "had", "has",
    "have", "here", "how", "into", "its", "itself", "just", "may", "more", "most",
    "much", "must", "not", "now", "off", "once", "one", "only", "other", "our", "out",
    "over", "own", "same", "she", "should", "since", "some", "such", "than", "that",
    "the", "their", "them", "then", "there", "these", "they", "this", "those",
    "through", "too", "under", "until", "use", "used", "very", "was", "way", "were",
    "what", "when", "where", "which", "while", "who", "why", "will", "with", "would",
    "you", "your",
];
const STOPWORDS = new Set(exports.TOPIC_STOPWORDS);
/** Directory half of a root-relative path, honouring archive locators. */
function containerOf(rootRelativePath) {
    const slash = rootRelativePath.lastIndexOf("/");
    if (slash < 0)
        return "";
    // `a.zip!/x.md` has its member at the archive root; the container is the archive.
    if (rootRelativePath.endsWith("/") || slash === 0)
        return rootRelativePath.slice(0, slash);
    const head = rootRelativePath.slice(0, slash);
    return head.endsWith("!") ? `${head}/` : head;
}
/**
 * The project container a marker implies.
 *
 * A build manifest sits in its project's directory. A CI definition sits two
 * levels below it, in `.github/workflows/` or `.circleci/`, so the container is
 * the directory holding that dot-directory rather than the dot-directory itself.
 */
function projectContainerForMarker(rootRelativePath) {
    const container = containerOf(rootRelativePath);
    const segments = container.split("/");
    for (let index = segments.length - 1; index >= 0; index--) {
        if (segments[index] === ".github" || segments[index] === ".circleci") {
            return segments.slice(0, index).join("/");
        }
    }
    return container;
}
/**
 * Last path segment of a container, used as a fallback grouping key.
 *
 * The trailing separators are trimmed by scanning rather than by `/[!/]+$/`.
 * That pattern backtracks quadratically on a path that is mostly separators, and
 * these paths come out of archive member names this package does not control —
 * so a super-linear pattern here is a denial of service rather than a style
 * question.
 */
function containerName(containerPath) {
    let end = containerPath.length;
    while (end > 0 && (containerPath[end - 1] === "!" || containerPath[end - 1] === "/"))
        end--;
    const cleaned = containerPath.slice(0, end);
    const slash = cleaned.lastIndexOf("/");
    return slash < 0 ? cleaned : cleaned.slice(slash + 1);
}
/** True when `candidate` is `container` itself or lies beneath it. */
function isUnderContainer(containerPath, candidate) {
    if (containerPath === "")
        return true;
    if (candidate === containerPath)
        return true;
    const prefix = containerPath.endsWith("/") ? containerPath : `${containerPath}/`;
    return candidate.startsWith(prefix);
}
/**
 * The key containers are grouped under, and the whole of that rule.
 *
 * A declared identifier joins containers across roots and disks. A container with
 * no declared name can only join others of the same directory name. A root-level
 * container with no declared name joins nothing at all, because the only name it
 * has left is its root, and a root is not a project.
 */
function projectGroupKey(input) {
    if (input.declared !== undefined)
        return `project:${input.declared}`;
    if (input.containerName.length > 0)
        return `container:${input.containerName}`;
    return `container:${input.rootLabel}`;
}
/**
 * Group markers into containers, containers into project candidates, and assign
 * every artifact to the innermost container that claims it.
 *
 * The innermost rule is what keeps a monorepo from swallowing its own packages:
 * `repo/package.json` and `repo/packages/api/package.json` are two containers, and
 * a file under `packages/api` belongs to the inner one alone.
 */
function buildProjectCandidates(input) {
    const containers = new Map();
    for (const marker of input.markers) {
        const containerPath = projectContainerForMarker(marker.root_relative_path);
        const slot = `${marker.root_id} ${containerPath}`;
        const existing = containers.get(slot) ?? {
            root_id: marker.root_id,
            container_path: containerPath,
            corpus_container_path: marker.corpus_path.slice(0, marker.corpus_path.length - marker.root_relative_path.length) + containerPath,
            marker_ids: [],
            marker_kinds: [],
            declared_identifiers: [],
        };
        existing.marker_ids.push(marker.virtual_source_id);
        if (!existing.marker_kinds.includes(marker.marker_kind)) {
            existing.marker_kinds.push(marker.marker_kind);
        }
        if (marker.declared_identifier !== undefined
            && !existing.declared_identifiers.includes(marker.declared_identifier)) {
            existing.declared_identifiers.push(marker.declared_identifier);
        }
        containers.set(slot, existing);
    }
    // Assignment: longest container path wins, so a nested project keeps its files.
    const byRoot = new Map();
    for (const container of containers.values()) {
        const bucket = byRoot.get(container.root_id);
        if (bucket === undefined)
            byRoot.set(container.root_id, [container]);
        else
            bucket.push(container);
    }
    for (const bucket of byRoot.values()) {
        bucket.sort((a, b) => b.container_path.length - a.container_path.length
            || (0, ordering_1.compareCodePoints)(a.container_path, b.container_path));
    }
    const assignment = new Map();
    for (const member of input.members) {
        const bucket = byRoot.get(member.root_id);
        if (bucket === undefined)
            continue;
        const owner = bucket.find((container) => isUnderContainer(container.container_path, member.root_relative_path));
        if (owner === undefined)
            continue;
        const slot = `${owner.root_id} ${owner.container_path}`;
        const members = assignment.get(slot);
        if (members === undefined)
            assignment.set(slot, [member.virtual_source_id]);
        else
            members.push(member.virtual_source_id);
    }
    // Grouping: a declared identifier joins containers across roots and disks; a
    // container with no declared name can only join others of the same directory
    // name, and a root-level container with no name joins nothing at all.
    const grouped = new Map();
    for (const container of containers.values()) {
        const sortedIdentifiers = [...container.declared_identifiers].sort(ordering_1.compareCodePoints);
        const declared = sortedIdentifiers[0];
        const key = projectGroupKey({
            declared,
            containerName: containerName(container.container_path),
            rootLabel: input.rootLabels.get(container.root_id) ?? container.root_id,
        });
        const group = grouped.get(key) ?? { declared: declared !== undefined, containers: [] };
        group.declared = group.declared || declared !== undefined;
        group.containers.push(container);
        grouped.set(key, group);
    }
    const candidates = [];
    for (const [projectKey, group] of grouped) {
        const orderedContainers = [...group.containers].sort((a, b) => (0, ordering_1.compareCodePoints)(a.corpus_container_path, b.corpus_container_path));
        const memberIds = new Set();
        for (const container of orderedContainers) {
            for (const id of assignment.get(`${container.root_id} ${container.container_path}`) ?? []) {
                memberIds.add(id);
            }
            container.marker_ids.sort(ordering_1.compareCodePoints);
            container.marker_kinds.sort(ordering_1.compareCodePoints);
            container.declared_identifiers.sort(ordering_1.compareCodePoints);
        }
        const rootIds = [...new Set(orderedContainers.map((container) => container.root_id))]
            .sort(ordering_1.compareCodePoints);
        candidates.push({
            candidate_id: (0, repository_model_1.stableId)("project-candidate", {
                algorithm_id: exports.PROJECT_CANDIDATE_METHOD,
                algorithm_version: exports.PROJECT_CANDIDATE_METHOD_VERSION,
                project_key: projectKey,
            }),
            method: exports.PROJECT_CANDIDATE_METHOD,
            algorithm_version: exports.PROJECT_CANDIDATE_METHOD_VERSION,
            project_key: projectKey,
            identifier_is_declared: group.declared,
            containers: orderedContainers,
            root_ids: rootIds,
            member_ids: [...memberIds].sort(ordering_1.compareCodePoints),
            member_count: memberIds.size,
            spans_roots: rootIds.length > 1,
        });
    }
    return candidates.sort((a, b) => (0, ordering_1.compareCodePoints)(a.project_key, b.project_key));
}
/** Manifest basenames whose body this module knows how to read a name out of. */
exports.DECLARED_IDENTIFIER_MANIFESTS = [
    "cargo.toml", "composer.json", "deno.json", "deno.jsonc", "go.mod", "package.json",
    "pom.xml", "pyproject.toml",
];
/** True when `readDeclaredIdentifier` claims this basename. */
function readsDeclaredIdentifier(basename) {
    return exports.DECLARED_IDENTIFIER_MANIFESTS.includes(basename.toLowerCase());
}
const JSON_NAME_FIELDS = {
    "package.json": "name",
    "composer.json": "name",
    "deno.json": "name",
    "deno.jsonc": "name",
};
const TOML_NAME_SECTIONS = {
    "cargo.toml": ["package"],
    "pyproject.toml": ["project", "tool.poetry"],
};
/** 1-based line of the first occurrence of a pattern, or 0 when absent. */
function lineOf(lines, predicate) {
    for (let index = 0; index < lines.length; index++)
        if (predicate(lines[index]))
            return index + 1;
    return 0;
}
/**
 * Read the name a manifest declares for itself.
 *
 * Following ADR-031, nothing is inferred from the filename: the value comes from
 * the body, and the line it came from is carried with it. A manifest that
 * declares no name yields nothing rather than a guess derived from its directory.
 */
function readDeclaredIdentifier(basename, text) {
    const name = basename.toLowerCase();
    const lines = text.split(/\r?\n/);
    const jsonField = JSON_NAME_FIELDS[name];
    if (jsonField !== undefined) {
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            return undefined;
        }
        if (parsed === null || typeof parsed !== "object")
            return undefined;
        const value = parsed[jsonField];
        if (typeof value !== "string" || value.trim().length === 0)
            return undefined;
        const quoted = new RegExp(String.raw `"${jsonField}"\s*:`);
        return {
            identifier: value.trim(),
            field: jsonField,
            line: lineOf(lines, (line) => quoted.test(line)),
        };
    }
    if (name === "go.mod") {
        for (let index = 0; index < lines.length; index++) {
            const match = /^\s*module\s+(\S+)\s*$/.exec(lines[index]);
            if (match)
                return { identifier: match[1], field: "module", line: index + 1 };
        }
        return undefined;
    }
    if (name === "pom.xml") {
        for (let index = 0; index < lines.length; index++) {
            const match = /<artifactId>([^<]+)<\/artifactId>/.exec(lines[index]);
            if (match)
                return { identifier: match[1].trim(), field: "artifactId", line: index + 1 };
        }
        return undefined;
    }
    const sections = TOML_NAME_SECTIONS[name];
    if (sections !== undefined) {
        let current = "";
        for (let index = 0; index < lines.length; index++) {
            const line = lines[index];
            const section = /^\s*\[([^\]]+)\]\s*$/.exec(line);
            if (section) {
                current = section[1].trim();
                continue;
            }
            if (!sections.includes(current))
                continue;
            const match = /^\s*name\s*=\s*["']([^"']+)["']\s*$/.exec(line);
            if (match)
                return { identifier: match[1], field: `${current}.name`, line: index + 1 };
        }
        return undefined;
    }
    return undefined;
}
/** The salient terms of one document: frequent, not too common, not a stopword. */
function salientTerms(document, documentFrequency, eligibleDocumentCount) {
    const ceiling = eligibleDocumentCount < exports.TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS
        ? Number.POSITIVE_INFINITY
        : eligibleDocumentCount * exports.TOPIC_DOCUMENT_FREQUENCY_CEILING;
    const kept = document.term_counts.filter(([term]) => {
        if (term.length < exports.TOPIC_MIN_TERM_LENGTH)
            return false;
        if (STOPWORDS.has(term))
            return false;
        // A term in nearly every document separates nothing; a term in exactly one
        // document is kept, because a corpus of near-unique vocabulary is normal.
        return (documentFrequency.get(term) ?? 0) <= ceiling;
    });
    const byFrequency = [...kept].sort((a, b) => b[1] - a[1] || (0, ordering_1.compareCodePoints)(a[0], b[0]));
    const salient = byFrequency.slice(0, exports.TOPIC_SALIENT_TERMS).map(([term]) => term);
    return salient.sort(ordering_1.compareCodePoints);
}
function jaccardOfSets(left, right) {
    if (left.size === 0 || right.size === 0)
        return 0;
    let shared = 0;
    const [small, large] = left.size <= right.size ? [left, right] : [right, left];
    for (const term of small)
        if (large.has(term))
            shared++;
    const union = left.size + right.size - shared;
    return union === 0 ? 0 : shared / union;
}
/** Round a threshold the way every other score in this package is rounded. */
function roundTopicScore(value) {
    return Math.round(value * 1e6) / 1e6;
}
/** One topic candidate from its members. Shared by the indexed and zero paths. */
function buildTopicCandidate(members, threshold, rootById) {
    const ordered = [...members].sort((a, b) => (0, ordering_1.compareCodePoints)(a.document.corpus_path, b.document.corpus_path));
    const memberIds = ordered.map((member) => member.document.virtual_source_id);
    const termCounts = new Map();
    for (const member of ordered) {
        for (const term of member.terms)
            termCounts.set(term, (termCounts.get(term) ?? 0) + 1);
    }
    const half = ordered.length / 2;
    const sharedTerms = [...termCounts.entries()]
        .filter(([, count]) => count >= half)
        .map(([term]) => term)
        .sort(ordering_1.compareCodePoints);
    const rootIds = [
        ...new Set(memberIds.map((id) => rootById.get(id)).filter((id) => !!id)),
    ].sort(ordering_1.compareCodePoints);
    return {
        candidate_id: (0, repository_model_1.stableId)("topic-candidate", {
            algorithm_id: exports.TOPIC_CANDIDATE_METHOD,
            algorithm_version: exports.TOPIC_CANDIDATE_METHOD_VERSION,
            member_ids: [...memberIds].sort(ordering_1.compareCodePoints),
            threshold: threshold.toFixed(6),
        }),
        method: exports.TOPIC_CANDIDATE_METHOD,
        algorithm_version: exports.TOPIC_CANDIDATE_METHOD_VERSION,
        threshold: roundTopicScore(threshold),
        member_ids: memberIds,
        member_paths: ordered.map((member) => member.document.corpus_path),
        member_count: memberIds.length,
        root_ids: rootIds,
        spans_roots: rootIds.length > 1,
        shared_terms: sharedTerms,
    };
}
/**
 * The prefix of a salient-term set a qualifying partner must intersect.
 *
 * Identical in form to the near-duplicate prefix bound in `corpus_analysis`, and
 * exact for the same reason: for Jaccard at threshold `t`, a pair can only reach
 * `t` if it shares at least `ceil(t * |X|)` terms with the smaller set. Under a
 * fixed global order, two sets sharing that many elements must both contain one
 * of the first `|X| - ceil(t*|X|) + 1` — otherwise the shared elements would all
 * have to sit past a point where fewer than that many remain.
 *
 * So this is a filter, not a sample. No qualifying pair is lost.
 */
function topicPrefixLength(setSize, threshold) {
    if (setSize === 0)
        return 0;
    return Math.max(1, setSize - Math.ceil(roundTopicScore(threshold) * setSize) + 1);
}
/**
 * Connected groups of documents whose salient vocabulary overlaps.
 *
 * Reached through an inverted index over salient terms, for the same reason the
 * near-duplicate pass uses one: two documents sharing no salient term score
 * exactly zero and cannot qualify at any positive threshold, so comparing them is
 * provably unnecessary rather than merely unlikely to matter.
 *
 * The index used to hold every salient term of every document, and that is what
 * made this pass unusable at scale rather than merely slow. A term appearing in
 * four thousand documents produces eight million pairs from one posting list, and
 * a corpus has many such terms — so the cost was quadratic in the corpus after
 * all, arriving through the index instead of around it.
 *
 * Two exact bounds fix it, both consequences of the definition of Jaccard rather
 * than approximations of it:
 *
 *   - a **prefix bound**: terms are put in one global order, rarest first, and
 *     only each document's prefix is indexed. `topicPrefixLength` above is the
 *     proof. Rarest-first is what makes it pay: the terms half the corpus shares
 *     sort to the end, where they are never indexed and so never generate a
 *     posting list the size of the corpus.
 *   - a **size bound**: a pair whose salient sets differ in size by more than a
 *     factor of `t` cannot reach `t`, so documents are visited smallest-first and
 *     a partner too small to qualify is skipped without measuring.
 *
 * Neither drops a qualifying pair — `tests/corpus_topic_scale.test.ts` holds this
 * to an exhaustive reference at six thresholds — and the work done is reported
 * rather than asserted.
 */
function buildTopicCandidates(input) {
    const threshold = input.threshold ?? exports.DEFAULT_TOPIC_THRESHOLD;
    const eligible = input.documents.filter((document) => document.token_count >= exports.TOPIC_MIN_TOKENS);
    // `Math.max` rather than the bare product: at zero eligible documents the
    // expression is `-0`, which serializes as `-0` and reads as a different number
    // from the `0` every other empty count in this package reports.
    const exhaustivePairs = Math.max(0, (eligible.length * (eligible.length - 1)) / 2);
    const emptyWork = (evaluated = 0) => ({
        eligible_document_count: eligible.length,
        exhaustive_pair_count: exhaustivePairs,
        evaluated_pair_count: evaluated,
        skipped_same_component_count: 0,
        indexed_posting_count: 0,
        unindexed_term_count: 0,
    });
    if (eligible.length < 2)
        return { candidates: [], pair_work: emptyWork() };
    // At a threshold of zero every pair qualifies by definition, including two
    // documents sharing no term at all. The index can only reach pairs that share
    // one, so it would silently under-report — the same reason the near-duplicate
    // pass keeps an exhaustive path at zero. Every eligible document is one
    // component, which is what "every pair joins" means.
    if (roundTopicScore(threshold) <= 0) {
        return {
            candidates: [buildTopicCandidate(eligible.map((document) => ({ document, terms: new Set() })), threshold, input.rootById)],
            pair_work: emptyWork(),
        };
    }
    const documentFrequency = new Map();
    for (const document of eligible) {
        for (const [term] of document.term_counts) {
            documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
        }
    }
    const features = eligible.map((document) => ({
        document,
        terms: new Set(salientTerms(document, documentFrequency, eligible.length)),
    }));
    // Rarest first. This is the ordering that makes the prefix bound worth having:
    // it puts the vocabulary a corpus shares — a boilerplate heading, a licence
    // line, a word every plan contains — at the end, where it falls outside every
    // prefix and is never indexed.
    const globalOrder = (left, right) => (documentFrequency.get(left) ?? 0) - (documentFrequency.get(right) ?? 0)
        || (0, ordering_1.compareCodePoints)(left, right);
    // Smallest salient set first, so a document meets every partner that could
    // satisfy the size bound from below before it is itself indexed.
    const order = features
        .map((feature, index) => ({ feature, index }))
        .sort((left, right) => left.feature.terms.size - right.feature.terms.size
        || (0, ordering_1.compareCodePoints)(left.feature.document.virtual_source_id, right.feature.document.virtual_source_id));
    const parent = features.map((_feature, index) => index);
    const find = (index) => {
        let root = index;
        while (parent[root] !== root)
            root = parent[root];
        let cursor = index;
        while (parent[cursor] !== root) {
            const next = parent[cursor];
            parent[cursor] = root;
            cursor = next;
        }
        return root;
    };
    const union = (a, b) => {
        const [rootA, rootB] = [find(a), find(b)];
        if (rootA !== rootB)
            parent[rootA] = rootB;
    };
    const postings = new Map();
    // Partners already offered to the document being visited, as a stamp per slot
    // rather than a set that is cleared. At this scale the index offers millions
    // of partners across the corpus, and a `Set` of small integers spends more
    // time on hashing them than the comparison it is protecting costs.
    const offeredAt = new Int32Array(features.length).fill(-1);
    const indexedTerms = new Set();
    let evaluated = 0;
    let sameComponent = 0;
    let indexedPostings = 0;
    for (const { feature, index } of order) {
        const size = feature.terms.size;
        if (size === 0)
            continue;
        const terms = [...feature.terms].sort(globalOrder);
        const prefix = terms.slice(0, topicPrefixLength(size, threshold));
        // Partners for this document only. Held per document rather than for the
        // whole corpus, so ten thousand documents never means ten thousand squared
        // pair keys resident at once — which is how the previous `compared` set
        // turned a cost problem into a memory one as well.
        let root = find(index);
        for (const term of prefix) {
            for (const other of postings.get(term) ?? []) {
                if (offeredAt[other] === index)
                    continue;
                offeredAt[other] = index;
                if (find(other) === root) {
                    sameComponent += 1;
                    continue;
                }
                // Size bound: `other` was visited earlier so its set is no larger, and a
                // pair can only reach the threshold when the smaller is at least `t` of
                // the larger.
                if (features[other].terms.size < roundTopicScore(threshold) * size)
                    continue;
                evaluated += 1;
                if (jaccardOfSets(feature.terms, features[other].terms) < threshold)
                    continue;
                union(other, index);
                // The document just moved component, so every later same-component test
                // in this pass has to be against where it is now.
                root = find(index);
            }
        }
        for (const term of prefix) {
            indexedTerms.add(term);
            indexedPostings += 1;
            const bucket = postings.get(term);
            if (bucket === undefined)
                postings.set(term, [index]);
            else
                bucket.push(index);
        }
    }
    const components = new Map();
    for (let index = 0; index < features.length; index++) {
        const root = find(index);
        const bucket = components.get(root);
        if (bucket === undefined)
            components.set(root, [index]);
        else
            bucket.push(index);
    }
    const candidates = [];
    for (const bucket of components.values()) {
        if (bucket.length < 2)
            continue;
        candidates.push(buildTopicCandidate(bucket.map((index) => features[index]), threshold, input.rootById));
    }
    candidates.sort((a, b) => b.member_count - a.member_count
        || (0, ordering_1.compareCodePoints)(a.member_paths[0] ?? "", b.member_paths[0] ?? "")
        || (0, ordering_1.compareCodePoints)(a.candidate_id, b.candidate_id));
    const salientTermCount = new Set(features.flatMap((feature) => [...feature.terms])).size;
    return {
        candidates,
        pair_work: {
            eligible_document_count: eligible.length,
            exhaustive_pair_count: exhaustivePairs,
            evaluated_pair_count: evaluated,
            skipped_same_component_count: sameComponent,
            indexed_posting_count: indexedPostings,
            unindexed_term_count: salientTermCount - indexedTerms.size,
        },
    };
}
/**
 * Every pair compared, as the reference the indexed pass is held to.
 *
 * Exported because a bound is only a bound if something independent agrees with
 * what it produced. Never used by a scan: it is `n(n-1)/2` by construction.
 */
function buildTopicCandidatesExhaustive(input) {
    const threshold = input.threshold ?? exports.DEFAULT_TOPIC_THRESHOLD;
    const eligible = input.documents.filter((document) => document.token_count >= exports.TOPIC_MIN_TOKENS);
    if (eligible.length < 2)
        return [];
    if (roundTopicScore(threshold) <= 0) {
        return [buildTopicCandidate(eligible.map((document) => ({ document, terms: new Set() })), threshold, input.rootById)];
    }
    const documentFrequency = new Map();
    for (const document of eligible) {
        for (const [term] of document.term_counts) {
            documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
        }
    }
    const features = eligible.map((document) => ({
        document,
        terms: new Set(salientTerms(document, documentFrequency, eligible.length)),
    }));
    const parent = features.map((_feature, index) => index);
    const find = (index) => {
        let root = index;
        while (parent[root] !== root)
            root = parent[root];
        return root;
    };
    for (let i = 0; i < features.length; i++) {
        for (let j = i + 1; j < features.length; j++) {
            if (jaccardOfSets(features[i].terms, features[j].terms) < threshold)
                continue;
            const [rootA, rootB] = [find(i), find(j)];
            if (rootA !== rootB)
                parent[rootA] = rootB;
        }
    }
    const components = new Map();
    for (let index = 0; index < features.length; index++) {
        const root = find(index);
        const bucket = components.get(root);
        if (bucket === undefined)
            components.set(root, [index]);
        else
            bucket.push(index);
    }
    const candidates = [];
    for (const bucket of components.values()) {
        if (bucket.length < 2)
            continue;
        candidates.push(buildTopicCandidate(bucket.map((index) => features[index]), threshold, input.rootById));
    }
    return candidates.sort((a, b) => b.member_count - a.member_count
        || (0, ordering_1.compareCodePoints)(a.member_paths[0] ?? "", b.member_paths[0] ?? "")
        || (0, ordering_1.compareCodePoints)(a.candidate_id, b.candidate_id));
}
/** Hash binding every rule the candidate passes apply. */
function candidateProfileHash(input) {
    return (0, repository_model_1.stableId)("candidate-profile", {
        near_duplicate_threshold: input.nearDuplicateThreshold.toFixed(6),
        project_method: exports.PROJECT_CANDIDATE_METHOD,
        project_method_version: exports.PROJECT_CANDIDATE_METHOD_VERSION,
        topic_df_ceiling: exports.TOPIC_DOCUMENT_FREQUENCY_CEILING.toFixed(6),
        topic_df_min_documents: exports.TOPIC_DOCUMENT_FREQUENCY_MIN_DOCUMENTS,
        topic_method: exports.TOPIC_CANDIDATE_METHOD,
        topic_method_version: exports.TOPIC_CANDIDATE_METHOD_VERSION,
        topic_min_term_length: exports.TOPIC_MIN_TERM_LENGTH,
        topic_min_tokens: exports.TOPIC_MIN_TOKENS,
        topic_salient_terms: exports.TOPIC_SALIENT_TERMS,
        topic_stopwords: [...exports.TOPIC_STOPWORDS].sort(ordering_1.compareCodePoints),
        topic_threshold: input.topicThreshold.toFixed(6),
    });
}
//# sourceMappingURL=corpus_candidates.js.map