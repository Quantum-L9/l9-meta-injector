// corpus_coverage.ts — what the scan reached, and what it did not.
//
// A coverage report is the honest half of an archaeology tool. Every number in
// `corpus-index.json` is about the documents that could be read; this file is
// about the ones that could not, and about the exact fraction of the corpus each
// analysis actually saw.
//
// The distinction it keeps carefully is between *not supported* and *not present*.
// A PDF is a text-bearing document this release does not decode: it is counted as
// an unsupported format, by extension, so an operator can see precisely how much
// of their archive is invisible to the current decoder set. A PNG is not a
// document that failed to decode; it is a document that requires OCR, which this
// package does not perform and does not pretend to.
//
// The reasoning handoff at the end points a downstream layer at the evidence and
// stops. It carries references and counts, and no priority — deciding what to do
// with a corpus is a judgement, and this producer does not make judgements.
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";

export const CORPUS_COVERAGE_SCHEMA = "l9.corpus-coverage/v1";

/** Raster formats that carry no extractable text layer without OCR. */
export const OCR_REQUIRED_EXTENSIONS: readonly string[] = [
  ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp",
];

/**
 * Text-bearing formats this release does not decode.
 *
 * Listed rather than inferred, so the gap is a stated set an operator can read
 * off the report and a future decoder can be measured against.
 */
export const UNDECODED_DOCUMENT_EXTENSIONS: readonly string[] = [
  ".doc", ".docx", ".epub", ".key", ".numbers", ".odp", ".ods", ".odt", ".pages",
  ".pdf", ".ppt", ".pptx", ".rtf", ".xls", ".xlsx",
];

export interface CoverageRatio {
  /** Artifacts the analysis could apply to at all. */
  eligible: number;
  /** Of those, the ones it did apply to. */
  covered: number;
  /** `covered / eligible`, six places. `1` when nothing was eligible. */
  ratio: number;
}

export interface FormatCount {
  extension: string;
  count: number;
  bytes: number;
}

export interface ReasoningHandoff {
  /** How many candidates were routed for later reasoning, and how they were packed. */
  reasoning_candidate_count: number;
  reasoning_evidence_pack_count: number;
  /** Packs that hit a budget, so a reader knows the evidence is not the whole file. */
  truncated_evidence_pack_count: number;
  /** Candidates routed to a reasoning type other than NONE. */
  reasoning_eligible_candidate_count: number;
  /** Where the grounded measurements a pack may cite actually live. */
  corpus_snapshot_ref: string;
  corpus_coverage_ref: string;
  /** Where the readiness signals for this corpus live. */
  readiness_evidence_refs: {
    schema: string;
    file: string;
    body_of_work_count: number;
    signal_vocabulary: readonly string[];
  };
  /** Declared dependency and blocker assertions, by predicate. */
  dependency_evidence_refs: { predicate: string; assertion_count: number }[];
  /** Exact clusters and lexical candidates, kept in their separate classes. */
  duplicate_evidence_refs: {
    exact_duplicate_cluster_count: number;
    exact_duplicate_artifact_count: number;
    recoverable_duplicate_bytes: number;
    near_duplicate_candidate_count: number;
    near_duplicate_threshold: number;
  };
  /** Distinct content hashes in the corpus; exact duplicates collapse to one. */
  unique_content_estimate: number;
  unique_content_bytes_estimate: number;
  /** Restated so a consumer reading only this file sees the boundary. */
  no_priority_statement: string;
}

export const NO_PRIORITY_STATEMENT =
  "This handoff carries evidence and counts. It contains no priority, no ranking and "
  + "no recommendation, and none can be read out of the order of any list in it.";

/**
 * The corpus's own denominators.
 *
 * These exist so no count below can be read without its base. "12 project
 * candidates" is a different claim over a corpus of two hundred files than over
 * one of two hundred thousand, and a different claim again when four of the six
 * drives were never plugged in.
 */
