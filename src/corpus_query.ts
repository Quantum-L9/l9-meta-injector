// corpus_query.ts — one precise question, asked of one completed generation.
//
// A corpus run writes everything it found into `generations/<id>/` and switches
// `CURRENT.json` to it. A developer holding that output has every record they
// need and no way to ask for the three they want: which documents record an
// unresolved question about routing, what constraints the transport spec states,
// which decisions the WIP proposal declared. This module answers such questions
// by reading the records the run already wrote, verifying them first, and
// returning them unchanged.
//
// Three boundaries hold throughout.
//
// It is a view, not a store. Nothing is indexed, cached, normalized or persisted;
// a query is a streaming pass over the generation's own JSONL and JSON, and two
// queries over one generation return the same bytes. There is no ranking, no
// fuzzy match, no embedding and no model: a filter either matches a recorded
// field literally or it does not.
//
// It trusts nothing it has not checked. `CURRENT.json` is resolved once and the
// generation it names is pinned for the whole query. Every file read is named by
// that pointer, sits inside that generation directory (symlinks are refused), and
// hashes to what the pointer recorded. The work-signal and architecture-evidence
// payloads are verified against their manifests with the same functions the
// scan used before publishing them. A generation that fails any of this yields
// an `invalid` outcome and no results, never a partial answer that looks whole.
//
// It returns evidence, not conclusions. A record carries the identities, the
// coordinate, the bounded excerpt and the classification the generation wrote.
// It never says which document is canonical, which declaration wins, or whether
// a decision was ever accepted — a `decision_statement` from a WIP proposal comes
// back exactly as source-declared, beside the WIP status the document declared.
import * as fs from "node:fs";
import * as path from "node:path";
import { canonicalCorpusJson } from "./corpus_analysis";
import type {
  ArchitectureEvidenceManifest,
  ArchitectureEvidenceRecord,
} from "./corpus_architecture_evidence";
import {
  ARCHITECTURE_DOCUMENT_ROLES,
  ARCHITECTURE_EVIDENCE_MANIFEST_FILE,
  ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA,
  ARCHITECTURE_EVIDENCE_PAYLOAD_FILE,
  ARCHITECTURE_EVIDENCE_SCHEMA,
  type ArchitectureDocumentRole,
  verifyArchitectureEvidenceExport,
} from "./corpus_architecture_evidence";
import type { CorpusDocumentSignals } from "./corpus_document_signals";
import { CORPUS_DOCUMENT_SIGNALS_SCHEMA } from "./corpus_document_signals";
import type { DocumentIndex, NormalizedDocumentEntry } from "./corpus_documents";
import { DOCUMENT_INDEX_SCHEMA } from "./corpus_documents";
import type { CorpusCurrent } from "./corpus_publish";
import { CORPUS_CURRENT_SCHEMA, readCorpusCurrent } from "./corpus_publish";
import type { CorpusSnapshot, CorpusVerification } from "./corpus_snapshot";
import { CORPUS_SNAPSHOT_SCHEMA } from "./corpus_snapshot";
import type {
  DocumentWorkSignalManifest,
  DocumentWorkSignalRecord,
} from "./corpus_work_signal_export";
import {
  DOCUMENT_WORK_SIGNALS_MANIFEST_FILE,
  DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA,
  DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE,
  DOCUMENT_WORK_SIGNALS_SCHEMA,
  verifyDocumentWorkSignalExport,
} from "./corpus_work_signal_export";
import { ARCHITECTURE_STATEMENT_CLASSES } from "./extractors/architecture_statements";
import { MAX_EXCERPT_LENGTH } from "./interpretation";
import { compareCodePoints } from "./ordering";
import type { RepositoryModelAssertionRecord, RepositoryModelPacket } from "./repository_model";
import {
  REPOSITORY_MODEL_PACKET_TYPE,
  repositoryModelArtifactId,
  sha256TextPrefixed,
  validateRepositoryModelPacket,
} from "./repository_model";

/** Schema of the one response this module renders. */
export const CORPUS_EVIDENCE_QUERY_SCHEMA = "l9.corpus-evidence-query/v1";

/** Result ceiling a caller may ask for; a larger answer needs a narrower question. */
export const MAX_QUERY_LIMIT = 500;
export const DEFAULT_QUERY_LIMIT = 50;
/** Longest excerpt returned, in UTF-8 bytes. The source bound is characters; this is the wire bound. */
export const DEFAULT_MAX_EXCERPT_BYTES = 1024;

/**
 * Where a result came from inside the generation.
 *
 * `repository_model_packet` is the per-root packet's artifact-scoped assertions:
 * the line-cited work signals of text documents, which the scan files in the
 * packet rather than in the JSONL payload (ADR-043). A query that read only the
 * JSONL would answer "which documents say they are WIP" with every Word document
 * and no Markdown one.
 */
export const EVIDENCE_SOURCES = [
  "architecture_evidence",
  "document_work_signals",
  "repository_model_packet",
] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

export const QUERY_OUTCOMES = [
  "ok",
  "empty",
  "incomplete",
  "unavailable",
  "unsupported",
  "invalid",
] as const;
export type QueryOutcome = (typeof QUERY_OUTCOMES)[number];

/** The evidence-age statement every response carries. A recorded verification is history. */
export const EVIDENCE_AGE_STATEMENT =
  "Every record describes the bytes the generation observed when it ran. The verification " +
  "class is the one that run recorded; nothing here re-reads the source files, so a " +
  "fully_verified snapshot is evidence of what the files held then, not proof they are " +
  "unchanged now, and a cached_unchanged_assumption snapshot was never byte-verified.";

