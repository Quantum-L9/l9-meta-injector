// corpus_documents.ts — the normalized documents, written down.
//
// Decoding already happened. Every scan turns bytes into normalized text, hashes
// that text, counts its tokens and files the result in the cache under a key made
// of the source hash and the decoder's identity. What it never did was *emit* any
// of that: the record was a private interface, held in a map, discarded when the
// run ended.
//
// That was fine while the only consumer was the same run. It stops being fine the
// moment a later pass wants to reason over documents rather than over files,
// because such a pass needs three things it cannot recover afterwards:
//
//   - which artifact a document came from, so a conclusion can be traced back;
//   - the *exact source* content hash, so the document can be proven to describe
//     the bytes on disk rather than some other copy;
//   - which decoder produced it, at which version, so two documents are only
//     comparable when the same rules made them.
//
// So this module writes the index. It computes nothing new — every field here is
// already established during the scan — it just stops throwing it away.
//
// Two things the index deliberately is not. It is not a content store: the
// normalized text is not in it, only the hash of that text, because a document
// index that carried document bodies would be a second copy of the corpus. And it
// is not a decoding claim: an artifact no decoder opened still gets an entry,
// carrying `decoded: false` and the reason, because "this was not read" is
// exactly the fact a coverage-honest pipeline must be able to state.
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";

/** Schema of the normalized-document index. */
export const DOCUMENT_INDEX_SCHEMA = "l9.document-index/v1";

/**
 * One normalized document, or one artifact that could not become a document.
 *
 * `corpus_path` is root-scoped (`root::path`) and, for an archive member, carries
 * the `archive.zip!/member` locator that names where inside the archive it lived.
 * No absolute path appears: a document read from `/Volumes/OldSSD` and the same
 * document read from `/mnt/backup` are one document.
 */
export interface NormalizedDocumentEntry {
  /** The artifact this document was decoded from. */
  artifact_id: string;
  root_id: string;
  corpus_path: string;
  /** Path inside its root, POSIX, possibly an `archive.zip!/member` locator. */
  root_relative_path: string;
  /** Hash of the *source bytes*, not of the decoded text. */
  content_hash: string | null;
  /**
   * `H(content_hash, decoder_id, decoder_version)`.
   *
   * Null exactly when there is no content hash to derive it from. Two artifacts
   * with identical bytes share one normalized document id, which is what lets a
   * duplicate be decoded once and read twice.
   */
  normalized_document_id: string | null;
  decoder_id: string;
  decoder_version: string;
  /** False when no decoder claimed the artifact, or decoding refused. */
  decoded: boolean;
  /** Why it was not decoded. Null when it was. */
  undecoded_reason: string | null;
  /** Source bytes considered. Null when the artifact was never opened. */
  byte_length: number | null;
  /** Tokens in the normalized text. Null when it was not decoded. */
  token_count: number | null;
  /** Hash of the normalized analysis text. Null when it was not decoded. */
  normalized_content_hash: string | null;
  is_archive_member: boolean;
  /** Enclosing archives, outermost first. Empty for a file on disk. */
  archive_ancestry: string[];
}

export interface DocumentIndexSummary {
  artifact_count: number;
  decoded_count: number;
  undecoded_count: number;
  /** Distinct `normalized_document_id` values: duplicates collapse to one. */
  distinct_document_count: number;
  archive_member_count: number;
  total_token_count: number;
  /** Why artifacts were not decoded, by reason, in code-point order. */
  undecoded_by_reason: { reason: string; count: number }[];
}

export interface DocumentIndex {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  decoder: { decoder_id: string; decoder_version: string };
  summary: DocumentIndexSummary;
  documents: NormalizedDocumentEntry[];
}

/** One artifact as the scan knows it, reduced to the fields the index records. */
export interface DocumentIndexArtifactInput {
  artifactId: string;
  rootId: string;
  corpusPath: string;
  rootRelativePath: string;
  contentHash: string | null;
  sizeBytes: number | null;
  isArchiveMember: boolean;
  archiveAncestry?: readonly string[];
  /** What the decoder established, or undefined when it never ran. */
  normalized?: {
    decodes: boolean;
    reason: string | null;
    byte_length: number;
    normalized_content_hash: string | null;
    token_count: number;
  };
  /** Identity of the decoded document, when one exists. */
  normalizedDocumentId?: string | null;
}

