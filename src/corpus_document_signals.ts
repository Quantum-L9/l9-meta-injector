// corpus_document_signals.ts — what the decoders read, and where it went.
//
// Coverage says how many documents were decoded. That is a necessary number and
// it is not a sufficient one, because a decoder can be wired to the scan, report
// a hundred percent coverage of the PDFs on a disk, and have contributed nothing
// to a single candidate — the text decoded into a record that no later layer
// read. A report of that shape looks like success and means nothing, so this
// file measures the other half: not only that the bytes were opened, but that
// what came out of them reached the analysis.
//
// Hence `analysis_participation`, and hence its `by_format` breakdown. "Eleven
// PDFs decoded, zero PDFs named by any candidate" is precisely the failure this
// artifact exists to make visible, and it is invisible in a coverage ratio.
//
// The locator inventory is the second claim. Every block carries a coordinate in
// its own format's terms — a page and an index for a PDF, a slide and a shape for
// a deck, a sheet and a cell reference for a spreadsheet, a cell index for a
// notebook — and never a line number invented for a binary file that has no
// lines. `locator_examples` prints real ones so the claim is checkable rather
// than asserted.
import { canonicalCorpusJson } from "./corpus_analysis";
import { compareCodePoints } from "./ordering";

/**
 * Schema of this projection.
 *
 * Renamed from `l9.corpus-document-signals/v1` when the document gained the
 * block-bound evidence records below. A reader that understood the old name was
 * reading a document of counts; this one carries claims and the coordinates they
 * were read at, which is a different contract rather than more of the same one.
 */
export const CORPUS_DOCUMENT_SIGNALS_SCHEMA = "l9.document-signals/v1";

/**
 * How many evidence records the document lists per format.
 *
 * The listing is a sample; the counts beside it are complete. A corpus of ten
 * thousand decoded documents states far more than a person will read, and a file
 * that grew without bound would be one nobody opens. What is never bounded is the
 * *count*: `signal_count` is every claim read, `listed_signal_count` is how many
 * appear below it, and their difference is stated rather than left to subtraction.
 */
export const MAX_LISTED_SIGNALS_PER_FORMAT = 50;

/** A count keyed by a name, sorted by name so the document is canonical. */
export interface NameCount {
  name: string;
  count: number;
}

/** One decoder's work over the corpus. */
export interface FormatSignal {
  format: string;
  decoder_id: string;
  decoder_version: string;
  /** Artifacts this decoder claimed. */
  eligible_count: number;
  /** Of those, the ones it turned into a normalized document. */
  decoded_count: number;
  /** Blocks produced across those documents. */
  block_count: number;
  /** Why the rest were refused, by the decoder's own reason code. */
  refusals: NameCount[];
  /** The locator kinds this format actually cited, in code-point order. */
  locator_kinds: string[];
}

/** Whether decoded text reached the analysis, or only the coverage report. */
export interface AnalysisParticipation {
  decoded_document_count: number;
  /** Decoded documents that produced at least one interpretation assertion. */
  interpreted_count: number;
  /** Decoded documents that entered lexical analysis. */
  lexically_analyzed_count: number;
  /** Decoded documents named by at least one candidate of any kind. */
  candidate_member_count: number;
  /**
   * The same participation counts, per format.
   *
   * A corpus-wide total can be carried entirely by the Markdown in it. Split by
   * format, a decoder that opens documents nothing downstream reads has nowhere
   * to hide.
   */
  by_format: {
    format: string;
    decoded_count: number;
    interpreted_count: number;
    lexically_analyzed_count: number;
    candidate_member_count: number;
  }[];
}

/** A real locator, printed so the coordinate claim can be read off the report. */
export interface LocatorExample {
  format: string;
  block_id: string;
  kind: string;
  locator: Record<string, unknown>;
}