export const TRUNCATION_STATEMENT =
  "More records matched than the limit returns. The returned set is the first of the " +
  "deterministic order; narrow the query (root, artifact, predicate, class, text) rather " +
  "than paging.";

export interface EvidenceQueryInput {
  /** The corpus output root holding `CURRENT.json` and `generations/`. */
  outDir: string;
  /** A root key or root id in the pinned snapshot. */
  root?: string;
  /** A corpus artifact id (`vsrc:`), a packet artifact id (`artifact:`) or a corpus path (`Root::path`). */
  artifact?: string;
  /** Exact predicate, e.g. `work.status`. Architecture-evidence records carry none. */
  predicate?: string;
  /** Exact architecture statement class. Only `architecture_evidence` records carry one. */
  statementClass?: string;
  /** Literal, case-sensitive substring over the recorded value and excerpt. */
  text?: string;
  /** A `work.kind` value the document must have declared (any of its declarations). */
  kind?: string;
  /** A `work.status` value the document must have declared (any of its declarations). */
  status?: string;
  /** Restrict to one source. */
  source?: EvidenceSource;
  /**
   * Only architecture-evidence records whose document holds this selection role
   * (ADR-090). Other sources carry no role and are not returned. Callers that
   * cannot be type-checked (the CLI) may still pass any string; an unknown role
   * is answered `unsupported` at run time.
   */
  role?: ArchitectureDocumentRole;
  /**
   * Only architecture-evidence records the selection profile marked selected.
   * Every other record stays in the generation; this narrows the answer only.
   */
  selectedOnly?: boolean;
  limit?: number;
  maxExcerptBytes?: number;
}

/** A declaration the document made about itself, by the assertion that made it. */
export interface DeclarationRef {
  object: string;
  assertion_id: string;
}

/**
 * One evidence record, as the generation wrote it, with the identities a reader
 * needs to resolve it. Fields are carried under the names their source uses:
 * `structured_locator` and `block_id` from the JSONL payloads, `source_range`
 * from a packet assertion. Neither is translated into the other.
 */
export interface EvidenceQueryResult {
  source: EvidenceSource;
  /** `evidence_id`, `signal_id` or `assertion_id`, as the source names it. */
  record_id: string;
  root_id: string;
  root_key: string;
  artifact_id: string;
  rmp_artifact_id: string;
  corpus_path: string;
  source_path: string;
  format: string | null;
  normalized_document_id: string | null;
  raw_content_hash: string | null;
  predicate: string | null;
  statement_class: string | null;
  /** The recorded object or declared text. */
  value: string;
  value_truncated_at_source: boolean;
  structured_locator: Record<string, unknown> | null;
  source_range: { start_line: number; end_line: number } | null;
  block_id: string | null;
  block_kind: string | null;
  decoder_id: string | null;
  bounded_excerpt: string;
  /** True when the generation itself cut the excerpt at its bound. */
  excerpt_truncated_at_source: boolean;
  /** True when this query cut the excerpt at `max_excerpt_bytes`. */
  excerpt_cut_by_query: boolean;
  evidence_class: string;
  authority: string;
  confidence: string | null;
  extractor_id: string;
  epistemic_class: string;
  authority_verified: false;
  /** Every `work.kind` and `work.status` the document declared, contradictions included. */
  document_declarations: { kinds: DeclarationRef[]; statuses: DeclarationRef[] };
  /** Carried verbatim for architecture-evidence records; null otherwise. */
  selection: ArchitectureEvidenceRecord["selection"] | null;
  recognition: ArchitectureEvidenceRecord["recognition"] | null;
}

export interface EvidenceSourceStatus {
  source: EvidenceSource;
  schema: string;
  status: "verified" | "not_run" | "refused";
  record_count: number | null;
  problems: string[];
}

export interface EvidenceQueryResponse {
  schema: string;
  query: {
    root: string | null;
    artifact: string | null;
    predicate: string | null;
    statement_class: string | null;
    text: string | null;
    kind: string | null;
    status: string | null;
    source: EvidenceSource | null;
    /** Present only when the caller asked for a role; a default query's echo is unchanged. */
    role?: string;
    /** Present only when the caller asked for selected records only. */
    selected_only?: true;
    limit: number;
    max_excerpt_bytes: number;
  };
  generation: {
    generation_id: string;
    /** Output-relative. No absolute path ever appears in a response. */
    generation_ref: string;
    corpus_id: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    corpus_status: string;
    missing_root_ids: string[];
    verification: CorpusVerification;
    evidence_age_statement: string;
  } | null;
  sources: EvidenceSourceStatus[];
  outcome: QueryOutcome;
  /** Records matching the query across every verified source. Null when nothing could be trusted. */
  match_count: number | null;
  returned_count: number;
  truncated: boolean;
  truncation_statement: string | null;
  results: EvidenceQueryResult[];
  diagnostics: { code: string; severity: "info" | "warning" | "error"; message: string }[];
}

// ───────────────────────────── the pinned generation ─────────────────────────────

class QueryRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * One generation, resolved once and read through its own pointer.
 *
 * Every read goes through `text()`: the path must be one `CURRENT.json` names,
 * must resolve inside the generation directory after symlinks (a link out of the
 * directory is an escape, not a file), and must hash to what the pointer recorded.
 */
