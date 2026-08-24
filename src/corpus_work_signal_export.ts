// corpus_work_signal_export.ts — the complete machine payload, and its receipt.
//
// `document-signals.json` is a report. It states complete counts and lists a
// bounded, deterministic sample of the evidence behind them, because a corpus of
// ten thousand documents states more than a person will read and a file that
// grew without bound would be one nobody opens.
//
// That is the right shape for a report and the wrong shape for a contract. A
// downstream consumer asking "what did this corpus find" cannot be handed fifty
// of a hundred and thirty-seven records and a number saying there were more:
// it would have to either trust the count without the evidence, reconstruct the
// missing records from somewhere else, or read this package's internal cache.
// All three are worse than emitting the records.
//
// So the report stays a report, and this module emits the whole set beside it:
// one JSONL line per signal, never sampled, never truncated, with a manifest
// that says how many there are and hashes what was written. A consumer can prove
// it received exactly what was produced, and this package can prove it before
// publishing anything.
//
// Two hashes, because they answer different questions. `payload_artifact_hash`
// is over the exact bytes — it detects a byte that changed in transit.
// `payload_semantic_hash` is over the records — it is the same in every output
// directory on every machine, so two generations can be compared without
// comparing file paths.
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";
import { sha256TextPrefixed } from "./repository_model";

/** Schema of the complete payload. One record per line. */
export const DOCUMENT_WORK_SIGNALS_SCHEMA = "l9.document-work-signals/v1";
/** Schema of the payload's completeness and integrity receipt. */
export const DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA = "l9.document-work-signals-manifest/v1";

/** Where the payload and its manifest are written inside a generation. */
export const DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE = "document-work-signals.jsonl";
export const DOCUMENT_WORK_SIGNALS_MANIFEST_FILE = "document-work-signals.manifest.json";

/**
 * One structured document work signal, as a downstream consumer receives it.
 *
 * Every field is either something the consumer needs to resolve the claim
 * against the corpus — the artifact, the exact bytes, the decoding, the block —
 * or the claim itself. Nothing here names an output directory, a scratch path,
 * a cache location, a hostname or a clock: the same signal read from the same
 * bytes is the same record wherever it is written.
 */
export interface DocumentWorkSignalRecord {
  /** Stable across runs and output locations. Never derived from a path. */
  signal_id: string;
  /**
   * The artifact as the corpus identifies it.
   *
   * Resolves against `corpus-snapshot.json` and `document-index.json`.
   */
  artifact_id: string;
  /**
   * The same artifact as its root's Repository Model Packet identifies it.
   *
   * Two ids because there are two identity domains and a consumer works in one
   * of them: the corpus id addresses an artifact inside this corpus, and the
   * packet id addresses it inside the root's own bundle. A payload carrying only
   * the first would leave a Topology adapter — which reads packets — unable to
   * attach any of these claims to the artifact it already knows.
   */
  rmp_artifact_id: string;
  /** Corpus-relative, or a virtual `archive.zip!/member` locator. Never absolute. */
  source_path: string;
  format: string;
  /** Hash of the source bytes, not of the decoded text. */
  raw_content_hash: string | null;
  normalized_document_id: string | null;
  decoder_id: string;
  decoder_version: string;
  block_id: string;
  block_kind: string;
  /** The block's own coordinate. Its `kind` says which shape it is. */
  structured_locator: Record<string, unknown>;
  predicate: string;
  object: string;
  bounded_excerpt: string;
  evidence_class: string;
  authority: string;
  confidence: string;
  extractor_id: string;
  /** Version of the profile the extractor ran under. */
  extractor_profile_version: string;
}

export interface DocumentWorkSignalFormatCount {
  format: string;
  document_count: number;
  signal_count: number;
}

export interface DocumentWorkSignalPredicateCount {
  predicate: string;
  signal_count: number;
}