export interface BuildDocumentIndexInput {
  corpusSourceSnapshotId: string;
  corpusAnalysisId: string;
  decoderId: string;
  decoderVersion: string;
  artifacts: readonly DocumentIndexArtifactInput[];
}

/**
 * Why an artifact has no document.
 *
 * Kept as a closed vocabulary so the summary can group by it. "No decoder claimed
 * this extension" and "a decoder tried and the bytes were not text" are different
 * facts about a corpus, and a single `undecoded` count would hide which one an
 * operator is looking at.
 */
export const UNDECODED_REASON_NOT_ELIGIBLE = "no_decoder_claims_this_artifact";

function entryFor(
  artifact: DocumentIndexArtifactInput,
  decoderId: string,
  decoderVersion: string,
): NormalizedDocumentEntry {
  const normalized = artifact.normalized;
  const decoded = normalized?.decodes === true;
  return {
    artifact_id: artifact.artifactId,
    root_id: artifact.rootId,
    corpus_path: artifact.corpusPath,
    root_relative_path: artifact.rootRelativePath,
    content_hash: artifact.contentHash,
    normalized_document_id: artifact.normalizedDocumentId ?? null,
    decoder_id: decoderId,
    decoder_version: decoderVersion,
    decoded,
    undecoded_reason: decoded
      ? null
      : (normalized?.reason ?? UNDECODED_REASON_NOT_ELIGIBLE),
    byte_length: normalized?.byte_length ?? artifact.sizeBytes ?? null,
    token_count: decoded ? (normalized?.token_count ?? 0) : null,
    normalized_content_hash: decoded ? (normalized?.normalized_content_hash ?? null) : null,
    is_archive_member: artifact.isArchiveMember,
    archive_ancestry: [...(artifact.archiveAncestry ?? [])],
  };
}

/** Build the index. Ordering is by corpus path, then artifact id, both code-point. */
export function buildDocumentIndex(input: BuildDocumentIndexInput): DocumentIndex {
  const documents = input.artifacts
    .map((artifact) => entryFor(artifact, input.decoderId, input.decoderVersion))
    .sort(
      (a, b) => compareCodePoints(a.corpus_path, b.corpus_path)
        || compareCodePoints(a.artifact_id, b.artifact_id),
    );

  const distinct = new Set<string>();
  const reasons = new Map<string, number>();
  let decodedCount = 0;
  let tokens = 0;
  for (const document of documents) {
    if (document.decoded) {
      decodedCount += 1;
      tokens += document.token_count ?? 0;
      if (document.normalized_document_id !== null) distinct.add(document.normalized_document_id);
      continue;
    }
    const reason = document.undecoded_reason ?? UNDECODED_REASON_NOT_ELIGIBLE;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }

  return {
    schema: DOCUMENT_INDEX_SCHEMA,
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    decoder: { decoder_id: input.decoderId, decoder_version: input.decoderVersion },
    summary: {
      artifact_count: documents.length,
      decoded_count: decodedCount,
      undecoded_count: documents.length - decodedCount,
      distinct_document_count: distinct.size,
      archive_member_count: documents.filter((document) => document.is_archive_member).length,
      total_token_count: tokens,
      undecoded_by_reason: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => compareCodePoints(a.reason, b.reason)),
    },
    documents,
  };
}

/** Canonical bytes of a document index. */
export function renderDocumentIndex(index: DocumentIndex): string {
  return `${canonicalCorpusJson(index)}\n`;
}

/** The decoded documents only, keyed by artifact id, for a downstream pass. */
export function decodedDocumentsByArtifact(
  index: DocumentIndex,
): Map<string, NormalizedDocumentEntry> {
  const out = new Map<string, NormalizedDocumentEntry>();
  for (const document of index.documents) {
    if (document.decoded) out.set(document.artifact_id, document);
  }
  return out;
}