class PinnedGeneration {
  private readonly hashes: Map<string, string>;
  private readonly realDirectory: string;

  constructor(
    readonly outDir: string,
    readonly current: CorpusCurrent,
    readonly directory: string,
  ) {
    // `readCorpusCurrent` checks the pointer's schema and ids, not its file list.
    // A pointer with no list, or a list entry without a path and a hash, cannot
    // vouch for anything and is refused as malformed rather than crashed on.
    const files: unknown = current.files;
    if (
      !Array.isArray(files) ||
      files.some(
        (file) =>
          file === null ||
          typeof file !== "object" ||
          typeof (file as { path?: unknown }).path !== "string" ||
          typeof (file as { content_hash?: unknown }).content_hash !== "string",
      )
    ) {
      throw new QueryRefusal(
        "query.pointer_malformed",
        "CURRENT.json does not carry a well-formed file list (each entry needs a path and a content_hash)",
      );
    }
    this.hashes = new Map(current.files.map((file) => [file.path, file.content_hash]));
    this.realDirectory = fs.realpathSync(directory);
    const realOut = fs.realpathSync(outDir);
    if (this.realDirectory !== realOut && !this.realDirectory.startsWith(realOut + path.sep)) {
      throw new QueryRefusal(
        "query.generation_outside_output",
        `CURRENT.json names generation '${current.generation_ref}', which resolves outside the output directory`,
      );
    }
  }

  names(relative: string): boolean {
    return this.hashes.has(relative);
  }

  text(relative: string): string {
    const expected = this.hashes.get(relative);
    if (expected === undefined) {
      throw new QueryRefusal(
        "query.file_not_in_generation",
        `CURRENT.json does not name '${relative}'`,
      );
    }
    const segments = relative.split("/");
    if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
      throw new QueryRefusal(
        "query.path_traversal",
        `'${relative}' is not a plain generation-relative path`,
      );
    }
    const absolute = path.join(this.directory, ...segments);
    let real: string;
    try {
      if (fs.lstatSync(absolute).isSymbolicLink()) {
        throw new QueryRefusal(
          "query.symlink_refused",
          `'${relative}' is a symbolic link and was not followed`,
        );
      }
      real = fs.realpathSync(absolute);
    } catch (error) {
      if (error instanceof QueryRefusal) throw error;
      throw new QueryRefusal(
        "query.file_missing",
        `'${relative}' is named by CURRENT.json and is not present`,
      );
    }
    if (!real.startsWith(this.realDirectory + path.sep)) {
      throw new QueryRefusal(
        "query.path_escape",
        `'${relative}' resolves outside the generation directory`,
      );
    }
    const bytes = fs.readFileSync(real, "utf8");
    const actual = sha256TextPrefixed(bytes);
    if (actual !== expected) {
      throw new QueryRefusal(
        "query.file_hash_mismatch",
        `'${relative}' hashes to ${actual.slice(0, 19)}… and CURRENT.json recorded ${expected.slice(0, 19)}…`,
      );
    }
    return bytes;
  }

  json<T>(relative: string, schema: string): T {
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.text(relative));
    } catch (error) {
      if (error instanceof QueryRefusal) throw error;
      throw new QueryRefusal("query.file_not_json", `'${relative}' is not valid JSON`);
    }
    const declared = (parsed as { schema?: unknown } | null)?.schema;
    if (declared !== schema) {
      throw new QueryRefusal(
        "query.schema_mismatch",
        `'${relative}' declares schema '${String(declared)}'; this query reads '${schema}'`,
      );
    }
    return parsed as T;
  }
}

/** Resolve `CURRENT.json` once. Everything after this reads the generation it named. */
function pinGeneration(outDir: string): PinnedGeneration {
  const resolvedOut = path.resolve(outDir);
  const current = readCorpusCurrent(resolvedOut);
  if (current === null) {
    throw new QueryRefusal(
      "query.no_generation",
      `no readable ${CORPUS_CURRENT_SCHEMA} pointer under the output directory; nothing has been published there`,
    );
  }
  const segments = current.generation_ref.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new QueryRefusal(
      "query.path_traversal",
      "CURRENT.json names a generation_ref that is not a plain relative path",
    );
  }
  const directory = path.join(resolvedOut, ...segments);
  if (!fs.existsSync(directory)) {
    throw new QueryRefusal(
      "query.generation_missing",
      `generation '${current.generation_ref}' is not present`,
    );
  }
  return new PinnedGeneration(resolvedOut, current, directory);
}

// ───────────────────────────── reading the sources ─────────────────────────────

function parseJsonl<T>(text: string, name: string): T[] {
  const lines = text.length === 0 ? [] : text.split("\n");
  if (text.length > 0 && lines[lines.length - 1] !== "") {
    throw new QueryRefusal("query.payload_truncated", `${name} does not end with a newline`);
  }
  return lines
    .filter((line, index) => !(index === lines.length - 1 && line === ""))
    .map((line, index) => {
      try {
        return JSON.parse(line) as T;
      } catch {
        throw new QueryRefusal(
          "query.payload_not_json",
          `${name} line ${index + 1} is not valid JSON`,
        );
      }
    });
}

interface LoadedGeneration {
  pinned: PinnedGeneration;
  snapshot: CorpusSnapshot;
  index: DocumentIndex;
  signals: CorpusDocumentSignals;
  workSignals: DocumentWorkSignalRecord[];
  architecture: ArchitectureEvidenceRecord[] | null;
  packets: { root_id: string; root_key: string; packet: RepositoryModelPacket }[];
  sources: EvidenceSourceStatus[];
}