export interface DocumentWorkSignalManifest {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  /** Identity of the rules that read the blocks. */
  profile_id: string;
  profile_version: string;
  profile_hash: string;
  /** Generation-relative name of the payload this manifest describes. */
  payload_file: string;
  record_count: number;
  /** Distinct artifacts that stated at least one signal. */
  document_count: number;
  by_format: DocumentWorkSignalFormatCount[];
  by_predicate: DocumentWorkSignalPredicateCount[];
  /** Length in bytes of the exact emitted payload. */
  payload_byte_length: number;
  /** SHA-256 of the exact emitted UTF-8 bytes. */
  payload_artifact_hash: string;
  /** SHA-256 over the records themselves, independent of where they were written. */
  payload_semantic_hash: string;
}

/** The payload, its manifest, and the bytes of each. */
export interface DocumentWorkSignalExport {
  records: DocumentWorkSignalRecord[];
  manifest: DocumentWorkSignalManifest;
  payloadJsonl: string;
  manifestJson: string;
}

/** Reference to the payload, small enough to sit inside the snapshot. */
export interface DocumentWorkSignalsRef {
  schema: string;
  manifest_ref: string;
  payload_ref: string;
  record_count: number;
  payload_semantic_hash: string;
  payload_artifact_hash: string;
}

/**
 * Total order over signals.
 *
 * `signal_id` is last and is what makes the order total: everything before it
 * can legitimately repeat, and two signals identical in all of it would
 * otherwise sort non-deterministically. Ties there are impossible, because two
 * records agreeing on the id are the same record and are refused as duplicates.
 */
function compareRecords(
  left: DocumentWorkSignalRecord,
  right: DocumentWorkSignalRecord,
): number {
  return (
    compareCodePoints(left.artifact_id, right.artifact_id)
    || compareCodePoints(left.block_id, right.block_id)
    || compareCodePoints(left.predicate, right.predicate)
    || compareCodePoints(left.object, right.object)
    || compareCodePoints(left.signal_id, right.signal_id)
  );
}

/** One record, canonically rendered onto a single line. */
export function renderDocumentWorkSignalRecord(record: DocumentWorkSignalRecord): string {
  return canonicalCorpusJson(record, 0);
}

function tallyFormats(records: readonly DocumentWorkSignalRecord[]): DocumentWorkSignalFormatCount[] {
  const byFormat = new Map<string, { signals: number; documents: Set<string> }>();
  for (const record of records) {
    const entry = byFormat.get(record.format) ?? { signals: 0, documents: new Set<string>() };
    entry.signals += 1;
    entry.documents.add(record.artifact_id);
    byFormat.set(record.format, entry);
  }
  return [...byFormat.entries()]
    .map(([format, entry]) => ({
      format,
      document_count: entry.documents.size,
      signal_count: entry.signals,
    }))
    .sort((a, b) => compareCodePoints(a.format, b.format));
}

function tallyPredicates(
  records: readonly DocumentWorkSignalRecord[],
): DocumentWorkSignalPredicateCount[] {
  const byPredicate = new Map<string, number>();
  for (const record of records) {
    byPredicate.set(record.predicate, (byPredicate.get(record.predicate) ?? 0) + 1);
  }
  return [...byPredicate.entries()]
    .map(([predicate, signal_count]) => ({ predicate, signal_count }))
    .sort((a, b) => compareCodePoints(a.predicate, b.predicate));
}

export interface BuildDocumentWorkSignalExportInput {
  corpusSourceSnapshotId: string;
  corpusAnalysisId: string;
  profile: {
    profile_id: string;
    profile_version: string;
    profile_hash: string;
  };
  /** Every signal the run produced, in any order. */
  records: readonly DocumentWorkSignalRecord[];
}

/**
 * Build the complete payload and its manifest.
 *
 * Refuses a duplicate `signal_id` rather than collapsing it. Two records under
 * one id mean either that the identity formula is losing a distinction it must
 * keep or that a signal was produced twice; both are defects, and a payload that
 * silently deduplicated them would report a record count no consumer could
 * reconcile against the corpus.
 */