/**
 * One claim a decoded document made, with everything needed to check it.
 *
 * A reader holding this record can find the artifact by id, confirm the bytes by
 * hash, identify which decoding of those bytes was read, open the block by id,
 * and go to the coordinate the block's own format has. Nothing here is a line
 * number: a Word document has none, and a plausible one would make this record
 * look checkable while being uncheckable.
 */
export interface DocumentSignalRecord {
  artifact_id: string;
  source_path: string;
  format: string;
  /** Hash of the source bytes, not of the decoded text. */
  raw_content_hash: string | null;
  normalized_document_id: string | null;
  decoder_id: string;
  decoder_version: string;
  block_id: string;
  block_kind: string;
  /** The block's own coordinate. Its `kind` field says which shape it is. */
  structured_locator: Record<string, unknown>;
  predicate: string;
  object: string;
  bounded_excerpt: string;
  evidence_class: string;
  confidence: string;
  extractor_id: string;
}

/** What the decoded documents of one format were found to state. */
export interface FormatSignalEvidence {
  format: string;
  /** Documents of this format that stated at least one claim. */
  documents_with_signals: number;
  /** Every claim read from this format. Complete, never sampled. */
  signal_count: number;
  /** Claims listed in `records` below. */
  listed_signal_count: number;
  /** `signal_count - listed_signal_count`, stated rather than implied. */
  omitted_signal_count: number;
  /** Which predicates this format produced, and how many of each. */
  predicates: NameCount[];
  records: DocumentSignalRecord[];
}

/** The whole block-bound evidence layer, by format. */
export interface DocumentSignalEvidence {
  /** Identity of the rules that read the blocks. */
  profile_id: string;
  profile_version: string;
  profile_hash: string;
  extractor_id: string;
  document_count: number;
  signal_count: number;
  predicates: NameCount[];
  by_format: FormatSignalEvidence[];
}

export interface CorpusDocumentSignals {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  /** `id@version` for every decoder in the registry this run used. */
  decoder_profiles: string[];
  formats: FormatSignal[];
  block_kinds: NameCount[];
  locator_kinds: NameCount[];
  analysis_participation: AnalysisParticipation;
  locator_examples: LocatorExample[];
  /** What the decoded documents actually said, bound to where they said it. */
  block_signals: DocumentSignalEvidence;
}

/** One artifact as this builder needs it. */
export interface DocumentSignalInput {
  virtual_source_id: string;
  format: string;
  decoder_id: string;
  decoder_version: string;
  decoded: boolean;
  /** The decoder's refusal reason when `decoded` is false. */
  reason: string | null;
  blocks: readonly { block_id: string; kind: string; locator: Record<string, unknown> }[];
}

/** One block-bound claim, as the scan hands it over. */
export interface DocumentSignalAssertionInput {
  artifact_id: string;
  source_path: string;
  format: string;
  raw_content_hash: string | null;
  normalized_document_id: string | null;
  decoder_id: string;
  decoder_version: string;
  block_id: string;
  block_kind: string;
  structured_locator: Record<string, unknown>;
  predicate: string;
  object: string;
  bounded_excerpt: string;
  evidence_class: string;
  confidence: string;
  extractor_id: string;
}

export interface DocumentSignalsInput {
  corpusSourceSnapshotId: string;
  corpusAnalysisId: string;
  decoderProfiles: readonly string[];
  /** Identity of the block-reading rules, so a claim names the rules that read it. */
  blockProfile: {
    profile_id: string;
    profile_version: string;
    profile_hash: string;
    extractor_id: string;
  };
  /** Every claim read out of a decoded document's blocks, in any order. */
  blockSignals: readonly DocumentSignalAssertionInput[];
  documents: readonly DocumentSignalInput[];
  /** Artifact ids that produced at least one interpretation assertion. */
  interpreted: ReadonlySet<string>;
  /** Artifact ids that entered lexical analysis. */
  lexicallyAnalyzed: ReadonlySet<string>;
  /** Artifact ids named by at least one candidate. */
  candidateMembers: ReadonlySet<string>;
}