/**
 * Read and verify every source the query may answer from.
 *
 * Verification is the same the scan performed before publishing — the payload
 * verifiers are imported, not reimplemented — plus the two checks only a reader
 * can make: that the bytes on disk are the bytes the pointer recorded, and that
 * each document agrees with the snapshot about which corpus it belongs to.
 */
function loadGeneration(pinned: PinnedGeneration): LoadedGeneration {
  const snapshot = pinned.json<CorpusSnapshot>("corpus-snapshot.json", CORPUS_SNAPSHOT_SCHEMA);
  const index = pinned.json<DocumentIndex>("document-index.json", DOCUMENT_INDEX_SCHEMA);
  const signals = pinned.json<CorpusDocumentSignals>(
    "document-signals.json",
    CORPUS_DOCUMENT_SIGNALS_SCHEMA,
  );
  const sameCorpus = (
    name: string,
    document: { corpus_source_snapshot_id: string; corpus_analysis_id: string },
  ): void => {
    if (
      document.corpus_source_snapshot_id !== snapshot.corpus_source_snapshot_id ||
      document.corpus_analysis_id !== snapshot.analysis.corpus_analysis_id
    ) {
      throw new QueryRefusal(
        "query.corpus_mismatch",
        `${name} names a different corpus than corpus-snapshot.json`,
      );
    }
  };
  sameCorpus("document-index.json", index);
  sameCorpus("document-signals.json", signals);

  const knownArtifactIds = new Set(
    snapshot.artifacts.map((artifact) => artifact.virtual_source_id),
  );
  const knownNormalizedDocumentIds = new Set(
    index.documents
      .map((entry) => entry.normalized_document_id)
      .filter((id): id is string => id !== null),
  );
  const sources: EvidenceSourceStatus[] = [];

  // Work signals: required in every generation this query reads.
  const workManifest = pinned.json<DocumentWorkSignalManifest>(
    DOCUMENT_WORK_SIGNALS_MANIFEST_FILE,
    DOCUMENT_WORK_SIGNALS_MANIFEST_SCHEMA,
  );
  sameCorpus(DOCUMENT_WORK_SIGNALS_MANIFEST_FILE, workManifest);
  const workPayload = pinned.text(DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE);
  const workProblems = verifyDocumentWorkSignalExport({
    manifest: workManifest,
    payloadJsonl: workPayload,
    knownArtifactIds,
    knownNormalizedDocumentIds,
    reportSignalCount: signals.block_signals.signal_count,
  });
  const workRef = snapshot.document_work_signals;
  if (
    workRef !== undefined &&
    (workRef.payload_artifact_hash !== workManifest.payload_artifact_hash ||
      workRef.payload_semantic_hash !== workManifest.payload_semantic_hash ||
      workRef.record_count !== workManifest.record_count)
  ) {
    workProblems.push("the snapshot's document_work_signals reference does not match the manifest");
  }
  if (workProblems.length > 0) {
    throw new QueryRefusal(
      "query.work_signals_refused",
      `${DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE} failed verification: ${workProblems.join("; ")}`,
    );
  }
  const workSignals = parseJsonl<DocumentWorkSignalRecord>(
    workPayload,
    DOCUMENT_WORK_SIGNALS_PAYLOAD_FILE,
  );
  sources.push({
    source: "document_work_signals",
    schema: DOCUMENT_WORK_SIGNALS_SCHEMA,
    status: "verified",
    record_count: workSignals.length,
    problems: [],
  });

  // Architecture evidence: opt-in, so absent is a state rather than a failure.
  let architecture: ArchitectureEvidenceRecord[] | null = null;
  if (
    snapshot.architecture_evidence !== undefined ||
    pinned.names(ARCHITECTURE_EVIDENCE_PAYLOAD_FILE)
  ) {
    const manifest = pinned.json<ArchitectureEvidenceManifest>(
      ARCHITECTURE_EVIDENCE_MANIFEST_FILE,
      ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA,
    );
    sameCorpus(ARCHITECTURE_EVIDENCE_MANIFEST_FILE, manifest);
    const payload = pinned.text(ARCHITECTURE_EVIDENCE_PAYLOAD_FILE);
    const problems = verifyArchitectureEvidenceExport({
      manifest,
      payloadJsonl: payload,
      knownArtifactIds,
      knownNormalizedDocumentIds,
    });
    const ref = snapshot.architecture_evidence;
    if (ref === undefined) {
      problems.push("the payload is present but the snapshot does not reference it");
    } else if (
      ref.payload_artifact_hash !== manifest.payload_artifact_hash ||
      ref.payload_semantic_hash !== manifest.payload_semantic_hash ||
      ref.record_count !== manifest.record_count
    ) {
      problems.push("the snapshot's architecture_evidence reference does not match the manifest");
    }
    if (problems.length > 0) {
      throw new QueryRefusal(
        "query.architecture_evidence_refused",
        `${ARCHITECTURE_EVIDENCE_PAYLOAD_FILE} failed verification: ${problems.join("; ")}`,
      );
    }
    architecture = parseJsonl<ArchitectureEvidenceRecord>(
      payload,
      ARCHITECTURE_EVIDENCE_PAYLOAD_FILE,
    );
    sources.push({
      source: "architecture_evidence",
      schema: ARCHITECTURE_EVIDENCE_SCHEMA,
      status: "verified",
      record_count: architecture.length,
      problems: [],
    });
  } else {
    sources.push({
      source: "architecture_evidence",
      schema: ARCHITECTURE_EVIDENCE_SCHEMA,
      status: "not_run",
      record_count: null,
      problems: ["the generation was produced without --architecture-evidence"],
    });
  }

  // Per-root packets: each must be the packet the snapshot says the root produced.
  const packets: LoadedGeneration["packets"] = [];
  for (const root of snapshot.roots) {
    if (root.observation_status !== "observed" || root.bundle_ref === null) continue;
    const relative = `${root.bundle_ref}/packet.json`;
    let packet: RepositoryModelPacket;
    try {
      packet = JSON.parse(pinned.text(relative)) as RepositoryModelPacket;
    } catch (error) {
      if (error instanceof QueryRefusal) throw error;
      throw new QueryRefusal("query.file_not_json", `'${relative}' is not valid JSON`);
    }
    if (packet.packet_type !== REPOSITORY_MODEL_PACKET_TYPE) {
      throw new QueryRefusal(
        "query.schema_mismatch",
        `'${relative}' is not a ${REPOSITORY_MODEL_PACKET_TYPE} packet`,
      );
    }
    // The declared id alone proves nothing about the contents: a rewritten
    // assertion with the pointer's hash updated to match would still carry the
    // old id. The packet's own validation recomputes the semantic hash the id
    // is derived from, and checks every referential invariant the producer
    // promised, so it is the same proof the scan ran before emitting it.
    const validation = validateRepositoryModelPacket(packet);
    if (validation.status !== "passed") {
      const failed = validation.checks
        .filter((entry) => entry.status !== "passed")
        .map((entry) => entry.rule);
      throw new QueryRefusal(
        "query.packet_invalid",
        `${relative} failed its own packet validation: ${failed.join(", ")}`,
      );
    }
    if (packet.packet_id !== root.rmp_packet_id) {
      throw new QueryRefusal(
        "query.packet_mismatch",
        `${relative} is packet ${packet.packet_id}; the snapshot records ${root.rmp_packet_id} for root ${root.root_key}`,
      );
    }
    packets.push({ root_id: root.root_id, root_key: root.root_key, packet });
  }
  sources.push({
    source: "repository_model_packet",
    schema: REPOSITORY_MODEL_PACKET_TYPE,
    status: "verified",
    record_count: packets.reduce(
      (sum, entry) =>
        sum +
        entry.packet.payload.assertions.filter((a) => a.subject_id.startsWith("artifact:")).length,
      0,
    ),
    problems: [],
  });

  sources.sort((a, b) => compareCodePoints(a.source, b.source));
  return { pinned, snapshot, index, signals, workSignals, architecture, packets, sources };
}

