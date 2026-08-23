// corpus_qualification.ts — the report a real corpus run has to be able to produce.
//
// Every other qualification in this package is a property test: it asserts that
// two runs agree, that a change invalidates what depends on it, that an
// interrupted scan resumes. Those tests are built on corpora written from
// constants, because a property is easiest to prove on a corpus whose every byte
// is stated in one place.
//
// This module answers the other question, which is not a property at all: run the
// engine over a mixed, awkward, read-only drive and say what actually happened.
// How many bytes were read, how much of the corpus the decoders could open, how
// much of it they could not, what the second run got out of the cache. Those are
// measurements rather than assertions, and they are the numbers an operator needs
// before pointing the tool at a disk they care about.
//
// Two rules the report keeps, both inherited rather than invented here:
//
//   - No absolute path appears in it. A corpus read from `/Volumes/OldSSD` and
//     the same corpus read from `/mnt/backup` are one corpus, so a mount point is
//     never part of what is reported about it.
//   - No number in it ranks anything. The counts say how many project candidates
//     were found, never which one to build. That boundary belongs to
//     `corpus_readiness.ts`, and this report stays on the same side of it.
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";
import type { CorpusCacheStats } from "./corpus_cache";
import type { CoverageRatio, FormatCount } from "./corpus_coverage";
import { TEXT_DECODER_ID, TEXT_DECODER_VERSION } from "./corpus_scan";
import type { CorpusScanResult } from "./corpus_scan";

/** Schema of the real-corpus qualification report. */
export const CORPUS_QUALIFICATION_SCHEMA = "l9.corpus-qualification-report/v1";

/** One root, named by identity alone. */
export interface QualificationRoot {
  root_id: string;
  root_label: string;
  root_snapshot_id: string;
  source_kind: string;
  source_revision: string;
}

/** What the decoders opened, and under which decoder identity. */
export interface DecoderCoverage {
  text_decoder_id: string;
  text_decoder_version: string;
  normalized_document: CoverageRatio;
  interpretation: CoverageRatio;
  lexical_analysis: CoverageRatio;
  embedding_when_enabled: CoverageRatio | null;
  embedding_enabled: boolean;
}

/** Byte equality, kept apart from wording similarity. */
export interface DuplicateCounts {
  exact_duplicate_cluster_count: number;
  exact_duplicate_artifact_count: number;
  cross_root_duplicate_cluster_count: number;
  recoverable_duplicate_bytes: number;
  near_duplicate_candidate_count: number;
  cross_root_near_duplicate_count: number;
  near_duplicate_threshold: number;
  unique_content_estimate: number;
  unique_content_bytes_estimate: number;
}

export interface CandidateCounts {
  candidate_count: number;
  cross_root_candidate_count: number;
}

/** Everything the run could not read, by the reason it could not read it. */
export interface UnsupportedCounts {
  unsupported_format_counts: FormatCount[];
  unsupported_format_total: number;
  unsupported_format_bytes: number;
  ocr_required_count: number;
  encrypted_document_count: number;
  oversized_document_count: number;
  secret_skipped_count: number;
}

/** The second run's own cache accounting, never averaged with the first run's. */
export interface SecondRunCacheHitRatio {
  enabled: boolean;
  hit_ratio: number;
  hits: number;
  misses: number;
  writes: number;
  corrupt: number;
  stale_producer: number;
  layers: { layer: string; hits: number; misses: number; writes: number; corrupt: number }[];
}

/**
 * Whether the warm run said the same thing as the cold one.
 *
 * `semantic_output_identical` is the invariant the cache is only allowed to exist
 * under: a hit and a miss must produce the same bytes for the deterministic
 * projections. The caller computes it by comparing rendered output, because this
 * module must not be the thing that decides its own qualification passed.
 */
export interface ColdWarmEquivalence {
  semantic_output_identical: boolean;
  corpus_snapshot_id_identical: boolean;
  cold_files_scanned: number;
  warm_files_scanned: number;
  cold_cache_hits: number;
  warm_cache_hits: number;
}