export interface CorpusScopeCoverage {
  root_count_requested: number;
  root_count_observed: number;
  root_count_failed: number;
  /** Files that exist on a disk. */
  total_physical_artifacts: number;
  /** Files that exist only inside an archive. */
  total_virtual_archive_artifacts: number;
  total_bytes_observed: number;
  archive_count: number;
  archive_member_count: number;
}

/** How the hashes were arrived at, and what may therefore be claimed of them. */
export interface HashingCoverage {
  fully_rehashed_count: number;
  cached_hash_reuse_count: number;
  unhashed_count: number;
  verification_class: string;
  verification_mode: string;
}

/** What the decoders reached, and what they did not. */
export interface DocumentCoverage {
  decoder_eligible_count: number;
  normalized_document_count: number;
  unsupported_format_count: number;
  decoder_failure_count: number;
  ocr_required_count: number;
  encrypted_document_count: number;
  oversized_document_count: number;
  secret_skipped_count: number;
}

/** What the analysis found, over the denominators above. */
export interface SemanticCoverage {
  interpreted_artifact_count: number;
  work_signal_artifact_count: number;
  exact_duplicate_cluster_count: number;
  near_duplicate_candidate_count: number;
  topic_candidate_count: number;
  project_candidate_count: number;
  consolidation_candidate_count: number;
}

/** Embeddings, reported as off rather than omitted when they are off. */
export interface EmbeddingCoverage {
  enabled: boolean;
  /** Null when embeddings were not enabled, which is the default. */
  eligible_count: number | null;
  embedded_count: number | null;
  cache_hit_count: number | null;
  provider_failure_count: number | null;
}

export interface CorpusCoverage {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  root_ids: string[];
  corpus: CorpusScopeCoverage;
  hashing: HashingCoverage;
  documents: DocumentCoverage;
  semantics: SemanticCoverage;
  embeddings: EmbeddingCoverage;
  exact_hash_coverage: CoverageRatio;
  normalized_document_coverage: CoverageRatio;
  interpretation_coverage: CoverageRatio;
  lexical_analysis_coverage: CoverageRatio;
  /** Null when embeddings were not enabled, which is the default. */
  embedding_coverage_when_enabled: CoverageRatio | null;
  /** Which extensions the undecoded artifacts were, and how many bytes each held. */
  unsupported_format_counts: FormatCount[];
  reasoning_handoff: ReasoningHandoff;
  /** Every cache layer's hit accounting, so a reported ratio can be checked. */
  cache: {
    enabled: boolean;
    hit_ratio: number;
    hits: number;
    misses: number;
    writes: number;
    corrupt: number;
    layers: { layer: string; hits: number; misses: number; writes: number; corrupt: number }[];
  };
}

/** Build a ratio, treating "nothing was eligible" as complete coverage. */
export function coverageRatio(covered: number, eligible: number): CoverageRatio {
  return {
    eligible,
    covered,
    ratio: eligible === 0 ? 1 : Math.round((covered / eligible) * 1e6) / 1e6,
  };
}

/** Group counts and bytes by extension, in code-point order. */
export function formatCounts(
  entries: readonly { extension: string; bytes: number }[],
): FormatCount[] {
  const grouped = new Map<string, { count: number; bytes: number }>();
  for (const entry of entries) {
    const existing = grouped.get(entry.extension) ?? { count: 0, bytes: 0 };
    existing.count += 1;
    existing.bytes += entry.bytes;
    grouped.set(entry.extension, existing);
  }
  return [...grouped.entries()]
    .map(([extension, totals]) => ({ extension, ...totals }))
    .sort((a, b) => compareCodePoints(a.extension, b.extension));
}

/** Canonical bytes of a coverage report. */
export function renderCorpusCoverage(coverage: CorpusCoverage): string {
  return `${canonicalCorpusJson(coverage)}\n`;
}