// ───────────────────────────── the records ─────────────────────────────

interface DocumentContext {
  entry: NormalizedDocumentEntry;
  root_key: string;
  rmp_artifact_id: string;
  declarations: { kinds: DeclarationRef[]; statuses: DeclarationRef[] };
}

/** The join from both identity domains to the document, built from existing ids only. */
function documentContexts(loaded: LoadedGeneration): {
  byArtifact: Map<string, DocumentContext>;
  byRmp: Map<string, string>;
  byCorpusPath: Map<string, string>;
} {
  const rootKey = new Map(loaded.snapshot.roots.map((root) => [root.root_id, root.root_key]));
  const byArtifact = new Map<string, DocumentContext>();
  const byRmp = new Map<string, string>();
  const byCorpusPath = new Map<string, string>();
  for (const entry of loaded.index.documents) {
    const key = rootKey.get(entry.root_id) ?? entry.root_id;
    // The same helper the scan used, so this is a recomputation of an existing
    // identity rather than a parallel one.
    const rmp = repositoryModelArtifactId(`repo:${key}`, entry.root_relative_path);
    byArtifact.set(entry.artifact_id, {
      entry,
      root_key: key,
      rmp_artifact_id: rmp,
      declarations: { kinds: [], statuses: [] },
    });
    byRmp.set(rmp, entry.artifact_id);
    byCorpusPath.set(entry.corpus_path, entry.artifact_id);
  }
  const declare = (
    artifactId: string,
    predicate: string,
    object: string,
    assertionId: string,
  ): void => {
    const context = byArtifact.get(artifactId);
    if (context === undefined) return;
    if (predicate === "work.kind")
      context.declarations.kinds.push({ object, assertion_id: assertionId });
    if (predicate === "work.status")
      context.declarations.statuses.push({ object, assertion_id: assertionId });
  };
  for (const signal of loaded.workSignals)
    declare(signal.artifact_id, signal.predicate, signal.object, signal.signal_id);
  for (const { packet } of loaded.packets) {
    for (const assertion of packet.payload.assertions) {
      const artifactId = byRmp.get(assertion.subject_id);
      if (artifactId !== undefined)
        declare(artifactId, assertion.predicate, assertion.object, assertion.assertion_id);
    }
  }
  const order = (a: DeclarationRef, b: DeclarationRef): number =>
    compareCodePoints(a.object, b.object) || compareCodePoints(a.assertion_id, b.assertion_id);
  for (const context of byArtifact.values()) {
    context.declarations.kinds.sort(order);
    context.declarations.statuses.sort(order);
  }
  return { byArtifact, byRmp, byCorpusPath };
}

function excerptTruncatedAtSource(excerpt: string): boolean {
  return excerpt.length === MAX_EXCERPT_LENGTH && excerpt.endsWith("…");
}