/**
 * Proof that reading a corpus left it exactly as it was found.
 *
 * The digests are the proof; the mode bits are only an attempt at one. A process
 * running as root writes through `0o444` without noticing it, so the fixture
 * records whether the read-only mode was *applied* and, separately, whether it is
 * actually *enforced* against this process. Reporting a single "read only" flag
 * would state a guarantee that the second field exists to deny.
 */
export interface SourceMutationProof {
  /** Digest over every path, mode and content in the fixture, before the runs. */
  tree_digest_before: string;
  /** The same digest taken after the last run. */
  tree_digest_after: string;
  /** Paths whose content, kind or presence changed. The contract's target is zero. */
  mutated_path_count: number;
  /** True when every file was chmod'ed read-only and every directory non-writable. */
  read_only_mode_applied: boolean;
  /** True only when a probe write into the fixture actually failed. */
  read_only_enforced_for_process: boolean;
}

export interface CorpusQualificationReport {
  schema: string;
  corpus_snapshot_id: string;
  corpus_profile_hash: string;
  producer_version: string;
  roots: QualificationRoot[];
  corpus: {
    artifact_count: number;
    archive_count: number;
    archive_member_count: number;
    root_count: number;
    distinct_extension_count: number;
  };
  bytes_scanned: number;
  files_scanned: number;
  cache_hit_ratio_second_run: SecondRunCacheHitRatio;
  decoder_coverage: DecoderCoverage;
  duplicate_counts: DuplicateCounts;
  topic_candidate_counts: CandidateCounts;
  project_candidate_counts: CandidateCounts;
  reasoning_eligible_count: number;
  unsupported_counts: UnsupportedCounts;
  cold_warm_equivalence: ColdWarmEquivalence;
  source_mutation: SourceMutationProof;
  /** Restated so a consumer reading only this file sees the boundary. */
  no_priority_statement: string;
}

export const QUALIFICATION_NO_PRIORITY_STATEMENT =
  "This report measures one run over one corpus. Every field in it is a count, a ratio or "
  + "an identity. It contains no priority, no ranking and no recommendation about any "
  + "artifact, candidate or body of work it describes.";

export interface CorpusQualificationInput {
  /** The run made with an empty cache. */
  cold: CorpusScanResult;
  /** The run made immediately afterwards against the same bytes and a warm cache. */
  warm: CorpusScanResult;
  producerVersion: string;
  /** Decided by the caller comparing rendered projections, not by this module. */
  semanticOutputIdentical: boolean;
  sourceMutation: SourceMutationProof;
}

function secondRunCache(stats: CorpusCacheStats): SecondRunCacheHitRatio {
  return {
    enabled: stats.enabled,
    hit_ratio: stats.hit_ratio,
    hits: stats.hits,
    misses: stats.misses,
    writes: stats.writes,
    corrupt: stats.corrupt,
    stale_producer: stats.stale_producer,
    layers: stats.layers
      .map((layer) => ({
        layer: layer.layer,
        hits: layer.hits,
        misses: layer.misses,
        writes: layer.writes,
        corrupt: layer.corrupt,
      }))
      .sort((a, b) => compareCodePoints(a.layer, b.layer)),
  };
}

/**
 * Build the report from a cold run, the warm run that followed it, and the
 * caller's own comparison of the two.
 *
 * The measurements come from the cold run, because that is the run that read the
 * corpus. The cache ratio comes from the warm run, because that is the run the
 * ratio is a fact about.
 */
