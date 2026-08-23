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
import { analysisTokens, normalizeForAnalysis } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";

// ───────────────────────────── keyphrase profile ─────────────────────────────

export const KEYPHRASE_PROFILE_ID = "corpus-keyphrases/v1";
export const KEYPHRASE_PROFILE_VERSION = "1.0.0";

/** Tokenizer identity. Unicode word tokens over NFKC-normalized, lowercased text. */
export const KEYPHRASE_TOKENIZER_VERSION = "unicode-word/v1";

/** Stopword list identity. Closed, English function words, versioned as a set. */
export const KEYPHRASE_STOPWORD_PROFILE = "en-function-words/v1";

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
export const KEYPHRASE_STEMMING_PROFILE = "trailing-plural-s/v1";

/** Weighting algorithm identity. */
export const KEYPHRASE_WEIGHTING_ALGORITHM = "field-weighted-tf-idf/v1";

/**
 * How much each field counts toward a term's frequency.
 *
 * A word in a title is evidence about the whole document; the same word in one
 * paragraph is evidence about that paragraph. The ratios are stated here rather
 * than tuned per corpus, because a weighting that changed with the corpus would
 * make two runs incomparable.
 */
export const KEYPHRASE_FIELD_WEIGHTS: Readonly<Record<KeyphraseField, number>> = {
  title: 4,
  heading: 3,
  declared_identifier: 3,
  body: 1,
};

/** Keyphrases kept per artifact, highest weight first. Bounded so a pack stays bounded. */
export const MAX_KEYPHRASES_PER_ARTIFACT = 24;

/** Shortest term that can be a keyphrase. Two-letter tokens carry no topic. */
export const KEYPHRASE_MIN_TERM_LENGTH = 3;

/** Decimal places a reported weight is rounded to, so replays are byte-identical. */
const WEIGHT_PRECISION = 6;

export type KeyphraseField = "title" | "heading" | "declared_identifier" | "body";

/**
 * Closed stopword list: English function words only.
 *
 * Short on purpose. A long list tuned to a corpus encodes an unstated model of
 * what that corpus is about, and then the analysis is partly a description of the
 * list. These are words that would otherwise join every document to every other.
 */