function fromArchitecture(
  record: ArchitectureEvidenceRecord,
  context: DocumentContext,
): EvidenceQueryResult {
  return {
    source: "architecture_evidence",
    record_id: record.evidence_id,
    root_id: context.entry.root_id,
    root_key: context.root_key,
    artifact_id: record.artifact_id,
    rmp_artifact_id: record.rmp_artifact_id,
    corpus_path: context.entry.corpus_path,
    source_path: record.source_path,
    format: record.format,
    normalized_document_id: record.normalized_document_id,
    raw_content_hash: record.raw_content_hash,
    predicate: null,
    statement_class: record.statement_class,
    value: record.declared_text,
    value_truncated_at_source: record.declared_text_truncated,
    structured_locator: record.structured_locator,
    source_range: null,
    block_id: record.block_id,
    block_kind: record.block_kind,
    decoder_id: record.decoder_id,
    bounded_excerpt: record.bounded_excerpt,
    excerpt_truncated_at_source: excerptTruncatedAtSource(record.bounded_excerpt),
    excerpt_cut_by_query: false,
    evidence_class: "declared",
    authority: "source",
    confidence: null,
    extractor_id: record.extractor_id,
    epistemic_class: record.epistemic_class,
    authority_verified: false,
    document_declarations: context.declarations,
    selection: record.selection,
    recognition: record.recognition,
  };
}

function fromWorkSignal(
  record: DocumentWorkSignalRecord,
  context: DocumentContext,
): EvidenceQueryResult {
  return {
    source: "document_work_signals",
    record_id: record.signal_id,
    root_id: context.entry.root_id,
    root_key: context.root_key,
    artifact_id: record.artifact_id,
    rmp_artifact_id: record.rmp_artifact_id,
    corpus_path: context.entry.corpus_path,
    source_path: record.source_path,
    format: record.format,
    normalized_document_id: record.normalized_document_id,
    raw_content_hash: record.raw_content_hash,
    predicate: record.predicate,
    statement_class: null,
    value: record.object,
    value_truncated_at_source: false,
    structured_locator: record.structured_locator,
    source_range: null,
    block_id: record.block_id,
    block_kind: record.block_kind,
    decoder_id: record.decoder_id,
    bounded_excerpt: record.bounded_excerpt,
    excerpt_truncated_at_source: excerptTruncatedAtSource(record.bounded_excerpt),
    excerpt_cut_by_query: false,
    evidence_class: record.evidence_class,
    authority: record.authority,
    confidence: record.confidence,
    extractor_id: record.extractor_id,
    epistemic_class: "source-declared",
    authority_verified: false,
    document_declarations: context.declarations,
    selection: null,
    recognition: null,
  };
}

function fromPacket(
  assertion: RepositoryModelAssertionRecord,
  artifactId: string,
  context: DocumentContext,
): EvidenceQueryResult {
  return {
    source: "repository_model_packet",
    record_id: assertion.assertion_id,
    root_id: context.entry.root_id,
    root_key: context.root_key,
    artifact_id: artifactId,
    rmp_artifact_id: assertion.subject_id,
    corpus_path: context.entry.corpus_path,
    source_path: assertion.source_path,
    format: context.entry.format,
    normalized_document_id: context.entry.normalized_document_id,
    raw_content_hash: assertion.source_content_hash,
    predicate: assertion.predicate,
    statement_class: null,
    value: assertion.object,
    value_truncated_at_source: false,
    structured_locator: null,
    source_range: {
      start_line: assertion.source_range.start_line,
      end_line: assertion.source_range.end_line,
    },
    block_id: null,
    block_kind: null,
    decoder_id: context.entry.decoder_id,
    bounded_excerpt: assertion.evidence_excerpt,
    excerpt_truncated_at_source: excerptTruncatedAtSource(assertion.evidence_excerpt),
    excerpt_cut_by_query: false,
    evidence_class: assertion.evidence_class,
    authority: assertion.authority,
    confidence: assertion.confidence,
    extractor_id: assertion.extractor_id,
    epistemic_class: "source-declared",
    authority_verified: false,
    document_declarations: context.declarations,
    selection: null,
    recognition: null,
  };
}

/** Every record the generation holds, each joined to its document. */
function allRecords(
  loaded: LoadedGeneration,
  contexts: ReturnType<typeof documentContexts>,
): EvidenceQueryResult[] {
  const out: EvidenceQueryResult[] = [];
  for (const record of loaded.architecture ?? []) {
    const context = contexts.byArtifact.get(record.artifact_id);
    if (context !== undefined) out.push(fromArchitecture(record, context));
  }
  for (const record of loaded.workSignals) {
    const context = contexts.byArtifact.get(record.artifact_id);
    if (context !== undefined) out.push(fromWorkSignal(record, context));
  }
  for (const { packet } of loaded.packets) {
    for (const assertion of packet.payload.assertions) {
      const artifactId = contexts.byRmp.get(assertion.subject_id);
      if (artifactId === undefined) continue;
      const context = contexts.byArtifact.get(artifactId);
      if (context !== undefined) out.push(fromPacket(assertion, artifactId, context));
    }
  }
  return out;
}

const SOURCE_RANK: Record<EvidenceSource, number> = {
  architecture_evidence: 0,
  document_work_signals: 1,
  repository_model_packet: 2,
};