export function buildCorpusQualificationReport(
  input: CorpusQualificationInput,
): CorpusQualificationReport {
  const { cold, warm } = input;
  const coverage = cold.coverage;
  const summary = cold.candidates.summary;
  const handoff = coverage.reasoning_handoff;
  const profile = cold.candidates.analysis_profile;

  const extensions = new Set<string>();
  for (const artifact of cold.snapshot.artifacts) {
    const basename = artifact.corpus_path.split("/").pop() ?? "";
    const dot = basename.lastIndexOf(".");
    extensions.add(dot > 0 ? basename.slice(dot).toLowerCase() : "");
  }

  const unsupported = coverage.unsupported_format_counts;

  return {
    schema: CORPUS_QUALIFICATION_SCHEMA,
    corpus_snapshot_id: cold.snapshot.corpus_snapshot_id,
    corpus_profile_hash: cold.candidates.corpus_profile_hash,
    producer_version: input.producerVersion,
    roots: cold.bindings
      .map((binding) => ({
        root_id: binding.root_id,
        root_label: binding.root_label,
        root_snapshot_id: binding.root_snapshot_id,
        source_kind: binding.source_kind,
        source_revision: binding.source_revision,
      }))
      .sort((a, b) => compareCodePoints(a.root_id, b.root_id)),
    corpus: {
      artifact_count: summary.artifact_count,
      archive_count: summary.archive_count,
      archive_member_count: summary.archive_member_count,
      root_count: summary.root_count,
      distinct_extension_count: extensions.size,
    },
    bytes_scanned: cold.scanned.bytes,
    files_scanned: cold.scanned.files,
    cache_hit_ratio_second_run: secondRunCache(warm.cacheStats),
    decoder_coverage: {
      text_decoder_id: TEXT_DECODER_ID,
      text_decoder_version: TEXT_DECODER_VERSION,
      normalized_document: coverage.normalized_document_coverage,
      interpretation: coverage.interpretation_coverage,
      lexical_analysis: coverage.lexical_analysis_coverage,
      embedding_when_enabled: coverage.embedding_coverage_when_enabled,
      embedding_enabled: coverage.embedding_enabled,
    },
    duplicate_counts: {
      exact_duplicate_cluster_count: summary.exact_duplicate_cluster_count,
      exact_duplicate_artifact_count: summary.exact_duplicate_artifact_count,
      cross_root_duplicate_cluster_count: summary.cross_root_duplicate_cluster_count,
      recoverable_duplicate_bytes: summary.recoverable_duplicate_bytes,
      near_duplicate_candidate_count: summary.near_duplicate_candidate_count,
      cross_root_near_duplicate_count: summary.cross_root_near_duplicate_count,
      near_duplicate_threshold: profile.near_duplicate_threshold,
      unique_content_estimate: handoff.unique_content_estimate,
      unique_content_bytes_estimate: handoff.unique_content_bytes_estimate,
    },
    topic_candidate_counts: {
      candidate_count: summary.topic_candidate_count,
      cross_root_candidate_count: summary.cross_root_topic_candidate_count,
    },
    project_candidate_counts: {
      candidate_count: summary.project_candidate_count,
      cross_root_candidate_count: summary.cross_root_project_candidate_count,
    },
    reasoning_eligible_count: coverage.reasoning_eligible_candidate_count,
    unsupported_counts: {
      unsupported_format_counts: unsupported,
      unsupported_format_total: unsupported.reduce((total, entry) => total + entry.count, 0),
      unsupported_format_bytes: unsupported.reduce((total, entry) => total + entry.bytes, 0),
      ocr_required_count: coverage.ocr_required_count,
      encrypted_document_count: coverage.encrypted_document_count,
      oversized_document_count: coverage.oversized_document_count,
      secret_skipped_count: coverage.secret_skipped_count,
    },
    cold_warm_equivalence: {
      semantic_output_identical: input.semanticOutputIdentical,
      corpus_snapshot_id_identical:
        cold.snapshot.corpus_snapshot_id === warm.snapshot.corpus_snapshot_id,
      cold_files_scanned: cold.scanned.files,
      warm_files_scanned: warm.scanned.files,
      cold_cache_hits: cold.cacheStats.hits,
      warm_cache_hits: warm.cacheStats.hits,
    },
    source_mutation: input.sourceMutation,
    no_priority_statement: QUALIFICATION_NO_PRIORITY_STATEMENT,
  };
}

/** Canonical bytes of a qualification report. */
export function renderCorpusQualificationReport(report: CorpusQualificationReport): string {
  return `${canonicalCorpusJson(report)}\n`;
}