export function buildDocumentWorkSignalExport(
  input: BuildDocumentWorkSignalExportInput,
): DocumentWorkSignalExport {
  const records = [...input.records].sort(compareRecords);

  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.signal_id)) {
      throw new Error(
        `document-work-signals: duplicate signal_id ${record.signal_id} `
        + `(${record.source_path} ${record.predicate}); the payload must carry each signal once`,
      );
    }
    seen.add(record.signal_id);
  }

  // A trailing newline on every line, including the last: a JSONL reader that
  // splits on the separator then gets one empty trailing field rather than a
  // final record that looks truncated.
  const payloadJsonl = records.map((record) => `${renderDocumentWorkSignalRecord(record)}\n`).join("");

  const manifest: DocumentWorkSignalManifest = {
    schema: DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA,
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    profile_id: input.profile.profile_id,
    profile_version: input.profile.profile_version,
    profile_hash: input.profile.profile_hash,
    payload_file: DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE,
    record_count: records.length,
    document_count: new Set(records.map((record) => record.artifact_id)).size,
    by_format: tallyFormats(records),
    by_predicate: tallyPredicates(records),
    payload_byte_length: Buffer.byteLength(payloadJsonl, "utf8"),
    payload_artifact_hash: sha256TextPrefixed(payloadJsonl),
    // Over the records rather than the bytes, so a generation written to another
    // directory on another machine produces the same value.
    payload_semantic_hash: sha256TextPrefixed(
      canonicalCorpusJson({ schema: DOCUMENT_WORK_SIGNALS_SCHEMA, records }, 0),
    ),
  };

  return {
    records,
    manifest,
    payloadJsonl,
    manifestJson: `${canonicalCorpusJson(manifest)}\n`,
  };
}

/** The snapshot-sized reference to a payload. */
export function documentWorkSignalsRef(
  manifest: DocumentWorkSignalManifest,
): DocumentWorkSignalsRef {
  return {
    schema: DOCUMENT_WORK_SIGNALS_SCHEMA,
    manifest_ref: DOCUMENT_WORK_SIGNALS_MANIFEST_FILE,
    payload_ref: manifest.payload_file,
    record_count: manifest.record_count,
    payload_semantic_hash: manifest.payload_semantic_hash,
    payload_artifact_hash: manifest.payload_artifact_hash,
  };
}

export interface VerifyDocumentWorkSignalExportInput {
  manifest: DocumentWorkSignalManifest;
  /** The payload exactly as it was written or read back. */
  payloadJsonl: string;
  /** Artifact ids the corpus observed. A signal naming anything else is dangling. */
  knownArtifactIds: ReadonlySet<string>;
  /** Normalized document ids the corpus produced. */
  knownNormalizedDocumentIds: ReadonlySet<string>;
  /**
   * `signal_count` from the sampled report, which states the complete total.
   *
   * The two documents are built from one array and must agree; if they ever
   * disagree, one of them is lying about how much the corpus found, and which
   * one is not knowable from either document alone.
   */
  reportSignalCount: number;
}

/**
 * Read the payload back the way a consumer would, reporting what would not parse.
 *
 * The trailing newline is checked here rather than tolerated: a payload whose
 * last line is a record is a payload that was truncated mid-write, and a reader
 * splitting on newlines cannot tell that from a complete one.
 */
function readPayloadRecords(
  payloadJsonl: string,
): { records: DocumentWorkSignalRecord[]; problems: string[] } {
  const problems: string[] = [];
  const lines = payloadJsonl.length === 0 ? [] : payloadJsonl.split("\n");
  if (payloadJsonl.length > 0 && lines[lines.length - 1] !== "") {
    problems.push("payload does not end with a newline");
  }
  const bodies = lines.filter((line, index) => !(index === lines.length - 1 && line === ""));

  const records: DocumentWorkSignalRecord[] = [];
  for (const [index, line] of bodies.entries()) {
    if (line.length === 0) {
      problems.push(`payload line ${index + 1} is empty`);
      continue;
    }
    try {
      records.push(JSON.parse(line) as DocumentWorkSignalRecord);
    } catch (error) {
      problems.push(`payload line ${index + 1} is not valid JSON: ${(error as Error).message}`);
    }
  }
  return { records, problems };
}