export const KEYPHRASE_STOPWORDS: readonly string[] = [
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

const STOPWORD_SET = new Set(KEYPHRASE_STOPWORDS);

/** Suffixes that look plural and are not. */
const NON_PLURAL_SUFFIXES = ["ss", "us", "is", "as", "os"];

/**
 * Apply the versioned stemmer to one already-normalized token.
 *
 * Exported because the pair pass must stem the same way, and two implementations
 * of one rule is how the two sides quietly stop agreeing.
 */
export function stemToken(token: string): string {
  if (token.length <= 3 || !token.endsWith("s")) return token;
  for (const suffix of NON_PLURAL_SUFFIXES) {
    if (token.endsWith(suffix)) return token;
  }
  return token.slice(0, -1);
}

/** Normalize, tokenize, drop stopwords and short tokens, then stem. */
export function analysisTerms(text: string): string[] {
  const out: string[] = [];
  for (const token of analysisTokens(normalizeForAnalysis(text))) {
    if (token.length < KEYPHRASE_MIN_TERM_LENGTH) continue;
    if (STOPWORD_SET.has(token)) continue;
    const stemmed = stemToken(token);
    if (stemmed.length < KEYPHRASE_MIN_TERM_LENGTH) continue;
    if (STOPWORD_SET.has(stemmed)) continue;
    out.push(stemmed);
  }
  return out;
}

/** Identity of the keyphrase profile, binding every input that changes its output. */
export function keyphraseProfileHash(): string {
  return stableId("keyphrase-profile", {
    field_weights: KEYPHRASE_FIELD_WEIGHTS,
    max_keyphrases_per_artifact: MAX_KEYPHRASES_PER_ARTIFACT,
    min_term_length: KEYPHRASE_MIN_TERM_LENGTH,
    profile_id: KEYPHRASE_PROFILE_ID,
    profile_version: KEYPHRASE_PROFILE_VERSION,
    stemming_profile: KEYPHRASE_STEMMING_PROFILE,
    stopword_profile: KEYPHRASE_STOPWORD_PROFILE,
    stopwords: [...KEYPHRASE_STOPWORDS].sort(compareCodePoints),
    tokenizer_version: KEYPHRASE_TOKENIZER_VERSION,
    weighting_algorithm: KEYPHRASE_WEIGHTING_ALGORITHM,
  });
}

// ───────────────────────────── inputs ─────────────────────────────

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

// ───────────────────────────── outputs ─────────────────────────────

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
  // identity
  artifact_id: string;
  root_id: string;
  corpus_path: string;
  root_relative_path: string;
  content_hash: string | null;
  normalized_document_id: string | null;

  // lexical
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

  // work
  statuses: string[];
  kinds: string[];
  task_terms: string[];
  milestone_terms: string[];
  blockers: string[];
  supersession_declarations: { predicate: string; object: string; assertion_id: string }[];

  // structural
  archive_ancestry: string[];
  is_archive_member: boolean;
  exact_duplicate_cluster_id: string | null;
  near_duplicate_candidate_ids: string[];

  // optional
  embedding_ref: string | null;
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

function sortedUnique(values: Iterable<string>): string[] {
  return [...new Set(values)].sort(compareCodePoints);
}

/**
 * Normalize a reference target so two spellings of one path compare equal.
 *
 * A reference is written by a person: `./docs/a.md`, `docs/a.md` and `DOCS/A.MD`
 * all name one file. Leading `./`, a leading slash and case are removed; nothing
 * else is, because collapsing further would start merging genuinely different
 * targets.
 */
export function normalizeReferenceTarget(target: string): string {
  const trimmed = target.trim().replace(/\\/g, "/");
  const withoutPrefix = trimmed.replace(/^\.\//, "").replace(/^\/+/, "");
  return normalizeForAnalysis(withoutPrefix).trim();
}

interface FieldTerms {
  title: string[];
  heading: string[];
  declared_identifier: string[];
  body: string[];
}

/** Terms per field, plus which assertions each term came from. */
function collectFieldTerms(artifact: SemanticArtifactInput): {
  fields: FieldTerms;
  refsByTerm: Map<string, Set<string>>;
  displayByTerm: Map<string, Map<string, number>>;
} {
  const fields: FieldTerms = { title: [], heading: [], declared_identifier: [], body: [] };
  const refsByTerm = new Map<string, Set<string>>();
  const displayByTerm = new Map<string, Map<string, number>>();

  const noteDisplay = (term: string, surface: string): void => {
    const counts = displayByTerm.get(term) ?? new Map<string, number>();
    counts.set(surface, (counts.get(surface) ?? 0) + 1);
    displayByTerm.set(term, counts);
  };
  const noteRef = (term: string, assertionId: string): void => {
    const refs = refsByTerm.get(term) ?? new Set<string>();
    refs.add(assertionId);
    refsByTerm.set(term, refs);
  };

  const ingest = (
    text: string,
    field: keyof FieldTerms,
    assertionId: string | null,
  ): void => {
    const surfaces = analysisTokens(normalizeForAnalysis(text));
    const terms = analysisTerms(text);
    for (const term of terms) {
      fields[field].push(term);
      if (assertionId !== null) noteRef(term, assertionId);
    }
    // Surface spellings are recorded from the same normalized token stream, so a
    // display term is always something that actually appeared in the document.
    for (const surface of surfaces) {
      const stemmed = stemToken(surface);
      if (terms.includes(stemmed)) noteDisplay(stemmed, surface);
    }
  };

  for (const assertion of artifact.assertions ?? []) {
    if (assertion.predicate === TITLE_PREDICATE) ingest(assertion.object, "title", assertion.assertion_id);
    else if (assertion.predicate === HEADING_PREDICATE) ingest(assertion.object, "heading", assertion.assertion_id);
  }
  for (const declared of artifact.declared_identifiers ?? []) {
    ingest(declared.identifier, "declared_identifier", null);
  }
  if (artifact.body_text !== undefined) ingest(artifact.body_text, "body", null);
  for (const [rawTerm, count] of artifact.body_term_counts ?? []) {
    if (rawTerm.length < KEYPHRASE_MIN_TERM_LENGTH || STOPWORD_SET.has(rawTerm)) continue;
    const term = stemToken(rawTerm);
    if (term.length < KEYPHRASE_MIN_TERM_LENGTH || STOPWORD_SET.has(term)) continue;
    for (let i = 0; i < count; i += 1) fields.body.push(term);
    noteDisplay(term, rawTerm);
  }

  return { fields, refsByTerm, displayByTerm };
}

/** The strongest field a term appeared in, by weight. */
function strongestField(fields: FieldTerms, term: string): KeyphraseField {
  const order: KeyphraseField[] = ["title", "heading", "declared_identifier", "body"];
  for (const field of order) {
    if (fields[field].includes(term)) return field;
  }
  return "body";
}

interface PreparedArtifact {
  input: SemanticArtifactInput;
  fields: FieldTerms;
  refsByTerm: Map<string, Set<string>>;
  displayByTerm: Map<string, Map<string, number>>;
  weightedCounts: Map<string, number>;
}

function prepare(artifact: SemanticArtifactInput): PreparedArtifact {
  const { fields, refsByTerm, displayByTerm } = collectFieldTerms(artifact);
  const weightedCounts = new Map<string, number>();
  for (const field of Object.keys(fields) as KeyphraseField[]) {
    const weight = KEYPHRASE_FIELD_WEIGHTS[field];
    for (const term of fields[field]) {
      weightedCounts.set(term, (weightedCounts.get(term) ?? 0) + weight);
    }
  }
  return { input: artifact, fields, refsByTerm, displayByTerm, weightedCounts };
}

/** The surface spelling seen most often; ties break by code point. */
function displayTermFor(prepared: PreparedArtifact, term: string): string {
  const counts = prepared.displayByTerm.get(term);
  if (counts === undefined || counts.size === 0) return term;
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareCodePoints(a[0], b[0]))[0]?.[0] ?? term;
}

function keyphrasesFor(
  prepared: PreparedArtifact,
  documentFrequency: Map<string, number>,
  documentCount: number,
): Keyphrase[] {
  const scored: Keyphrase[] = [];
  for (const [term, weightedCount] of prepared.weightedCounts) {
    const df = documentFrequency.get(term) ?? 0;
    if (df === 0) continue;
    // Smoothed IDF. A term in every document scores 0 and drops out, which is the
    // whole point: corpus boilerplate is not what makes a document findable.
    const idf = Math.log((documentCount + 1) / (df + 1));
    if (idf <= 0) continue;
    const weight = Math.round(weightedCount * idf * 10 ** WEIGHT_PRECISION) / 10 ** WEIGHT_PRECISION;
    if (weight <= 0) continue;
    scored.push({
      normalized_term: term,
      display_term: displayTermFor(prepared, term),
      weight,
      evidence_source: strongestField(prepared.fields, term),
      source_block_refs: [...(prepared.refsByTerm.get(term) ?? [])].sort(compareCodePoints),
    });
  }
  return scored
    .sort((a, b) => b.weight - a.weight || compareCodePoints(a.normalized_term, b.normalized_term))
    .slice(0, MAX_KEYPHRASES_PER_ARTIFACT);
}

function featureViewFor(
  prepared: PreparedArtifact,
  keyphrases: Keyphrase[],
): ArtifactFeatureView {
  const artifact = prepared.input;
  const assertions = artifact.assertions ?? [];
  const declared = artifact.declared_identifiers ?? [];
  const byPredicate = (predicate: string): string[] =>
    assertions.filter((a) => a.predicate === predicate).map((a) => a.object);

  const taskTerms = new Set<string>();
  for (const predicate of [OPEN_TASK_PREDICATE, COMPLETED_TASK_PREDICATE]) {
    for (const object of byPredicate(predicate)) {
      for (const term of analysisTerms(object)) taskTerms.add(term);
    }
  }
  const milestoneTerms = new Set<string>();
  for (const object of byPredicate(MILESTONE_PREDICATE)) {
    for (const term of analysisTerms(object)) milestoneTerms.add(term);
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
    normalized_reference_targets: sortedUnique(
      byPredicate(REFERENCE_PREDICATE).map(normalizeReferenceTarget).filter((t) => t.length > 0),
    ),
    declared_project_identifiers: sortedUnique(
      declared.map((entry) => normalizeForAnalysis(entry.identifier).trim()).filter((v) => v.length > 0),
    ),
    declared_package_names: sortedUnique(
      declared
        .filter((entry) => PACKAGE_MANIFESTS.has(entry.manifest.toLowerCase()))
        .map((entry) => normalizeForAnalysis(entry.identifier).trim())
        .filter((v) => v.length > 0),
    ),
    declared_service_names: [],
    declared_dependencies: sortedUnique(
      byPredicate(DEPENDS_PREDICATE).map(normalizeReferenceTarget).filter((t) => t.length > 0),
    ),

    statuses: sortedUnique(byPredicate(STATUS_PREDICATE).map((v) => normalizeForAnalysis(v).trim())),
    kinds: sortedUnique(byPredicate(KIND_PREDICATE).map((v) => normalizeForAnalysis(v).trim())),
    task_terms: [...taskTerms].sort(compareCodePoints),
    milestone_terms: [...milestoneTerms].sort(compareCodePoints),
    blockers: sortedUnique(byPredicate(BLOCKED_PREDICATE).map((v) => normalizeForAnalysis(v).trim())),
    supersession_declarations: assertions
      .filter((a) => SUPERSESSION_PREDICATES.has(a.predicate))
      .map((a) => ({
        predicate: a.predicate,
        object: normalizeReferenceTarget(a.object),
        assertion_id: a.assertion_id,
      }))
      .sort(
        (a, b) => compareCodePoints(a.predicate, b.predicate)
          || compareCodePoints(a.object, b.object)
          || compareCodePoints(a.assertion_id, b.assertion_id),
      ),

    archive_ancestry: [...(artifact.archive_ancestry ?? [])],
    is_archive_member: artifact.is_archive_member,
    exact_duplicate_cluster_id: artifact.exact_duplicate_cluster_id ?? null,
    near_duplicate_candidate_ids: [...(artifact.near_duplicate_candidate_ids ?? [])].sort(
      compareCodePoints,
    ),

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
export function buildFeatureViews(
  artifacts: readonly SemanticArtifactInput[],
): ArtifactFeatureView[] {
  const prepared = artifacts.map(prepare);

  const documentFrequency = new Map<string, number>();
  for (const entry of prepared) {
    for (const term of entry.weightedCounts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }

  return prepared
    .map((entry) => featureViewFor(entry, keyphrasesFor(entry, documentFrequency, prepared.length)))
    .sort(
      (a, b) => compareCodePoints(a.corpus_path, b.corpus_path)
        || compareCodePoints(a.artifact_id, b.artifact_id),
    );
}