/** Total order over results: source, artifact, then the record's own id. */
function compareResults(a: EvidenceQueryResult, b: EvidenceQueryResult): number {
  return (
    SOURCE_RANK[a.source] - SOURCE_RANK[b.source] ||
    compareCodePoints(a.artifact_id, b.artifact_id) ||
    compareCodePoints(a.record_id, b.record_id)
  );
}

/** Cut an excerpt at a UTF-8 byte bound without splitting a character. */
function cutExcerpt(excerpt: string, maxBytes: number): { excerpt: string; cut: boolean } {
  if (Buffer.byteLength(excerpt, "utf8") <= maxBytes) return { excerpt, cut: false };
  let kept = "";
  for (const character of excerpt) {
    if (Buffer.byteLength(kept + character + "…", "utf8") > maxBytes) break;
    kept += character;
  }
  return { excerpt: `${kept}…`, cut: true };
}

// ───────────────────────────── the query ─────────────────────────────

function normalizeLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_QUERY_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_QUERY_LIMIT) {
    throw new QueryRefusal(
      "query.bad_limit",
      `limit must be an integer in [1, ${MAX_QUERY_LIMIT}]`,
    );
  }
  return limit;
}

function normalizeExcerptBytes(bytes: number | undefined): number {
  if (bytes === undefined) return DEFAULT_MAX_EXCERPT_BYTES;
  if (!Number.isSafeInteger(bytes) || bytes < 16) {
    throw new QueryRefusal(
      "query.bad_excerpt_bound",
      "max excerpt bytes must be an integer of at least 16",
    );
  }
  return bytes;
}