/** The manifest's claims about the bytes, against the bytes. */
function checkPayloadAgainstManifest(
  manifest: DocumentWorkSignalManifest,
  payloadJsonl: string,
  records: readonly DocumentWorkSignalRecord[],
): string[] {
  const problems: string[] = [];
  if (records.length !== manifest.record_count) {
    problems.push(
      `manifest says ${manifest.record_count} record(s) and the payload carries ${records.length}`,
    );
  }
  const byteLength = Buffer.byteLength(payloadJsonl, "utf8");
  if (byteLength !== manifest.payload_byte_length) {
    problems.push(
      `manifest says ${manifest.payload_byte_length} byte(s) and the payload is ${byteLength}`,
    );
  }
  const artifactHash = sha256TextPrefixed(payloadJsonl);
  if (artifactHash !== manifest.payload_artifact_hash) {
    problems.push(
      `payload artifact hash ${artifactHash} does not match the manifest's `
      + `${manifest.payload_artifact_hash}`,
    );
  }
  if (records.length === manifest.record_count) {
    // Only worth computing when the record set parsed whole; over a short read it
    // would report a second failure with the same cause as the first.
    const semanticHashValue = sha256TextPrefixed(
      canonicalCorpusJson({ schema: DOCUMENT_WORK_SIGNALS_SCHEMA, records }, 0),
    );
    if (semanticHashValue !== manifest.payload_semantic_hash) {
      problems.push(
        `payload semantic hash ${semanticHashValue} does not match the manifest's `
        + `${manifest.payload_semantic_hash}`,
      );
    }
  }
  return problems;
}

/** Every record's own id, and the two ids it points at. */
function checkRecordIdentities(
  records: readonly DocumentWorkSignalRecord[],
  knownArtifactIds: ReadonlySet<string>,
  knownNormalizedDocumentIds: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.signal_id)) {
      problems.push(`duplicate signal_id ${record.signal_id}`);
    }
    seen.add(record.signal_id);
    if (!knownArtifactIds.has(record.artifact_id)) {
      problems.push(
        `signal ${record.signal_id} names artifact ${record.artifact_id}, which this corpus did not observe`,
      );
    }
    if (
      record.normalized_document_id !== null
      && !knownNormalizedDocumentIds.has(record.normalized_document_id)
    ) {
      problems.push(
        `signal ${record.signal_id} names normalized document ${record.normalized_document_id}, `
        + "which this corpus did not produce",
      );
    }
  }
  return problems;
}

/** A grouping that does not sum to the whole is a grouping that lost something. */
function checkGroupTotals(manifest: DocumentWorkSignalManifest): string[] {
  const problems: string[] = [];
  const formatTotal = manifest.by_format.reduce((sum, entry) => sum + entry.signal_count, 0);
  if (formatTotal !== manifest.record_count) {
    problems.push(
      `by_format totals ${formatTotal} and the manifest states ${manifest.record_count}`,
    );
  }
  const predicateTotal = manifest.by_predicate.reduce((sum, entry) => sum + entry.signal_count, 0);
  if (predicateTotal !== manifest.record_count) {
    problems.push(
      `by_predicate totals ${predicateTotal} and the manifest states ${manifest.record_count}`,
    );
  }
  return problems;
}

/**
 * Prove a payload is the complete set its manifest claims, before anything is
 * published.
 *
 * Every check here answers a question a consumer would otherwise have to take on
 * trust, and each returns a stated reason rather than a boolean: a validation
 * that fails without saying which record broke it sends a reader to the whole
 * file.
 *
 * The checks are separate functions and the order they run in is the order a
 * reader wants their answers: can this be read at all, is it the bytes the
 * manifest describes, does it agree with the report, does every record resolve,
 * and do the groupings account for the whole. Each returns its own problems, so
 * one failing check never hides the next.
 */
export function verifyDocumentWorkSignalExport(
  input: VerifyDocumentWorkSignalExportInput,
): string[] {
  const { manifest, payloadJsonl } = input;
  const { records, problems: readProblems } = readPayloadRecords(payloadJsonl);

  const reportProblems: string[] = [];
  if (manifest.record_count !== input.reportSignalCount) {
    reportProblems.push(
      `the sampled report states ${input.reportSignalCount} signal(s) and the complete `
      + `payload manifest states ${manifest.record_count}`,
    );
  }

  return [
    ...readProblems,
    ...checkPayloadAgainstManifest(manifest, payloadJsonl, records),
    ...reportProblems,
    ...checkRecordIdentities(records, input.knownArtifactIds, input.knownNormalizedDocumentIds),
    ...checkGroupTotals(manifest),
  ];
}