function tally(counts: ReadonlyMap<string, number>): NameCount[] {
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => compareCodePoints(a.name, b.name));
}

function bump(counts: Map<string, number>, key: string): void {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/** Build the document-signals projection for one run. */
export function buildCorpusDocumentSignals(input: DocumentSignalsInput): CorpusDocumentSignals {
  interface Accumulator {
    format: string;
    decoderId: string;
    decoderVersion: string;
    eligible: number;
    decoded: number;
    blocks: number;
    refusals: Map<string, number>;
    locatorKinds: Set<string>;
    interpreted: number;
    lexical: number;
    candidates: number;
  }
  const byFormat = new Map<string, Accumulator>();
  const blockKinds = new Map<string, number>();
  const locatorKinds = new Map<string, number>();
  const examples = new Map<string, LocatorExample>();

  for (const document of input.documents) {
    let accumulator = byFormat.get(document.format);
    if (accumulator === undefined) {
      accumulator = {
        format: document.format,
        decoderId: document.decoder_id,
        decoderVersion: document.decoder_version,
        eligible: 0,
        decoded: 0,
        blocks: 0,
        refusals: new Map(),
        locatorKinds: new Set(),
        interpreted: 0,
        lexical: 0,
        candidates: 0,
      };
      byFormat.set(document.format, accumulator);
    }
    accumulator.eligible += 1;
    if (!document.decoded) {
      bump(accumulator.refusals, document.reason ?? "unknown");
      continue;
    }
    accumulator.decoded += 1;
    accumulator.blocks += document.blocks.length;
    if (input.interpreted.has(document.virtual_source_id)) accumulator.interpreted += 1;
    if (input.lexicallyAnalyzed.has(document.virtual_source_id)) accumulator.lexical += 1;
    if (input.candidateMembers.has(document.virtual_source_id)) accumulator.candidates += 1;

    for (const block of document.blocks) {
      bump(blockKinds, block.kind);
      const kind = String(block.locator.kind ?? "unknown");
      bump(locatorKinds, kind);
      accumulator.locatorKinds.add(kind);
      // One example per format-and-locator-kind pair, chosen by the lowest
      // block id so the choice is a property of the corpus rather than of the
      // order the filesystem happened to be walked in.
      const key = `${document.format}\u001f${kind}`;
      const existing = examples.get(key);
      if (existing === undefined || compareCodePoints(block.block_id, existing.block_id) < 0) {
        examples.set(key, {
          format: document.format,
          block_id: block.block_id,
          kind,
          locator: block.locator,
        });
      }
    }
  }

  const accumulators = [...byFormat.values()]
    .sort((a, b) => compareCodePoints(a.format, b.format));

  const decodedTotal = accumulators.reduce((sum, entry) => sum + entry.decoded, 0);

  return {
    schema: CORPUS_DOCUMENT_SIGNALS_SCHEMA,
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    decoder_profiles: [...input.decoderProfiles].sort(compareCodePoints),
    formats: accumulators.map((entry) => ({
      format: entry.format,
      decoder_id: entry.decoderId,
      decoder_version: entry.decoderVersion,
      eligible_count: entry.eligible,
      decoded_count: entry.decoded,
      block_count: entry.blocks,
      refusals: tally(entry.refusals),
      locator_kinds: [...entry.locatorKinds].sort(compareCodePoints),
    })),
    block_kinds: tally(blockKinds),
    locator_kinds: tally(locatorKinds),
    analysis_participation: {
      decoded_document_count: decodedTotal,
      interpreted_count: accumulators.reduce((sum, entry) => sum + entry.interpreted, 0),
      lexically_analyzed_count: accumulators.reduce((sum, entry) => sum + entry.lexical, 0),
      candidate_member_count: accumulators.reduce((sum, entry) => sum + entry.candidates, 0),
      by_format: accumulators.map((entry) => ({
        format: entry.format,
        decoded_count: entry.decoded,
        interpreted_count: entry.interpreted,
        lexically_analyzed_count: entry.lexical,
        candidate_member_count: entry.candidates,
      })),
    },
    locator_examples: [...examples.values()].sort((a, b) => {
      const byFormatName = compareCodePoints(a.format, b.format);
      if (byFormatName !== 0) return byFormatName;
      return compareCodePoints(a.kind, b.kind);
    }),
    block_signals: buildBlockSignalEvidence(input),
  };
}

/** Total order over evidence records, so the listing never depends on run order. */
function compareRecords(left: DocumentSignalRecord, right: DocumentSignalRecord): number {
  return (
    compareCodePoints(left.source_path, right.source_path)
    || compareCodePoints(left.block_id, right.block_id)
    || compareCodePoints(left.predicate, right.predicate)
    || compareCodePoints(left.object, right.object)
  );
}

function toRecord(signal: DocumentSignalAssertionInput): DocumentSignalRecord {
  return {
    artifact_id: signal.artifact_id,
    source_path: signal.source_path,
    format: signal.format,
    raw_content_hash: signal.raw_content_hash,
    normalized_document_id: signal.normalized_document_id,
    decoder_id: signal.decoder_id,
    decoder_version: signal.decoder_version,
    block_id: signal.block_id,
    block_kind: signal.block_kind,
    structured_locator: signal.structured_locator,
    predicate: signal.predicate,
    object: signal.object,
    bounded_excerpt: signal.bounded_excerpt,
    evidence_class: signal.evidence_class,
    confidence: signal.confidence,
    extractor_id: signal.extractor_id,
  };
}

function buildBlockSignalEvidence(input: DocumentSignalsInput): DocumentSignalEvidence {
  interface FormatAccumulator {
    format: string;
    documents: Set<string>;
    predicates: Map<string, number>;
    records: DocumentSignalRecord[];
  }
  const byFormat = new Map<string, FormatAccumulator>();
  const predicates = new Map<string, number>();
  const documents = new Set<string>();

  for (const signal of input.blockSignals) {
    documents.add(signal.artifact_id);
    bump(predicates, signal.predicate);
    let accumulator = byFormat.get(signal.format);
    if (accumulator === undefined) {
      accumulator = {
        format: signal.format,
        documents: new Set(),
        predicates: new Map(),
        records: [],
      };
      byFormat.set(signal.format, accumulator);
    }
    accumulator.documents.add(signal.artifact_id);
    bump(accumulator.predicates, signal.predicate);
    accumulator.records.push(toRecord(signal));
  }

  return {
    profile_id: input.blockProfile.profile_id,
    profile_version: input.blockProfile.profile_version,
    profile_hash: input.blockProfile.profile_hash,
    extractor_id: input.blockProfile.extractor_id,
    document_count: documents.size,
    signal_count: input.blockSignals.length,
    predicates: tally(predicates),
    by_format: [...byFormat.values()]
      .sort((a, b) => compareCodePoints(a.format, b.format))
      .map((entry) => {
        // Sorted before slicing, so the listed sample is the same sample on every
        // run over the same corpus rather than whichever records arrived first.
        const sorted = [...entry.records].sort(compareRecords);
        const listed = sorted.slice(0, MAX_LISTED_SIGNALS_PER_FORMAT);
        return {
          format: entry.format,
          documents_with_signals: entry.documents.size,
          signal_count: sorted.length,
          listed_signal_count: listed.length,
          omitted_signal_count: sorted.length - listed.length,
          predicates: tally(entry.predicates),
          records: listed,
        };
      }),
  };
}

/** Canonical bytes of the document-signals projection. */
export function renderCorpusDocumentSignals(signals: CorpusDocumentSignals): string {
  return `${canonicalCorpusJson(signals)}\n`;
}