function emptyText(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

/**
 * Ask one question of one generation.
 *
 * Never throws for a generation that is absent, corrupt or inconsistent: those
 * are `invalid` outcomes with the refusal named, because a caller who cannot
 * distinguish "nothing matched" from "nothing could be trusted" has been handed
 * a wrong answer with a confident shape.
 */
export function queryCorpusEvidence(input: EvidenceQueryInput): EvidenceQueryResponse {
  const diagnostics: EvidenceQueryResponse["diagnostics"] = [];
  const query: EvidenceQueryResponse["query"] = {
    root: emptyText(input.root),
    artifact: emptyText(input.artifact),
    predicate: emptyText(input.predicate),
    statement_class: emptyText(input.statementClass),
    text: emptyText(input.text),
    kind: emptyText(input.kind),
    status: emptyText(input.status),
    source: input.source ?? null,
    ...(emptyText(input.role) !== null ? { role: emptyText(input.role) as string } : {}),
    ...(input.selectedOnly === true ? { selected_only: true as const } : {}),
    limit: DEFAULT_QUERY_LIMIT,
    max_excerpt_bytes: DEFAULT_MAX_EXCERPT_BYTES,
  };
  const roleFilter = query.role ?? null;
  const selectedOnly = query.selected_only === true;
  const refuse = (
    outcome: QueryOutcome,
    code: string,
    message: string,
    generation: EvidenceQueryResponse["generation"] = null,
    sources: EvidenceSourceStatus[] = [],
  ): EvidenceQueryResponse => ({
    schema: CORPUS_EVIDENCE_QUERY_SCHEMA,
    query,
    generation,
    sources,
    outcome,
    match_count: null,
    returned_count: 0,
    truncated: false,
    truncation_statement: null,
    results: [],
    diagnostics: [...diagnostics, { code, severity: "error", message }],
  });

  try {
    query.limit = normalizeLimit(input.limit);
    query.max_excerpt_bytes = normalizeExcerptBytes(input.maxExcerptBytes);
    if (
      query.statement_class !== null &&
      !(ARCHITECTURE_STATEMENT_CLASSES as readonly string[]).includes(query.statement_class)
    ) {
      return refuse(
        "unsupported",
        "query.unknown_statement_class",
        `'${query.statement_class}' is not a statement class; the vocabulary is ${ARCHITECTURE_STATEMENT_CLASSES.join(", ")}`,
      );
    }
    if (
      roleFilter !== null &&
      !(ARCHITECTURE_DOCUMENT_ROLES as readonly string[]).includes(roleFilter)
    ) {
      return refuse(
        "unsupported",
        "query.unknown_role",
        `'${roleFilter}' is not a selection role; the roles are ${ARCHITECTURE_DOCUMENT_ROLES.join(", ")}`,
      );
    }
    if (query.source !== null && !(EVIDENCE_SOURCES as readonly string[]).includes(query.source)) {
      return refuse(
        "unsupported",
        "query.unknown_source",
        `'${String(query.source)}' is not an evidence source`,
      );
    }
  } catch (error) {
    if (error instanceof QueryRefusal) return refuse("invalid", error.code, error.message);
    throw error;
  }

  let loaded: LoadedGeneration;
  try {
    loaded = loadGeneration(pinGeneration(input.outDir));
  } catch (error) {
    if (error instanceof QueryRefusal) return refuse("invalid", error.code, error.message);
    throw error;
  }

  const { snapshot } = loaded;
  const generation: EvidenceQueryResponse["generation"] = {
    generation_id: loaded.pinned.current.generation_id,
    generation_ref: loaded.pinned.current.generation_ref,
    corpus_id: snapshot.corpus_id,
    corpus_source_snapshot_id: snapshot.corpus_source_snapshot_id,
    corpus_analysis_id: snapshot.analysis.corpus_analysis_id,
    corpus_status: snapshot.corpus_status,
    missing_root_ids: [...snapshot.missing_root_ids].sort(compareCodePoints),
    verification: snapshot.verification,
    evidence_age_statement: EVIDENCE_AGE_STATEMENT,
  };
  if (snapshot.verification.verification_class !== "fully_verified") {
    diagnostics.push({
      code: "query.verification_assumed",
      severity: "warning",
      message: `the pinned snapshot is ${snapshot.verification.verification_class}: ${snapshot.verification.statement}`,
    });
  }

  // A class filter over a generation that never read statements is a question
  // the generation cannot answer, which is different from answering "none".
  if (query.statement_class !== null && loaded.architecture === null) {
    return refuse(
      "unsupported",
      "query.architecture_evidence_not_run",
      "the pinned generation was produced without --architecture-evidence, so statement classes cannot be queried from it",
      generation,
      loaded.sources,
    );
  }

  // A role or selection filter asks about the selection profile's view, which only
  // a generation that read statements has.
  if ((roleFilter !== null || selectedOnly) && loaded.architecture === null) {
    return refuse(
      "unsupported",
      "query.architecture_evidence_not_run",
      "the pinned generation was produced without --architecture-evidence, so selection roles cannot be queried from it",
      generation,
      loaded.sources,
    );
  }

  // Root filter resolves against the snapshot: a key or id the snapshot does not
  // know is a wrong question; a root the snapshot names as missing is a known
  // absence and gets an explicit unavailable outcome rather than zero results.
  let rootIds: Set<string> | null = null;
  if (query.root !== null) {
    const matched = snapshot.roots.filter(
      (root) => root.root_key === query.root || root.root_id === query.root,
    );
    if (matched.length === 0) {
      return refuse(
        "unavailable",
        "query.unknown_root",
        `root '${query.root}' is not in the pinned snapshot`,
        generation,
        loaded.sources,
      );
    }
    const missing = matched.filter((root) => root.observation_status !== "observed");
    if (missing.length > 0) {
      return refuse(
        "unavailable",
        "query.root_not_observed",
        `root '${query.root}' was requested but not observed in this generation (${missing[0]?.failure_reason ?? "missing"})`,
        generation,
        loaded.sources,
      );
    }
    rootIds = new Set(matched.map((root) => root.root_id));
  }

  const contexts = documentContexts(loaded);
  let artifactId: string | null = null;
  if (query.artifact !== null) {
    artifactId = contexts.byArtifact.has(query.artifact)
      ? query.artifact
      : (contexts.byRmp.get(query.artifact) ?? contexts.byCorpusPath.get(query.artifact) ?? null);
    if (artifactId === null) {
      return refuse(
        "unavailable",
        "query.unknown_artifact",
        `artifact '${query.artifact}' is not in the pinned generation`,
        generation,
        loaded.sources,
      );
    }
    if (
      rootIds !== null &&
      !rootIds.has(contexts.byArtifact.get(artifactId)?.entry.root_id ?? "")
    ) {
      return refuse(
        "unavailable",
        "query.artifact_outside_root",
        `artifact '${query.artifact}' does not belong to root '${query.root}'`,
        generation,
        loaded.sources,
      );
    }
  }

  const matches = allRecords(loaded, contexts)
    .filter((record) => {
      if (query.source !== null && record.source !== query.source) return false;
      if (rootIds !== null && !rootIds.has(record.root_id)) return false;
      if (artifactId !== null && record.artifact_id !== artifactId) return false;
      if (query.predicate !== null && record.predicate !== query.predicate) return false;
      if (query.statement_class !== null && record.statement_class !== query.statement_class)
        return false;
      if (
        roleFilter !== null &&
        !(record.selection?.roles as readonly string[] | undefined)?.includes(roleFilter)
      )
        return false;
      if (selectedOnly && record.selection?.selected !== true) return false;
      if (
        query.kind !== null &&
        !record.document_declarations.kinds.some((ref) => ref.object === query.kind)
      )
        return false;
      if (
        query.status !== null &&
        !record.document_declarations.statuses.some((ref) => ref.object === query.status)
      )
        return false;
      if (
        query.text !== null &&
        !record.value.includes(query.text) &&
        !record.bounded_excerpt.includes(query.text)
      )
        return false;
      return true;
    })
    .sort(compareResults);

  const returned = matches.slice(0, query.limit).map((record) => {
    const { excerpt, cut } = cutExcerpt(record.bounded_excerpt, query.max_excerpt_bytes);
    return cut ? { ...record, bounded_excerpt: excerpt, excerpt_cut_by_query: true } : record;
  });
  const truncated = matches.length > returned.length;

  let outcome: QueryOutcome = "ok";
  if (snapshot.corpus_status !== "complete") {
    outcome = "incomplete";
    diagnostics.push({
      code: "query.corpus_incomplete",
      severity: "warning",
      message: `the pinned snapshot is ${snapshot.corpus_status}; roots not observed: ${generation.missing_root_ids.join(", ") || "(none named)"}. The answer covers only the observed roots.`,
    });
  } else if (matches.length === 0) {
    outcome = "empty";
  }

  return {
    schema: CORPUS_EVIDENCE_QUERY_SCHEMA,
    query,
    generation,
    sources: loaded.sources,
    outcome,
    match_count: matches.length,
    returned_count: returned.length,
    truncated,
    truncation_statement: truncated ? TRUNCATION_STATEMENT : null,
    results: returned,
    diagnostics,
  };
}

/** Canonical bytes of a response: code-point key order, no clock, no absolute path. */
export function renderEvidenceQueryResponse(response: EvidenceQueryResponse): string {
  return `${canonicalCorpusJson(response)}\n`;
}
