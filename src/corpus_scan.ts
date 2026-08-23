// corpus_scan.ts — one read-only pass over a multi-root corpus.
//
// This is the module that owns the order of operations, and the order is what
// makes the cache safe:
//
//   1. acquire every root read-only, hashing every byte. No cache participates.
//   2. derive each artifact's corpus identity from its root and its root-relative
//      path, and the corpus snapshot identity from the roots' revisions.
//   3. for each artifact, compute the cache keys of its derived layers *from its
//      content hash alone*. A file whose bytes are unchanged is never opened.
//   4. compute what missed, store it, and project the results.
//
// Step 1 is unconditional. Hashing is the cheap layer and the one that decides
// identity, so it is never skipped, never inferred from a timestamp, and never
// read out of a cache. Everything expensive — decoding, interpreting, tokenizing —
// hangs off the hash, which is why a warm run can be fast without a single
// decision being taken on trust.
//
// Nothing in this file writes to an observed root, executes anything it finds,
// installs anything, or calls a model. A scan of a corpus leaves the corpus
// byte-for-byte as it was.
import * as fs from "node:fs";
import * as path from "node:path";
import {
  CORPUS_PROFILE_ID,
  CORPUS_PROFILE_VERSION,
  CorpusDuplicateCluster,
  CorpusRelation,
  DEFAULT_NEAR_DUPLICATE_THRESHOLD,
  EXACT_DUPLICATE_METHOD,
  EXACT_DUPLICATE_METHOD_VERSION,
  NEAR_DUPLICATE_EXTENSIONS,
  NEAR_DUPLICATE_METHOD,
  NEAR_DUPLICATE_METHOD_VERSION,
  NearDuplicateCandidate,
  NearDuplicateDocument,
  analysisTokens,
  buildDuplicateRelations,
  canonicalCorpusJson,
  clusterExactDuplicates,
  nearDuplicateCandidates,
  normalizeForAnalysis,
  shingleSet,
} from "./corpus_analysis";
import {
  CorpusCache,
  CorpusCacheStats,
  NullCorpusCache,
  cacheStatsDelta,
  cached,
  candidateAnalysisKey,
  interpretationKey,
  lexicalFeaturesKey,
  normalizedDocumentKey,
  archiveManifestKey,
  rawIdentityKey,
  statPrecheckMatches,
} from "./corpus_cache";
import {
  DEFAULT_TOPIC_THRESHOLD,
  DeclaredIdentifier,
  ProjectCandidate,
  ProjectMarker,
  TopicCandidate,
  buildProjectCandidates,
  buildTopicCandidates,
  candidateProfileHash,
  readDeclaredIdentifier,
  readsDeclaredIdentifier,
} from "./corpus_candidates";
import {
  CORPUS_COVERAGE_SCHEMA,
  CorpusCoverage,
  NO_PRIORITY_STATEMENT,
  coverageRatio,
  documentGaps,
  formatCounts,
} from "./corpus_coverage";
import { CorpusDiff, buildCorpusDiff } from "./corpus_diff";
import {
  CorpusDocumentSignals,
  buildCorpusDocumentSignals,
} from "./corpus_document_signals";
import {
  READINESS_SIGNALS,
  ReadinessArtifactInput,
  ReadinessEvidence,
  ReadinessSignal,
  BodyOfWorkSpec,
  buildReadinessEvidence,
  readinessProfileHash,
  readinessSignalsFor,
} from "./corpus_readiness";
import {
  CORPUS_PATH_SEPARATOR,
  CorpusRootBinding,
  CorpusRootSpec,
  bindCorpusRoots,
  corpusPath,
  corpusRootId,
  corpusRootSnapshotId,
  corpusAnalysisId,
  corpusSourceSnapshotId,
  DEFAULT_CORPUS_ID,
  defaultRootKey,
  rootDirectoryName,
  rootIdentity,
  virtualSourceId,
} from "./corpus_roots";
import {
  CORPUS_SNAPSHOT_SCHEMA,
  CorpusAnalysisIdentity,
  CorpusSnapshot,
  CorpusSnapshotArchive,
  CorpusSnapshotArtifact,
  CorpusSnapshotRoot,
  CorpusStatus,
  CorpusVerification,
  CACHED_ASSUMPTION_STATEMENT,
  FULLY_VERIFIED_STATEMENT,
  VerificationMode,
  snapshotPrechecks,
} from "./corpus_snapshot";
import {
  CorpusResourceBudgets,
  CorpusSessionStore,
  DEFAULT_CORPUS_BUDGETS,
  MemoryBudget,
  YIELD_INTERVAL,
  boundedMap,
  yieldToEventLoop,
} from "./corpus_session";
import { probeFileEncoding } from "./encoding";
import {
  DEFAULT_DECODER_BUDGET,
  DecoderRegistry,
  NormalizedDocument,
  defaultDecoderRegistry,
  isProseDocumentFormat,
} from "./documents";
import { defaultExtractors } from "./extractors";
import {
  DEFAULT_MAX_FILE_BYTES,
  Extractor,
  InterpretedAssertion,
  InterpretationDiagnostic,
  INTERPRETATION_PROFILE_ID,
  INTERPRETATION_PROFILE_VERSION,
  PortableAssertion,
  bindPortableAssertions,
  toPortableAssertions,
  interpretDocumentContent,
  interpretationProfileHash,
  isSecretCandidatePath,
} from "./interpretation";
import { LocalArchivePolicy } from "./local_archive_policy";
import type { ArchivePreflightResult } from "./archive_preflight";
import {
  ARCHIVE_MEMBER_SEPARATOR,
  ArchiveManifestStore,
  KnownFileHash,
  LocalSourceObservation,
  acquireLocalSource,
} from "./local_source";
import { compareCodePoints } from "./ordering";
import { UNDECODED_REASON_NOT_ELIGIBLE, buildDocumentIndex } from "./corpus_documents";
import { runSemanticAnalysis } from "./corpus_semantic_run";
import type { DocumentIndex } from "./corpus_documents";
import type { SemanticAnalysisResult } from "./corpus_semantic_run";
import type { SemanticArtifactInput } from "./corpus_semantics";
import type { PackAssertion } from "./corpus_reasoning";
import type { EmbeddingPairScore } from "./corpus_pairs";
import type { EmbeddingRunReport } from "./corpus_embeddings";
import { RepositoryModelPacket, buildRepositoryModelPacket, stableId } from "./repository_model";
import {
  LocalSourceManifest,
  buildLocalSourceManifest,
  toRepositoryModelLocalSource,
} from "./local_source_model";

export const CORPUS_CANDIDATES_SCHEMA = "l9.corpus-candidates/v1";

/** Decoder that turns exact bytes into the text every later layer reads. */
export const TEXT_DECODER_ID = "utf8-text-decoder";
export const TEXT_DECODER_VERSION = "1.0.0";

/** Decoder that reads a build manifest's declared name out of its body. */
export const MANIFEST_DECODER_ID = "manifest-identifier-reader";
export const MANIFEST_DECODER_VERSION = "1.0.0";

/** Extensions the text decoder claims beyond the lexical-analysis set. */

/** Extensionless files the text decoder claims by name. */

const LEXICAL_EXTENSIONS = new Set(NEAR_DUPLICATE_EXTENSIONS);


// ───────────────────────────── inputs ─────────────────────────────

export interface CorpusScanInput {
  roots: readonly CorpusRootSpec[];
  producerVersion: string;
  /** Operator's name for the corpus. A label; it enters no identity. */
  corpusId?: string;
  /** Timestamp recorded in each per-root packet. Excluded from identity. */
  generatedAt?: string;
  /** Wall clock recorded in each root's acquisition manifest. Operational only. */
  observedAt?: string;
  /**
   * `full` reads every byte; `incremental` may carry a previous run's hash forward
   * when size and mtime have not moved. Default `full`.
   */
  verification?: VerificationMode;
  /** Force a full read even under `incremental`, and say so in the snapshot. */
  verifyContent?: boolean;
  /** Decoder set to use. Defaults to the registry this release ships. */
  decoderRegistry?: DecoderRegistry;
  /**
   * Emit a snapshot marked `partial` when a root cannot be read, instead of
   * failing the run. The snapshot is never labelled complete, and every missing
   * root is named in it.
   */
  allowPartialRoots?: boolean;
  cache?: CorpusCache;
  session?: CorpusSessionStore;
  /** Snapshot of a previous run; when present, `corpus-diff.json` is produced. */
  previousSnapshot?: CorpusSnapshot;
  expandArchives?: boolean;
  interpret?: boolean;
  archivePolicy?: Partial<LocalArchivePolicy>;
  omitPatterns?: string[];
  omitFile?: string;
  hashMaxBytes?: number;
  maxFileBytes?: number;
  nearDuplicates?: { enabled?: boolean; threshold?: number };
  topics?: { enabled?: boolean; threshold?: number };
  budgets?: Partial<Omit<CorpusResourceBudgets, "archive">>;
  scratchParent?: string;
  /** Semantic candidate discovery. On by default; costs one pass over recorded evidence. */
  semanticAnalysis?: boolean;
  /** Cosine scores from an embedding pass the caller ran. Absent means embeddings were off. */
  embeddingPairs?: readonly EmbeddingPairScore[];
  embeddingReport?: EmbeddingRunReport;
  /** Overrides for the bounded reasoning evidence packs. */
  packBudget?: { maxArtifactsPerPack?: number; maxTotalPackCharacters?: number };
}

export interface CorpusScanDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  corpus_path?: string;
}

export interface CorpusCandidatesDocument {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  corpus_profile_hash: string;
  roots: ReturnType<typeof rootIdentity>[];
  analysis_profile: {
    corpus_profile_id: string;
    corpus_profile_version: string;
    exact_duplicate_method: string;
    exact_duplicate_version: string;
    near_duplicate_method: string;
    near_duplicate_version: string;
    near_duplicate_threshold: number;
    near_duplicate_enabled: boolean;
    topic_candidate_method: string;
    topic_candidate_version: string;
    topic_threshold: number;
    topic_candidates_enabled: boolean;
    project_candidate_method: string;
    project_candidate_version: string;
    candidate_profile_hash: string;
    interpretation_profile_hash: string;
  };
  summary: {
    artifact_count: number;
    archive_count: number;
    archive_member_count: number;
    root_count: number;
    exact_duplicate_cluster_count: number;
    exact_duplicate_artifact_count: number;
    cross_root_duplicate_cluster_count: number;
    recoverable_duplicate_bytes: number;
    near_duplicate_candidate_count: number;
    cross_root_near_duplicate_count: number;
    topic_candidate_count: number;
    cross_root_topic_candidate_count: number;
    project_candidate_count: number;
    cross_root_project_candidate_count: number;
  };
  artifacts: {
    virtual_source_id: string;
    corpus_path: string;
    root_id: string;
    artifact_type: string;
    content_hash: string | null;
    size_bytes: number | null;
    is_archive_member: boolean;
    exact_duplicate_cluster_id: string | null;
    near_duplicate_candidate_ids: string[];
    topic_candidate_ids: string[];
    project_candidate_ids: string[];
  }[];
  exact_duplicate_clusters: CorpusDuplicateCluster[];
  relations: CorpusRelation[];
  near_duplicate_candidates: NearDuplicateCandidate[];
  topic_candidates: TopicCandidate[];
  project_candidates: ProjectCandidate[];
  /** Restated so a consumer reading only this file sees the epistemic classes. */
  candidate_statement: string;
}

export const CANDIDATE_STATEMENT =
  "Exact duplicates are byte equality and are facts. Near-duplicate candidates, topic "
  + "candidates and project candidates are deterministic candidate analyses: they report "
  + "shared bytes, shared wording and a container that holds a project marker. None of "
  + "them claims two documents mean the same thing, that anything should be merged, "
  + "moved or deleted, or that one is more valuable than another.";

export const DOCUMENT_COVERAGE_SCHEMA = "l9.document-coverage/v1";

/** Per-root document coverage: what the decoders reached inside one root. */
export interface RootDocumentCoverage {
  schema: string;
  corpus_source_snapshot_id: string;
  corpus_analysis_id: string;
  root_id: string;
  root_key: string;
  decoder: { decoder_id: string; decoder_version: string };
  artifact_count: number;
  decoded_count: number;
  undecoded_count: number;
  distinct_document_count: number;
  archive_member_count: number;
  total_token_count: number;
  undecoded_by_reason: { reason: string; count: number }[];
}

/**
 * Everything one root produces on its own.
 *
 * A root's packet, acquisition manifest and document index are facts about that
 * root and are written under it, not folded into a corpus-wide file. A corpus is
 * an analysis across roots; it is not a filesystem that replaces them, and an
 * operator who later wants only the old SSD should find it whole in one place.
 */
export interface CorpusRootPacket {
  root_id: string;
  root_key: string;
  /** Directory name under `roots/`. A function of the root key alone. */
  directory: string;
  packet: RepositoryModelPacket;
  localSourceManifest: LocalSourceManifest;
  documentIndex: DocumentIndex;
  documentCoverage: RootDocumentCoverage;
}

export interface CorpusScanResult {
  snapshot: CorpusSnapshot;
  /** Each root's independent RMP. One per observed root, ordered by root id. */
  rootPackets: CorpusRootPacket[];
  candidates: CorpusCandidatesDocument;
  readiness: ReadinessEvidence;
  coverage: CorpusCoverage;
  diff: CorpusDiff | null;
  diagnostics: CorpusScanDiagnostic[];
  cacheStats: CorpusCacheStats;
  /** Roots as bound, including the absolute paths. Operational. */
  bindings: CorpusRootBinding[];
  /** How the mtime hint scored against the hashes, when a previous snapshot existed. */
  precheck: { predicted_unchanged: number; confirmed_unchanged: number; contradicted: number };
  /** Bytes and files the acquisition pass actually read. */
  scanned: { files: number; bytes: number };
  /** The normalized documents, written down rather than discarded with the run. */
  documentIndex: DocumentIndex;
  /** What each decoder read, and whether what it read reached the analysis. */
  documentSignals: CorpusDocumentSignals;
  /** Candidate discovery over recorded evidence. Null when it was switched off. */
  semantic: SemanticAnalysisResult | null;
}

// ───────────────────────────── internal shapes ─────────────────────────────

interface ScanArtifact {
  virtualSourceId: string;
  corpusPath: string;
  rootId: string;
  rootRelativePath: string;
  absolutePath: string | null;
  contentHash: string | null;
  sizeBytes: number | null;
  artifactType: string;
  isArchiveMember: boolean;
  basename: string;
  extension: string;
  statPrecheck?: { size_bytes: number; mtime_ms: number; mtime_ns?: string };
}

/** What a decoder established about one set of bytes. */
interface NormalizedDocumentRecord {
  decodes: boolean;
  reason: string | null;
  byte_length: number;
  normalized_content_hash: string | null;
  token_count: number;
  /** Which decoder read these bytes, and which format it read them as. */
  format: string;
  decoder_id: string;
  decoder_version: string;
  block_count: number;
  /** Blocks with their locators, kept so document signals can cite them. */
  blocks?: { block_id: string; kind: string; text: string; locator: Record<string, unknown> }[];
}

interface LexicalFeatureRecord {
  normalized_content_hash: string;
  token_count: number;
  shingles: string[];
  term_counts: [string, number][];
}

/** An interpretation as it is used in this run: bound to a root. */
interface InterpretationRecord {
  assertions: InterpretedAssertion[];
  diagnostics: InterpretationDiagnostic[];
}

/**
 * An interpretation as it is stored: content-addressed, subject-free.
 *
 * The cache key is the normalized document plus the source path, and in an
 * archive corpus two roots routinely hold the same bytes at the same relative
 * path — a backup of a project beside the project. So a stored interpretation is
 * read back under a root it was not computed in, and it must not carry that
 * root's subject with it. It carries none: `bindPortableAssertions` derives the
 * subject and the assertion id afresh for whichever root is reading.
 */
interface PortableInterpretationRecord {
  assertions: PortableAssertion[];
  diagnostics: InterpretationDiagnostic[];
}

// ───────────────────────────── helpers ─────────────────────────────

/**
 * The archives a member sits inside, outermost first.
 *
 * `old.zip!/inner.zip!/draft.md` is two archives deep, and its ancestry is the
 * successive archive prefixes rather than the bare filenames — `inner.zip` alone
 * would collide with an unrelated `inner.zip` in another archive.
 */
function archiveAncestryOf(rootRelativePath: string): string[] {
  const parts = rootRelativePath.split(ARCHIVE_MEMBER_SEPARATOR);
  if (parts.length < 2) return [];
  const ancestry: string[] = [];
  for (let i = 0; i < parts.length - 1; i += 1) {
    ancestry.push(parts.slice(0, i + 1).join(ARCHIVE_MEMBER_SEPARATOR));
  }
  return ancestry;
}


function normalizeHash(value: string | null): string | null {
  if (value === null || value.length === 0) return null;
  return value.startsWith("sha256:") ? value : `sha256:${value}`;
}

function basenameOf(rootRelativePath: string): string {
  return rootRelativePath.slice(rootRelativePath.lastIndexOf("/") + 1).toLowerCase();
}

function extensionOf(basename: string): string {
  const dot = basename.lastIndexOf(".");
  return dot <= 0 ? "" : basename.slice(dot);
}

/**
 * True when some decoder in `registry` claims this artifact.
 *
 * This is the coverage denominator, so it has to be the same question the derive
 * stage asks. Deriving eligibility from a second hand-maintained extension list
 * is how "decoder_eligible_count" drifts away from what actually gets decoded.
 */
export function isDecodable(rootRelativePath: string, registry: DecoderRegistry): boolean {
  return registry.forPath(rootRelativePath) !== undefined;
}

/** True when the lexical passes claim this artifact. */
export function isLexicallyAnalyzable(rootRelativePath: string): boolean {
  return LEXICAL_EXTENSIONS.has(extensionOf(basenameOf(rootRelativePath)));
}

function termCounts(tokens: readonly string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => compareCodePoints(a[0], b[0]));
}

/**
 * Invert a membership relation: which groups each member belongs to.
 *
 * Near-duplicate candidates, topic candidates and project candidates all need the
 * same inversion, and three hand-rolled copies of it were three places for the
 * bucket-initialization branch to be got wrong.
 */
function indexMembership<T>(
  groups: readonly T[],
  membersOf: (group: T) => readonly string[],
  idOf: (group: T) => string,
): Map<string, string[]> {
  const index = new Map<string, string[]>();
  for (const group of groups) {
    const id = idOf(group);
    for (const member of membersOf(group)) {
      const bucket = index.get(member);
      if (bucket === undefined) index.set(member, [id]);
      else bucket.push(id);
    }
  }
  return index;
}

/** Reject a root key that would make a corpus path ambiguous. */
function assertUsableRootKey(rootKey: string, rootPath: string): void {
  if (rootKey.length === 0) {
    throw new Error(`corpus: root ${rootPath} resolves to an empty key; name it with --root PATH=NAME`);
  }
  if (rootKey.includes(CORPUS_PATH_SEPARATOR) || /[\n\r]/.test(rootKey)) {
    throw new Error(
      `corpus: root key '${rootKey}' contains '${CORPUS_PATH_SEPARATOR}' or a newline, `
      + "which would make a corpus path ambiguous",
    );
  }
}

/** Everything the derive stage accumulates for one corpus. */
interface DerivedLayers {
  normalized: Map<string, NormalizedDocumentRecord>;
  lexical: Map<string, LexicalFeatureRecord>;
  interpreted: Map<string, InterpretationRecord>;
  manifestIdentifiers: Map<string, DeclaredIdentifier | null>;
  /** Documents the scan deliberately did not decode, by reason. */
  skipped: { secret: number; oversized: number; encoding: number; unreadable: number };
}

interface DeriveDocumentContext {
  cache: CorpusCache;
  session?: CorpusSessionStore;
  memory: MemoryBudget;
  extractors: Extractor[];
  candidateProfile: string;
  interpretProfile: string;
  interpretEnabled: boolean;
  registry: DecoderRegistry;
  maxFileBytes: number;
  rootPathsById: ReadonlyMap<string, Set<string>>;
  rootKeyById: ReadonlyMap<string, string>;
  into: DerivedLayers;
}

/**
 * Establish one document's derived layers, opening it only if it has to.
 *
 * Every key here is computed from the content hash the acquisition pass already
 * produced, so the decision not to read a file is made *after* its identity is
 * known rather than instead of knowing it. `needsText` is the whole of that
 * decision: if every layer this document wants is already stored under its own
 * content-addressed key, the file is never opened.
 */
async function deriveDocumentLayers(
  artifact: ScanArtifact,
  context: DeriveDocumentContext,
): Promise<void> {
  const {
    cache, session, memory, extractors, candidateProfile, interpretProfile,
    interpretEnabled, maxFileBytes, rootPathsById, rootKeyById, registry, into,
  } = context;
  const { normalized, lexical, interpreted, manifestIdentifiers, skipped } = into;
  const contentHash = artifact.contentHash as string;
  // The decoder that claims this path decides the key. A `.docx` and a `.md` are
  // read by different code into different documents, and a decoder revision must
  // invalidate its own entries without touching anyone else's.
  const decoder = registry.forPath(artifact.rootRelativePath);
  const documentKey = normalizedDocumentKey({
    contentHash,
    decoderId: decoder?.id ?? TEXT_DECODER_ID,
    decoderVersion: decoder?.version ?? TEXT_DECODER_VERSION,
  });
  const lexicalKey = lexicalFeaturesKey({
    normalizedDocumentIdentity: documentKey,
    lexicalProfileHash: candidateProfile,
  });
  // The interpretation key carries the source path as well as the two the
  // cache contract names. An assertion cites the path it was read from and is
  // filed against that path's artifact subject, and several extractors read
  // the path itself — so two identical files at two paths are two different
  // interpretations, and a purely content-addressed key would serve one under
  // the other's name.
  const interpretKey = interpretationKey({
    normalizedDocumentIdentity: stableId("interp-subject", {
      // Bumped when the stored shape changed to drop subject-bound identity. An
      // entry written by the previous release carries another root's subject ids
      // and must never be served; a distinct key is what guarantees it is not.
      cache_format: 2,
      normalized_document_identity: documentKey,
      source_path: artifact.rootRelativePath,
    }),
    interpretationProfileHash: interpretProfile,
  });
  // Two routes into lexical analysis, because the two families answer the
  // question differently. For text and Markdown the extension decides, since the
  // text decoder also claims source code and shingling a repository's TypeScript
  // would make every file that shares an import block a near-duplicate of every
  // other. For a document format there is nothing left to consult: a Word file
  // is prose whatever it is called. Without the second route a decoded `.docx`
  // would be counted in coverage and reach no candidate at all.
  const wantsLexical = isLexicallyAnalyzable(artifact.rootRelativePath)
    || (decoder !== undefined && isProseDocumentFormat(decoder.format));
  const wantsInterpretation = interpretEnabled
    && extractors.some((extractor) => extractor.matches(artifact.rootRelativePath));
  const wantsIdentifier = readsDeclaredIdentifier(artifact.basename);

  // Eligibility first: a refusal to open a file is a decision about the file,
  // not about its bytes, so it is never cached under a content key.
  if (isSecretCandidatePath(artifact.rootRelativePath)) {
    skipped.secret += 1;
    return;
  }
  if (artifact.sizeBytes !== null && artifact.sizeBytes > maxFileBytes) {
    skipped.oversized += 1;
    return;
  }

  const documentHit = cache.get<NormalizedDocumentRecord>("normalized_document", documentKey);
  // A document already known not to decode has no derived layers and never will.
  // Asking for them anyway records a miss on every run — for a scanned PDF, on
  // every run forever — and a warm run over a corpus containing one could never
  // reach a full cache however many times it was repeated.
  const mayDecode = documentHit === undefined || documentHit.decodes;
  const lexicalHit = wantsLexical && mayDecode
    ? cache.get<LexicalFeatureRecord>("lexical_features", lexicalKey)
    : undefined;
  const portableHit = wantsInterpretation && mayDecode
    ? cache.get<PortableInterpretationRecord>("interpretation", interpretKey)
    : undefined;
  const repositorySubjectId = `repo:${rootKeyById.get(artifact.rootId) ?? artifact.rootId}`;
  const interpretHit: InterpretationRecord | undefined = portableHit === undefined
    ? undefined
    : {
        assertions: bindPortableAssertions(portableHit.assertions, repositorySubjectId),
        diagnostics: portableHit.diagnostics,
      };
  const identifierKey = normalizedDocumentKey({
    contentHash,
    decoderId: MANIFEST_DECODER_ID,
    decoderVersion: MANIFEST_DECODER_VERSION,
  });
  const identifierHit = wantsIdentifier && mayDecode
    ? cache.get<{ declared: DeclaredIdentifier | null }>("normalized_document", identifierKey)
    : undefined;

  const needsText = documentHit === undefined
    || (wantsLexical && lexicalHit === undefined && documentHit.decodes)
    || (wantsInterpretation && interpretHit === undefined && documentHit.decodes)
    || (wantsIdentifier && identifierHit === undefined && documentHit.decodes);

  if (documentHit !== undefined) normalized.set(artifact.virtualSourceId, documentHit);
  if (lexicalHit !== undefined) lexical.set(artifact.virtualSourceId, lexicalHit);
  if (interpretHit !== undefined) interpreted.set(artifact.virtualSourceId, interpretHit);
  if (identifierHit !== undefined) manifestIdentifiers.set(artifact.virtualSourceId, identifierHit.declared);
  if (!needsText) {
    session?.completeDecoder(documentKey);
    return;
  }

  const absolute = artifact.absolutePath;
  if (absolute === null) {
    skipped.unreadable += 1;
    return;
  }
  const reserve = artifact.sizeBytes ?? 0;
  await memory.reserve(reserve);
  try {
    // A decoder that reads text still needs the bytes to be text; one that reads
    // a container does not, and probing a `.docx` for UTF-8 would reject every
    // Word document in the corpus.
    const textFamily = decoder === undefined || decoder.format === "text" || decoder.format === "markdown";
    if (textFamily) {
      const encoding = probeFileEncoding(absolute);
      if (encoding.status !== "utf8") {
        if (encoding.status === "unreadable") skipped.unreadable += 1;
        else skipped.encoding += 1;
        const record: NormalizedDocumentRecord = {
          decodes: false,
          reason: encoding.status,
          byte_length: artifact.sizeBytes ?? 0,
          normalized_content_hash: null,
          token_count: 0,
          format: decoder?.format ?? "unknown",
          decoder_id: decoder?.id ?? TEXT_DECODER_ID,
          decoder_version: decoder?.version ?? TEXT_DECODER_VERSION,
          block_count: 0,
        };
        cache.put("normalized_document", documentKey, record);
        normalized.set(artifact.virtualSourceId, record);
        return;
      }
    }

    if (decoder === undefined) {
      skipped.unreadable += 1;
      return;
    }

    const outcome = decoder.decode({
      artifactId: artifact.virtualSourceId,
      contentHash,
      sourcePath: artifact.rootRelativePath,
      absolutePath: absolute,
      sizeBytes: artifact.sizeBytes ?? 0,
      budget: DEFAULT_DECODER_BUDGET,
    });

    if (!outcome.decoded) {
      // A refusal is a typed fact with a reason, never an empty document. A
      // scanned PDF and a PDF with nothing in it are different findings.
      const record: NormalizedDocumentRecord = {
        decodes: false,
        reason: outcome.reason,
        byte_length: artifact.sizeBytes ?? 0,
        normalized_content_hash: null,
        token_count: 0,
        format: decoder.format,
        decoder_id: decoder.id,
        decoder_version: decoder.version,
        block_count: 0,
      };
      cache.put("normalized_document", documentKey, record);
      normalized.set(artifact.virtualSourceId, record);
      return;
    }

    const document: NormalizedDocument = outcome.document;
    // Which text the later layers read depends on whether the format has lines.
    //
    // A Markdown file does. Its assertions cite line spans, and those spans have
    // to point at lines of the file an operator can open — so a text document is
    // read exactly as it was before this decoder existed, from its own bytes.
    //
    // A Word document does not have lines. Its blocks are the only text there is,
    // so joining them is what puts a `.docx` plan into the same keyphrase and
    // near-duplicate analysis as a `.md` one instead of leaving it a coverage
    // statistic. Its evidence cites block ids and structured locators, which is
    // what `document-signals.json` carries.
    let text: string;
    if (textFamily) {
      try {
        text = fs.readFileSync(absolute, "utf8");
      } catch {
        skipped.unreadable += 1;
        return;
      }
    } else {
      text = document.blocks.map((block) => block.text).join("\n");
    }
    const analysisText = normalizeForAnalysis(text);
    const tokens = analysisTokens(analysisText);
    const record: NormalizedDocumentRecord = {
      decodes: true,
      reason: null,
      byte_length: Buffer.byteLength(text, "utf8"),
      normalized_content_hash: stableId("normtext", { text: analysisText }),
      token_count: tokens.length,
      format: document.format,
      decoder_id: document.decoder_id,
      decoder_version: document.decoder_version,
      block_count: document.blocks.length,
      blocks: document.blocks.map((block) => ({
        block_id: block.block_id,
        kind: block.kind,
        text: block.text,
        locator: block.locator as unknown as Record<string, unknown>,
      })),
    };
    cache.put("normalized_document", documentKey, record);
    normalized.set(artifact.virtualSourceId, record);
    session?.completeDecoder(documentKey);

    if (wantsLexical && lexicalHit === undefined) {
      const features: LexicalFeatureRecord = {
        normalized_content_hash: record.normalized_content_hash as string,
        token_count: tokens.length,
        shingles: [...shingleSet(tokens)],
        term_counts: termCounts(tokens),
      };
      cache.put("lexical_features", lexicalKey, features);
      lexical.set(artifact.virtualSourceId, features);
    }
    if (wantsInterpretation && interpretHit === undefined) {
      const observedPaths = rootPathsById.get(artifact.rootId) ?? new Set<string>();
      // Whether the extractor set consulted the rest of the root is discovered
      // rather than assumed. A document whose interpretation depended on which
      // other paths exist is not a function of its own bytes, so it is
      // computed and used but never stored: a later run with a different root
      // would otherwise read back an answer that is no longer true.
      let consultedRoot = false;
      const result = interpretDocumentContent({
        repositorySubjectId,
        sourcePath: artifact.rootRelativePath,
        content: text,
        extractors,
        pathExists: (relativePath) => {
          consultedRoot = true;
          return observedPaths.has(relativePath.replace(/^\.\//, ""));
        },
      });
      if (!consultedRoot) {
        const portable: PortableInterpretationRecord = {
          assertions: toPortableAssertions(result.assertions),
          diagnostics: result.diagnostics,
        };
        cache.put("interpretation", interpretKey, portable);
      }
      interpreted.set(artifact.virtualSourceId, {
        assertions: result.assertions,
        diagnostics: result.diagnostics,
      });
    }
    if (wantsIdentifier && identifierHit === undefined) {
      const declared = readDeclaredIdentifier(artifact.basename, text) ?? null;
      cache.put("normalized_document", identifierKey, { declared });
      manifestIdentifiers.set(artifact.virtualSourceId, declared);
    }
  } finally {
    memory.release(reserve);
  }
}

/**
 * A previous run's hashes for one root, keyed by root-relative path.
 *
 * Only artifacts with both a hash and the stat they were hashed at are eligible:
 * a record missing either cannot be revalidated, and an unrevalidatable record is
 * not a reason to skip reading a file. Archive members are excluded — their bytes
 * live inside an archive this run re-reads, so there is nothing to stat.
 */
function knownHashesForRoot(
  rootId: string,
  previous: CorpusSnapshot | undefined,
): Map<string, KnownFileHash> {
  const known = new Map<string, KnownFileHash>();
  for (const artifact of previous?.artifacts ?? []) {
    if (artifact.root_id !== rootId) continue;
    if (artifact.is_archive_member) continue;
    if (artifact.content_hash === null || artifact.stat_precheck === undefined) continue;
    known.set(artifact.root_relative_path, {
      content_hash: artifact.content_hash,
      size_bytes: artifact.stat_precheck.size_bytes,
      mtime_ms: artifact.stat_precheck.mtime_ms,
      ...(artifact.stat_precheck.mtime_ns !== undefined
        ? { mtime_ns: artifact.stat_precheck.mtime_ns }
        : {}),
    });
  }
  return known;
}

// ───────────────────────────── the scan ─────────────────────────────

/**
 * Observe every root, derive the corpus, and project it.
 *
 * Asynchronous because the decode stage is bounded rather than unbounded: the
 * budgets decide how many documents are in flight and how many bytes of text are
 * held at once, and both of those need something to wait on.
 */
export async function runCorpusScan(input: CorpusScanInput): Promise<CorpusScanResult> {
  if (input.roots.length === 0) throw new Error("corpus: at least one --root is required");

  const cache = input.cache ?? new NullCorpusCache();
  // Every ratio this run reports is its own. A cache shared with an earlier scan
  // has that scan's counters in it, and averaging the two would describe neither.
  const cacheAtStart = cache.stats();
  const cacheNotesAtStart = cache.diagnostics().length;
  const session = input.session;
  const diagnostics: CorpusScanDiagnostic[] = [];
  const budgets: Omit<CorpusResourceBudgets, "archive"> = {
    ...DEFAULT_CORPUS_BUDGETS,
    ...input.budgets,
  };
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const nearDuplicatesEnabled = input.nearDuplicates?.enabled !== false;
  const nearDuplicateThreshold = input.nearDuplicates?.threshold ?? DEFAULT_NEAR_DUPLICATE_THRESHOLD;
  const topicsEnabled = input.topics?.enabled !== false;
  const topicThreshold = input.topics?.threshold ?? DEFAULT_TOPIC_THRESHOLD;
  const extractors = defaultExtractors();
  // Supplied by the caller only in tests that need a narrower decoder set; a
  // corpus run always uses the shipped registry, so what a document decodes to
  // is a property of the release rather than of the invocation.
  const registry = input.decoderRegistry ?? defaultDecoderRegistry();
  // The gap sets are asked of the registry rather than read from a constant, so
  // a run with a wider decoder set reports a correspondingly narrower gap, and a
  // decoder registered without its extension leaving the gap list is rejected
  // here rather than producing a report that contradicts itself.
  const gaps = documentGaps(registry);
  const ocrExtensions = new Set(gaps.ocrRequired);
  const undecodedExtensions = new Set(gaps.unsupported);
  const interpretProfile = interpretationProfileHash(extractors);
  const interpretEnabled = input.interpret !== false;
  const verificationMode: VerificationMode = input.verification ?? "full";
  const verifyContent = input.verifyContent === true;
  // `--verify-content` outranks `--incremental`: it exists precisely to turn a
  // stat-assisted snapshot back into a byte-verified one, so it must win when
  // both are given rather than quietly deferring to the cheaper mode.
  // An archive's preflight verdict is a function of its bytes, the reader and the
  // policy, so it is cached under exactly those. The bytes are still staged: the
  // members are needed by whatever reads them next, and a verdict is not members.
  const archiveManifestStore: ArchiveManifestStore = {
    get: (key) => cache.get<ArchivePreflightResult>("archive_manifest", archiveManifestKey({
      archiveContentHash: key.archiveContentHash,
      archiveReaderVersion: key.readerVersion,
      archivePolicyVersion: key.policyVersion,
    })),
    put: (key, value) => cache.put("archive_manifest", archiveManifestKey({
      archiveContentHash: key.archiveContentHash,
      archiveReaderVersion: key.readerVersion,
      archivePolicyVersion: key.policyVersion,
    }), value),
  };
  const knownHashesEnabled = verificationMode === "incremental"
    && !verifyContent
    && input.previousSnapshot !== undefined;

  if (budgets.max_parallel_analysis > 1) {
    diagnostics.push({
      code: "corpus.analysis_parallelism_recorded",
      severity: "info",
      message:
        `max_parallel_analysis=${budgets.max_parallel_analysis} was recorded, but candidate `
        + "generation is a single pass over evidence already in memory; the value is not "
        + "exercised in this release",
    });
  }
  if (budgets.max_parallel_hashers > 1) {
    diagnostics.push({
      code: "corpus.hasher_parallelism_clamped",
      severity: "info",
      message:
        `max_parallel_hashers=${budgets.max_parallel_hashers} was recorded, but acquisition `
        + "hashes each root with one streaming reader; the value is not exercised in this release",
    });
  }

  // ── 1. acquire every root, read-only ────────────────────────────────────
  const observations: { binding: CorpusRootBinding; observation: LocalSourceObservation }[] = [];
  const failedRoots: { rootKey: string; rootId: string; reason: string }[] = [];
  const disposals: LocalSourceObservation[] = [];
  try {
    let acquiredRoots = 0;
    for (const spec of input.roots) {
      // Between roots, so a corpus of several drives is not one block the length
      // of every drive together.
      if (acquiredRoots > 0) await yieldToEventLoop();
      acquiredRoots += 1;
      const rootKey = spec.name !== undefined && spec.name.length > 0
        ? spec.name
        : defaultRootKey(spec.path);
      assertUsableRootKey(rootKey, spec.path);
      // An unplugged drive is a fact about the corpus and has to end up inside
      // it. Swallowing the failure and carrying on would produce a snapshot that
      // looks complete and is missing a disk, which is the one outcome a corpus
      // spread across removable media must never produce.
      let observation: LocalSourceObservation;
      try {
        observation = acquireLocalSource({
          path: spec.path,
          sourceKind: "auto",
          name: rootKey,
          ...(knownHashesEnabled
            ? { knownHashes: knownHashesForRoot(corpusRootId(rootKey), input.previousSnapshot) }
            : {}),
          expandArchives: input.expandArchives !== false,
          ...(input.archivePolicy ? { archivePolicy: input.archivePolicy } : {}),
          ...(input.omitPatterns ? { omitPatterns: input.omitPatterns } : {}),
          ...(input.omitFile !== undefined ? { omitFile: input.omitFile } : {}),
          ...(input.hashMaxBytes !== undefined ? { hashMaxBytes: input.hashMaxBytes } : {}),
          ...(input.scratchParent !== undefined ? { scratchParent: input.scratchParent } : {}),
          archiveManifests: archiveManifestStore,
        });
      } catch (error) {
        if (input.allowPartialRoots !== true) throw error;
        const reason = error instanceof Error ? error.message : String(error);
        failedRoots.push({ rootKey, rootId: corpusRootId(rootKey), reason });
        diagnostics.push({
          code: "corpus.root_unreadable",
          severity: "error",
          message: `root '${rootKey}' could not be observed and is missing from this corpus: ${reason}`,
        });
        continue;
      }
      disposals.push(observation);
      if (!observation.stable) {
        const unstable = `corpus: SOURCE_CHANGED_DURING_OBSERVATION under root '${rootKey}'; `
          + "the root changed while it was being read, so it has no deterministic snapshot";
        if (input.allowPartialRoots !== true) throw new Error(unstable);
        failedRoots.push({ rootKey, rootId: corpusRootId(rootKey), reason: unstable });
        diagnostics.push({ code: "corpus.root_unstable", severity: "error", message: unstable });
        continue;
      }
      const rootId = corpusRootId(rootKey);
      observations.push({
        binding: {
          root_id: rootId,
          root_key: rootKey,
          root_label: rootKey,
          root_snapshot_id: corpusRootSnapshotId(observation.physicalSnapshotHash),
          source_kind: observation.sourceKind,
          source_revision: observation.sourceRevision,
          physical_snapshot_hash: observation.physicalSnapshotHash,
          absolute_path: path.resolve(spec.path),
          key_declared: spec.name !== undefined && spec.name.length > 0,
        },
        observation,
      });
    }

    const bound = bindCorpusRoots(observations.map((entry) => entry.binding));
    for (const folded of bound.folded) {
      diagnostics.push({
        code: "corpus.root_folded",
        severity: "info",
        message:
          `root '${folded.root_key}' was mounted twice with identical content; `
          + `${folded.absolute_path} was folded into ${folded.kept_absolute_path}`,
      });
    }
    const keptPaths = new Set(bound.roots.map((root) => root.absolute_path));
    const active = observations.filter((entry) => keptPaths.has(entry.binding.absolute_path));
    const bindingById = new Map(bound.roots.map((root) => [root.root_id, root]));

    // ── 2. corpus identity ────────────────────────────────────────────────
    const candidateProfile = candidateProfileHash({
      topicThreshold,
      nearDuplicateThreshold,
    });
    const corpusProfileHash = stableId("corpus-profile", {
      candidate_profile_hash: candidateProfile,
      corpus_profile_id: CORPUS_PROFILE_ID,
      corpus_profile_version: CORPUS_PROFILE_VERSION,
      exact_duplicate_method: EXACT_DUPLICATE_METHOD,
      exact_duplicate_version: EXACT_DUPLICATE_METHOD_VERSION,
      expand_archives: input.expandArchives !== false,
      interpretation_enabled: interpretEnabled,
      interpretation_profile_hash: interpretProfile,
      max_file_bytes: maxFileBytes,
      near_duplicate_enabled: nearDuplicatesEnabled,
      near_duplicate_method: NEAR_DUPLICATE_METHOD,
      near_duplicate_version: NEAR_DUPLICATE_METHOD_VERSION,
      readiness_profile_hash: readinessProfileHash(),
      text_decoder_id: TEXT_DECODER_ID,
      text_decoder_version: TEXT_DECODER_VERSION,
      topic_candidates_enabled: topicsEnabled,
    });
    const corpusIdLabel = input.corpusId ?? DEFAULT_CORPUS_ID;
    // Every decoder that can claim bytes in this release, named with its version.
    // A decoder revision changes what the normalized documents say and so changes
    // the analysis identity; it changes nothing about the bytes.
    const documentDecoderProfiles: readonly string[] = [
      ...registry.profile(),
      `${MANIFEST_DECODER_ID}@${MANIFEST_DECODER_VERSION}`,
    ];
    const embeddingProfile: string | null = input.embeddingReport?.enabled === true
      ? stableId("embedding-profile", {
          chunk_profile: input.embeddingReport.chunk_profile,
          model_id: input.embeddingReport.model_id ?? "",
          model_revision: input.embeddingReport.model_revision ?? "",
          provider: input.embeddingReport.provider ?? "",
        })
      : null;

    // ── 3. corpus artifacts ───────────────────────────────────────────────
    const previousPrechecks = input.previousSnapshot
      ? snapshotPrechecks(input.previousSnapshot)
      : new Map<string, { size_bytes: number; mtime_ms: number }>();
    const precheck = { predicted_unchanged: 0, confirmed_unchanged: 0, contradicted: 0 };
    const previousHashes = new Map<string, string | null>(
      (input.previousSnapshot?.artifacts ?? []).map((artifact) => [
        artifact.virtual_source_id,
        artifact.content_hash,
      ]),
    );

    const artifacts: ScanArtifact[] = [];
    const archives: CorpusSnapshotArchive[] = [];
    const rootPathsById = new Map<string, Set<string>>();
    let scannedFiles = 0;
    let scannedBytes = 0;
    let recordsSeen = 0;

    for (const entry of active) {
      const binding = bindingById.get(entry.binding.root_id) as CorpusRootBinding;
      const observed = new Set<string>();
      const memberPaths = new Set(
        entry.observation.virtualArtifacts.map((member) => member.virtualSourcePath),
      );
      for (const record of entry.observation.inventory.records) {
        // Counted per record rather than per artifact: folders are skipped below,
        // so a run of them at a multiple of the interval would otherwise yield
        // once for each of them.
        recordsSeen += 1;
        if (recordsSeen % YIELD_INTERVAL === 0) await yieldToEventLoop();
        observed.add(record.relative_path);
        if (record.artifact_type === "folder") continue;
        const rootRelativePath = record.relative_path;
        const identity = virtualSourceId(binding.root_id, rootRelativePath);
        const basename = basenameOf(rootRelativePath);
        const contentHash = normalizeHash(record.content_hash);
        const artifact: ScanArtifact = {
          virtualSourceId: identity,
          corpusPath: corpusPath(binding.root_label, rootRelativePath),
          rootId: binding.root_id,
          rootRelativePath,
          absolutePath: record.absolute_path,
          contentHash,
          sizeBytes: record.size_bytes,
          artifactType: record.artifact_type,
          isArchiveMember: memberPaths.has(rootRelativePath),
          basename,
          extension: extensionOf(basename),
        };
        if (!artifact.isArchiveMember && record.absolute_path !== null) {
          try {
            const stats = fs.statSync(record.absolute_path);
            // The nanosecond field is recorded when the platform keeps one, so
            // the next incremental run can revalidate against the finest tick
            // available rather than a millisecond one it might sit inside.
            let mtimeNs: string | null = null;
            try {
              mtimeNs = fs.statSync(record.absolute_path, { bigint: true }).mtimeNs.toString();
            } catch {
              // No high-resolution stat here; the millisecond field still stands.
            }
            artifact.statPrecheck = {
              size_bytes: stats.size,
              mtime_ms: Math.trunc(stats.mtimeMs),
              ...(mtimeNs !== null ? { mtime_ns: mtimeNs } : {}),
            };
          } catch {
            // A file that vanished between acquisition and here contributes no
            // hint. It contributes no identity either: the hash already decided.
          }
        }
        // The hint is scored against the hash that was just computed, and then
        // discarded. It has no other effect anywhere in this file.
        if (artifact.statPrecheck !== undefined
          && statPrecheckMatches(previousPrechecks.get(identity), artifact.statPrecheck)) {
          precheck.predicted_unchanged += 1;
          if (previousHashes.get(identity) === contentHash) precheck.confirmed_unchanged += 1;
          else precheck.contradicted += 1;
        }
        scannedFiles += 1;
        scannedBytes += record.size_bytes ?? 0;
        if (contentHash !== null) {
          cached(cache, "raw_identity", rawIdentityKey({ contentHash }), () => ({
            exact_content_hash: contentHash,
          }));
          session?.completeSource(identity);
        }
        artifacts.push(artifact);
      }
      rootPathsById.set(binding.root_id, observed);

      for (const archive of entry.observation.archives) {
        archives.push({
          archive_id: virtualSourceId(binding.root_id, archive.sourcePath),
          corpus_path: corpusPath(binding.root_label, archive.sourcePath),
          root_id: binding.root_id,
          content_hash: archive.contentHash,
          size_bytes: archive.sizeBytes,
          member_count: archive.memberCount,
          expanded: archive.expanded,
        });
        session?.completeArchive(archive.contentHash);
      }

      for (const diagnostic of entry.observation.diagnostics) {
        if (diagnostic.severity === "info") continue;
        diagnostics.push({
          code: diagnostic.code,
          severity: diagnostic.severity,
          message: diagnostic.message,
          ...(diagnostic.sourcePath !== undefined
            ? { corpus_path: corpusPath(binding.root_label, diagnostic.sourcePath) }
            : {}),
        });
      }
    }

    artifacts.sort((a, b) => compareCodePoints(a.corpusPath, b.corpusPath));

    // ── 4. derived layers, keyed on content ───────────────────────────────
    const normalized = new Map<string, NormalizedDocumentRecord>();
    const lexical = new Map<string, LexicalFeatureRecord>();
    const interpreted = new Map<string, InterpretationRecord>();
    const skipped = { secret: 0, oversized: 0, encoding: 0, unreadable: 0 };
    const manifestIdentifiers = new Map<string, DeclaredIdentifier | null>();

    const memory = new MemoryBudget(budgets.max_memory_bytes);
    // Anything an extractor claims must be something the decoder is willing to
    // open, or interpretation coverage would report a gap the decoder set caused
    // rather than the corpus. The extension list is the floor, not the ceiling.
    const decodable = artifacts.filter(
      (artifact) =>
        artifact.contentHash !== null
        && (isDecodable(artifact.rootRelativePath, registry)
          || extractors.some((extractor) => extractor.matches(artifact.rootRelativePath))),
    );

    await boundedMap(decodable, budgets.max_parallel_decoders, (artifact) =>
      deriveDocumentLayers(artifact, {
        cache,
        ...(session !== undefined ? { session } : {}),
        memory,
        extractors,
        candidateProfile,
        interpretProfile,
        interpretEnabled,
        maxFileBytes,
        rootPathsById,
        rootKeyById: new Map(bound.roots.map((root) => [root.root_id, root.root_key])),
        registry,
        into: { normalized, lexical, interpreted, manifestIdentifiers, skipped },
      }));

    // ── 4b. per-root Repository Model Packets ─────────────────────────────
    // Each root is modelled on its own, exactly as it would be if it had been
    // observed alone: the corpus is an analysis over several roots, not a
    // synthetic filesystem that replaces them. Nothing about the corpus — its
    // name, its other roots, its thresholds — reaches a packet, so a root carries
    // the same packet id into every corpus it is ever named in.
    const builtPackets: {
      binding: CorpusRootBinding;
      packet: RepositoryModelPacket;
      localSourceManifest: LocalSourceManifest;
    }[] = [];
    for (const entry of active) {
      const binding = bindingById.get(entry.binding.root_id) as CorpusRootBinding;
      const rootAssertions: InterpretedAssertion[] = [];
      const rootDiagnostics: InterpretationDiagnostic[] = [];
      for (const artifact of artifacts) {
        if (artifact.rootId !== binding.root_id) continue;
        const record = interpreted.get(artifact.virtualSourceId);
        if (record === undefined) continue;
        rootAssertions.push(...record.assertions);
        rootDiagnostics.push(...record.diagnostics);
      }
      const packet = buildRepositoryModelPacket({
        inventory: entry.observation.inventory,
        repositoryName: binding.root_key,
        sourceRevision: binding.source_revision,
        producerVersion: input.producerVersion,
        localSource: toRepositoryModelLocalSource(entry.observation),
        ...(interpretEnabled
          ? {
              interpretation: {
                profile: {
                  profile_id: INTERPRETATION_PROFILE_ID,
                  profile_version: INTERPRETATION_PROFILE_VERSION,
                  profile_hash: interpretProfile,
                  extractor_versions: Object.fromEntries(
                    [...extractors]
                      .sort((a, b) => compareCodePoints(a.id, b.id))
                      .map((extractor) => [extractor.id, extractor.version]),
                  ),
                },
                // Sorted so a packet does not inherit the order documents happened
                // to finish decoding in; the decode stage is bounded-parallel.
                assertions: [...rootAssertions].sort((a, b) =>
                  compareCodePoints(a.assertion_id, b.assertion_id)),
                diagnostics: [...rootDiagnostics].sort((a, b) =>
                  compareCodePoints(a.code, b.code) || compareCodePoints(a.message, b.message)),
              },
            }
          : {}),
        ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
      });
      builtPackets.push({
        binding,
        packet,
        // Operational, and the only wall clock in a root's own outputs: it says
        // when the drive was read, which is a fact about the run rather than
        // about the corpus. Deterministic unless the caller supplies one.
        localSourceManifest: buildLocalSourceManifest(entry.observation, {
          observedAt: input.observedAt ?? "1970-01-01T00:00:00.000Z",
        }),
      });
    }
    builtPackets.sort((a, b) => compareCodePoints(a.binding.root_id, b.binding.root_id));
    const packetByRoot = new Map(builtPackets.map((e) => [e.binding.root_id, e.packet]));

    // ── 4c. corpus identity, in two halves ────────────────────────────────
    const sourceSnapshotId = corpusSourceSnapshotId(
      bound.roots.map((root) => ({
        root_id: root.root_id,
        source_revision: root.source_revision,
        rmp_packet_id: packetByRoot.get(root.root_id)?.packet_id ?? "",
      })),
    );
    const analysisIdentity: CorpusAnalysisIdentity = {
      corpus_analysis_id: corpusAnalysisId({
        corpusSourceSnapshotId: sourceSnapshotId,
        profiles: {
          corpus_profile: corpusProfileHash,
          document_decoder_profiles: documentDecoderProfiles,
          interpretation_profile: interpretProfile,
          semantic_candidate_profile: candidateProfile,
          ...(embeddingProfile !== null ? { embedding_profile: embeddingProfile } : {}),
          readiness_profile: readinessProfileHash(),
        },
      }),
      corpus_profile: corpusProfileHash,
      document_decoder_profiles: [...documentDecoderProfiles],
      interpretation_profile: interpretProfile,
      semantic_candidate_profile: candidateProfile,
      embedding_profile: embeddingProfile,
      readiness_profile: readinessProfileHash(),
    };
    session?.setTarget(sourceSnapshotId);

    // ── 5. readiness signals ──────────────────────────────────────────────
    const readinessInputs: ReadinessArtifactInput[] = artifacts.map((artifact) => ({
      virtual_source_id: artifact.virtualSourceId,
      corpus_path: artifact.corpusPath,
      root_relative_path: artifact.rootRelativePath,
      content_hash: artifact.contentHash,
      size_bytes: artifact.sizeBytes,
      is_archive_member: artifact.isArchiveMember,
      // The outermost archive a member sits in, so two members of one ZIP count
      // as one archive rather than two.
      archive_id: archiveAncestryOf(artifact.rootRelativePath)[0] ?? null,
      decoded: normalized.get(artifact.virtualSourceId)?.decodes === true,
      unsupported_format: undecodedExtensions.has(artifact.extension),
      assertions: (interpreted.get(artifact.virtualSourceId)?.assertions ?? []).map((assertion) => ({
        predicate: assertion.predicate,
        object: assertion.object,
      })),
    }));
    const signalsById = new Map<string, ReadinessSignal[]>(
      readinessInputs.map((artifact) => [artifact.virtual_source_id, readinessSignalsFor(artifact)]),
    );

    // ── 6. corpus-scope analyses ──────────────────────────────────────────
    const clusters = clusterExactDuplicates(
      artifacts
        .filter((artifact) => artifact.contentHash !== null)
        .map((artifact) => ({
          artifactId: artifact.virtualSourceId,
          sourcePath: artifact.corpusPath,
          contentHash: artifact.contentHash as string,
          sizeBytes: artifact.sizeBytes,
        })),
    );
    const relations = buildDuplicateRelations(clusters);

    const lexicalDocuments: NearDuplicateDocument[] = [];
    for (const artifact of artifacts) {
      const features = lexical.get(artifact.virtualSourceId);
      if (features === undefined || artifact.contentHash === null) continue;
      lexicalDocuments.push({
        artifactId: artifact.virtualSourceId,
        sourcePath: artifact.corpusPath,
        contentHash: artifact.contentHash,
        normalizedContentHash: features.normalized_content_hash,
        shingles: new Set(features.shingles),
        tokenCount: features.token_count,
      });
    }
    // Each input's identity, not just its bytes. The candidate documents embed
    // artifact ids and corpus paths, so a corpus whose documents are unchanged but
    // renamed is a different input to this analysis: keying on content alone would
    // serve back candidates naming artifacts the current snapshot does not have.
    const featureIdentities = lexicalDocuments.map(
      (document) => `${document.artifactId} ${document.sourcePath} ${document.normalizedContentHash}`,
    );

    const nearKey = candidateAnalysisKey({
      inputFeatureIdentities: [...featureIdentities, `near:${nearDuplicateThreshold.toFixed(6)}`],
      candidateProfileHash: candidateProfile,
    });
    const nearCandidates = nearDuplicatesEnabled
      ? cached(cache, "candidate_analysis", nearKey, () =>
        nearDuplicateCandidates(lexicalDocuments, nearDuplicateThreshold))
      : [];
    if (nearDuplicatesEnabled) session?.completeAnalysis(nearKey);

    const topicKey = candidateAnalysisKey({
      inputFeatureIdentities: [...featureIdentities, `topic:${topicThreshold.toFixed(6)}`],
      candidateProfileHash: candidateProfile,
    });
    const rootByArtifact = new Map(artifacts.map((artifact) => [artifact.virtualSourceId, artifact.rootId]));
    const topicCandidates = topicsEnabled
      ? cached(cache, "candidate_analysis", topicKey, () =>
        buildTopicCandidates({
          documents: artifacts
            .filter((artifact) => lexical.has(artifact.virtualSourceId))
            .map((artifact) => {
              const features = lexical.get(artifact.virtualSourceId) as LexicalFeatureRecord;
              return {
                virtual_source_id: artifact.virtualSourceId,
                corpus_path: artifact.corpusPath,
                term_counts: features.term_counts,
                token_count: features.token_count,
              };
            }),
          threshold: topicThreshold,
          rootById: rootByArtifact,
        }))
      : [];
    if (topicsEnabled) session?.completeAnalysis(topicKey);

    const markers: ProjectMarker[] = [];
    for (const artifact of artifacts) {
      const signals = signalsById.get(artifact.virtualSourceId) ?? [];
      const isManifest = signals.some((signal) => signal.signal === "artifact.has_build_manifest");
      const isCi = signals.some((signal) => signal.signal === "artifact.has_ci_definition");
      if (!isManifest && !isCi) continue;
      const declared = isManifest ? manifestIdentifiers.get(artifact.virtualSourceId) ?? null : null;
      markers.push({
        virtual_source_id: artifact.virtualSourceId,
        root_id: artifact.rootId,
        root_relative_path: artifact.rootRelativePath,
        corpus_path: artifact.corpusPath,
        marker_kind: isManifest ? "build_manifest" : "ci_definition",
        ...(declared !== null
          ? {
            declared_identifier: declared.identifier,
            declared_identifier_evidence: { field: declared.field, line: declared.line },
          }
          : {}),
      });
    }
    const projectCandidates = buildProjectCandidates({
      markers,
      members: artifacts.map((artifact) => ({
        virtual_source_id: artifact.virtualSourceId,
        root_id: artifact.rootId,
        root_relative_path: artifact.rootRelativePath,
        corpus_path: artifact.corpusPath,
      })),
      rootLabels: new Map(bound.roots.map((root) => [root.root_id, root.root_label])),
    });

    // ── 7. projections ────────────────────────────────────────────────────
    const clusterByArtifact = new Map<string, string>();
    for (const cluster of clusters) {
      for (const artifactId of cluster.artifact_ids) clusterByArtifact.set(artifactId, cluster.cluster_id);
    }
    const nearByArtifact = indexMembership(nearCandidates, (candidate) => [
      candidate.artifact_a_id,
      candidate.artifact_b_id,
    ], (candidate) => candidate.candidate_id);
    const topicByArtifact = indexMembership(
      topicCandidates,
      (candidate) => candidate.member_ids,
      (candidate) => candidate.candidate_id,
    );
    const projectByArtifact = indexMembership(
      projectCandidates,
      (candidate) => candidate.member_ids,
      (candidate) => candidate.candidate_id,
    );

    const snapshotArtifacts: CorpusSnapshotArtifact[] = artifacts.map((artifact) => ({
      virtual_source_id: artifact.virtualSourceId,
      corpus_path: artifact.corpusPath,
      root_id: artifact.rootId,
      root_relative_path: artifact.rootRelativePath,
      content_hash: artifact.contentHash,
      size_bytes: artifact.sizeBytes,
      is_archive_member: artifact.isArchiveMember,
      artifact_type: artifact.artifactType,
      ...(artifact.statPrecheck !== undefined ? { stat_precheck: artifact.statPrecheck } : {}),
    }));

    const orderedArchives = [...archives].sort(
      (a, b) => compareCodePoints(a.corpus_path, b.corpus_path),
    );
    const snapshotRoots: CorpusSnapshotRoot[] = bound.roots.map((root) => {
      const packet = packetByRoot.get(root.root_id);
      return {
        ...rootIdentity(root),
        rmp_packet_id: packet?.packet_id ?? "",
        rmp_semantic_hash: packet?.semantic_hash ?? "",
        // Output-relative, so a snapshot copied to another machine still points at
        // its own bundles. The absolute location is the operator's business.
        bundle_ref: packet === undefined ? null : `roots/${rootDirectoryName(root.root_key)}/bundle`,
        observation_status: packet === undefined ? "failed" : "observed",
        failure_reason: null,
      };
    });
    const hashingTotals = active.reduce(
      (sum, entry) => ({
        fully_rehashed_count: sum.fully_rehashed_count + entry.observation.hashing.fully_rehashed_count,
        cached_reuse_count: sum.cached_reuse_count + entry.observation.hashing.cached_reuse_count,
        unhashed_count: sum.unhashed_count + entry.observation.hashing.unhashed_count,
      }),
      { fully_rehashed_count: 0, cached_reuse_count: 0, unhashed_count: 0 },
    );
    // The label follows the run, not the request. An incremental run that happened
    // to reuse nothing did read every byte and may say so; a run that reused even
    // one hash did not, whatever mode it was asked for.
    const verification: CorpusVerification = {
      mode: verificationMode,
      verify_content_requested: verifyContent,
      verification_class: hashingTotals.cached_reuse_count === 0
        ? "fully_verified"
        : "cached_unchanged_assumption",
      fully_rehashed_artifact_count: hashingTotals.fully_rehashed_count,
      cached_hash_reuse_count: hashingTotals.cached_reuse_count,
      unhashed_artifact_count: hashingTotals.unhashed_count,
      statement: hashingTotals.cached_reuse_count === 0
        ? FULLY_VERIFIED_STATEMENT
        : CACHED_ASSUMPTION_STATEMENT,
    };
    // A root that was named and could not be read appears in the snapshot as a
    // missing root, not as an absence. Downstream, "12 project candidates" over a
    // corpus with an unplugged drive is a different claim from the same number
    // over a whole one, and the only way it can be told is if the snapshot says so.
    for (const failed of failedRoots) {
      snapshotRoots.push({
        root_id: failed.rootId,
        root_key: failed.rootKey,
        root_label: failed.rootKey,
        root_snapshot_id: "",
        source_kind: "unknown",
        source_revision: "",
        physical_snapshot_hash: "",
        rmp_packet_id: "",
        rmp_semantic_hash: "",
        bundle_ref: null,
        observation_status: "missing",
        failure_reason: failed.reason,
      });
    }
    snapshotRoots.sort((a, b) => compareCodePoints(a.root_id, b.root_id));
    const corpusStatus: CorpusStatus = snapshotRoots.every(
      (root) => root.observation_status === "observed",
    )
      ? "complete"
      : "partial";
    const snapshot: CorpusSnapshot = {
      schema: CORPUS_SNAPSHOT_SCHEMA,
      corpus_id: corpusIdLabel,
      corpus_source_snapshot_id: sourceSnapshotId,
      analysis: analysisIdentity,
      corpus_status: corpusStatus,
      verification,
      missing_root_ids: failedRoots.map((failed) => failed.rootId).sort(compareCodePoints),
      roots: snapshotRoots,
      artifacts: snapshotArtifacts,
      archives: orderedArchives,
      counts: {
        root_count_requested: input.roots.length,
        root_count_observed: bound.roots.length,
        root_count_failed: failedRoots.length,
        root_count: bound.roots.length,
        artifact_count: artifacts.length,
        archive_count: archives.length,
        archive_member_count: artifacts.filter((artifact) => artifact.isArchiveMember).length,
        total_bytes: artifacts.reduce((sum, artifact) => sum + (artifact.sizeBytes ?? 0), 0),
      },
    };

    const crossRoot = <T extends { root_ids: string[] }>(items: readonly T[]): number =>
      items.filter((item) => item.root_ids.length > 1).length;
    const clusterRootIds = (cluster: CorpusDuplicateCluster): string[] => [
      ...new Set(cluster.artifact_ids.map((id) => rootByArtifact.get(id) ?? "")),
    ];

    const candidatesDocument: CorpusCandidatesDocument = {
      schema: CORPUS_CANDIDATES_SCHEMA,
      corpus_source_snapshot_id: sourceSnapshotId,
      corpus_analysis_id: analysisIdentity.corpus_analysis_id,
      corpus_profile_hash: corpusProfileHash,
      roots: bound.roots.map(rootIdentity),
      analysis_profile: {
        corpus_profile_id: CORPUS_PROFILE_ID,
        corpus_profile_version: CORPUS_PROFILE_VERSION,
        exact_duplicate_method: EXACT_DUPLICATE_METHOD,
        exact_duplicate_version: EXACT_DUPLICATE_METHOD_VERSION,
        near_duplicate_method: NEAR_DUPLICATE_METHOD,
        near_duplicate_version: NEAR_DUPLICATE_METHOD_VERSION,
        near_duplicate_threshold: Math.round(nearDuplicateThreshold * 1e6) / 1e6,
        near_duplicate_enabled: nearDuplicatesEnabled,
        topic_candidate_method: topicCandidates[0]?.method ?? "lexical-topic-candidate/v1",
        topic_candidate_version: topicCandidates[0]?.algorithm_version ?? "1.0.0",
        topic_threshold: Math.round(topicThreshold * 1e6) / 1e6,
        topic_candidates_enabled: topicsEnabled,
        project_candidate_method: "container-project-candidate/v1",
        project_candidate_version: "1.0.0",
        candidate_profile_hash: candidateProfile,
        interpretation_profile_hash: interpretProfile,
      },
      summary: {
        artifact_count: artifacts.length,
        archive_count: archives.length,
        archive_member_count: snapshot.counts.archive_member_count,
        root_count: bound.roots.length,
        exact_duplicate_cluster_count: clusters.length,
        exact_duplicate_artifact_count: clusters.reduce((sum, cluster) => sum + cluster.count, 0),
        cross_root_duplicate_cluster_count: clusters.filter(
          (cluster) => clusterRootIds(cluster).length > 1,
        ).length,
        recoverable_duplicate_bytes: clusters.reduce(
          (sum, cluster) => sum + cluster.recoverable_bytes,
          0,
        ),
        near_duplicate_candidate_count: nearCandidates.length,
        cross_root_near_duplicate_count: nearCandidates.filter(
          (candidate) =>
            rootByArtifact.get(candidate.artifact_a_id) !== rootByArtifact.get(candidate.artifact_b_id),
        ).length,
        topic_candidate_count: topicCandidates.length,
        cross_root_topic_candidate_count: crossRoot(topicCandidates),
        project_candidate_count: projectCandidates.length,
        cross_root_project_candidate_count: crossRoot(projectCandidates),
      },
      artifacts: artifacts.map((artifact) => ({
        virtual_source_id: artifact.virtualSourceId,
        corpus_path: artifact.corpusPath,
        root_id: artifact.rootId,
        artifact_type: artifact.artifactType,
        content_hash: artifact.contentHash,
        size_bytes: artifact.sizeBytes,
        is_archive_member: artifact.isArchiveMember,
        exact_duplicate_cluster_id: clusterByArtifact.get(artifact.virtualSourceId) ?? null,
        near_duplicate_candidate_ids: (nearByArtifact.get(artifact.virtualSourceId) ?? []).sort(
          compareCodePoints,
        ),
        topic_candidate_ids: (topicByArtifact.get(artifact.virtualSourceId) ?? []).sort(compareCodePoints),
        project_candidate_ids: (projectByArtifact.get(artifact.virtualSourceId) ?? []).sort(
          compareCodePoints,
        ),
      })),
      exact_duplicate_clusters: clusters,
      relations,
      near_duplicate_candidates: nearCandidates,
      topic_candidates: topicCandidates,
      project_candidates: projectCandidates,
      candidate_statement: CANDIDATE_STATEMENT,
    };

    const exactDuplicateIds = new Set(clusterByArtifact.keys());
    const nearPairs = nearCandidates.map(
      (candidate) => [candidate.artifact_a_id, candidate.artifact_b_id] as const,
    );
    const bodies: BodyOfWorkSpec[] = projectCandidates.map((candidate) => ({
      origin: candidate.identifier_is_declared ? "explicit_project_identifier" : "project_candidate",
      origin_ref: candidate.project_key,
      member_ids: candidate.member_ids,
    }));
    // ── 7. normalized documents, written down ─────────────────────────────
    //
    // Every field below was already established above. The index exists because
    // a later pass reasoning over documents cannot recover which artifact a
    // document came from, which source bytes it describes, or which decoder
    // produced it, once the run has ended.
    const documentIndex = buildDocumentIndex({
      corpusSourceSnapshotId: sourceSnapshotId,
      corpusAnalysisId: analysisIdentity.corpus_analysis_id,
      decoderId: TEXT_DECODER_ID,
      decoderVersion: TEXT_DECODER_VERSION,
      artifacts: artifacts.map((artifact) => {
        const record = normalized.get(artifact.virtualSourceId);
        return {
          artifactId: artifact.virtualSourceId,
          rootId: artifact.rootId,
          corpusPath: artifact.corpusPath,
          rootRelativePath: artifact.rootRelativePath,
          contentHash: artifact.contentHash,
          sizeBytes: artifact.sizeBytes,
          isArchiveMember: artifact.isArchiveMember,
          archiveAncestry: archiveAncestryOf(artifact.rootRelativePath),
          ...(record !== undefined ? { normalized: record } : {}),
          normalizedDocumentId: artifact.contentHash === null
            ? null
            : normalizedDocumentKey({
              contentHash: artifact.contentHash,
              decoderId: TEXT_DECODER_ID,
              decoderVersion: TEXT_DECODER_VERSION,
            }),
        };
      }),
    });

    // ── 7b. per-root projections ──────────────────────────────────────────
    // Each root's own index, built from the same records as the corpus one but
    // scoped to that root. An operator who later wants only the old SSD finds it
    // whole under `roots/old-ssd/` rather than having to filter a corpus file.
    const documentsByRoot = new Map<string, typeof documentIndex.documents>();
    for (const document of documentIndex.documents) {
      const bucket = documentsByRoot.get(document.root_id) ?? [];
      bucket.push(document);
      documentsByRoot.set(document.root_id, bucket);
    }
    const rootPackets: CorpusRootPacket[] = builtPackets.map((entry) => {
      const documents = documentsByRoot.get(entry.binding.root_id) ?? [];
      const decoded = documents.filter((document) => document.decoded);
      const undecodedCounts = new Map<string, number>();
      for (const document of documents) {
        if (document.decoded) continue;
        const reason = document.undecoded_reason ?? UNDECODED_REASON_NOT_ELIGIBLE;
        undecodedCounts.set(reason, (undecodedCounts.get(reason) ?? 0) + 1);
      }
      const rootIndex: DocumentIndex = {
        ...documentIndex,
        summary: {
          artifact_count: documents.length,
          decoded_count: decoded.length,
          undecoded_count: documents.length - decoded.length,
          distinct_document_count: new Set(
            decoded.map((document) => document.normalized_document_id ?? ""),
          ).size,
          archive_member_count: documents.filter((d) => d.is_archive_member).length,
          total_token_count: decoded.reduce((sum, d) => sum + (d.token_count ?? 0), 0),
          undecoded_by_reason: [...undecodedCounts.entries()]
            .map(([reason, count]) => ({ reason, count }))
            .sort((a, b) => compareCodePoints(a.reason, b.reason)),
        },
        documents,
      };
      return {
        root_id: entry.binding.root_id,
        root_key: entry.binding.root_key,
        directory: rootDirectoryName(entry.binding.root_key),
        packet: entry.packet,
        localSourceManifest: entry.localSourceManifest,
        documentIndex: rootIndex,
        documentCoverage: {
          schema: DOCUMENT_COVERAGE_SCHEMA,
          corpus_source_snapshot_id: sourceSnapshotId,
          corpus_analysis_id: analysisIdentity.corpus_analysis_id,
          root_id: entry.binding.root_id,
          root_key: entry.binding.root_key,
          decoder: { decoder_id: TEXT_DECODER_ID, decoder_version: TEXT_DECODER_VERSION },
          ...rootIndex.summary,
        },
      };
    });

    // ── 8. semantic candidate discovery ───────────────────────────────────
    let semantic: SemanticAnalysisResult | null = null;
    if (input.semanticAnalysis !== false) {
      const documentById = new Map(documentIndex.documents.map((doc) => [doc.artifact_id, doc]));
      const semanticArtifacts: SemanticArtifactInput[] = artifacts.map((artifact) => {
        const document = documentById.get(artifact.virtualSourceId);
        const declared = manifestIdentifiers.get(artifact.virtualSourceId) ?? null;
        const features = lexical.get(artifact.virtualSourceId);
        return {
          artifact_id: artifact.virtualSourceId,
          root_id: artifact.rootId,
          corpus_path: artifact.corpusPath,
          root_relative_path: artifact.rootRelativePath,
          content_hash: artifact.contentHash,
          normalized_document_id: document?.normalized_document_id ?? null,
          is_archive_member: artifact.isArchiveMember,
          archive_ancestry: archiveAncestryOf(artifact.rootRelativePath),
          assertions: (interpreted.get(artifact.virtualSourceId)?.assertions ?? []).map(
            (assertion) => ({
              assertion_id: assertion.assertion_id,
              predicate: assertion.predicate,
              object: assertion.object,
            }),
          ),
          declared_identifiers: declared === null
            ? []
            : [{
              identifier: declared.identifier,
              manifest: artifact.basename.toLowerCase(),
              field: declared.field,
            }],
          exact_duplicate_cluster_id: clusterByArtifact.get(artifact.virtualSourceId) ?? null,
          near_duplicate_candidate_ids: nearByArtifact.get(artifact.virtualSourceId) ?? [],
          // Term counts rather than text: the lexical cache holds a bag of words
          // and never a body, so the semantic pass never needs the source back.
          ...(features !== undefined ? { body_term_counts: features.term_counts } : {}),
        };
      });

      const assertionsByArtifact = new Map<string, PackAssertion[]>();
      for (const [artifactId, record] of interpreted) {
        assertionsByArtifact.set(artifactId, record.assertions.map((assertion) => ({
          assertion_id: assertion.assertion_id,
          predicate: assertion.predicate,
          object: assertion.object,
          source_path: assertion.source_path,
          evidence_excerpt: assertion.evidence_excerpt,
          source_content_hash: assertion.source_content_hash,
        })));
      }

      semantic = runSemanticAnalysis({
        corpusSourceSnapshotId: sourceSnapshotId,
      corpusAnalysisId: analysisIdentity.corpus_analysis_id,
        artifacts: semanticArtifacts,
        nearDuplicatePairs: nearCandidates.map((candidate) => ({
          artifact_a_id: candidate.artifact_a_id,
          artifact_b_id: candidate.artifact_b_id,
          score: candidate.score,
        })),
        assertionsByArtifact,
        ...(input.embeddingPairs !== undefined ? { embeddingPairs: input.embeddingPairs } : {}),
        ...(input.embeddingReport !== undefined ? { embeddingReport: input.embeddingReport } : {}),
        ...(input.packBudget !== undefined ? { packBudget: input.packBudget } : {}),
      });
      for (const note of semantic.relations.diagnostics) {
        diagnostics.push({ code: note.code, severity: note.severity, message: note.message });
      }
    }

    // Which artifacts a candidate of any kind actually names. Read off the
    // per-artifact candidate fields rather than inferred, because "the decoder
    // opened it" and "something downstream used it" are different claims and
    // only the second one means the decoding was worth doing.
    const candidateMembers = new Set(
      candidatesDocument.artifacts
        .filter((artifact) =>
          artifact.exact_duplicate_cluster_id !== null
          || artifact.near_duplicate_candidate_ids.length > 0
          || artifact.topic_candidate_ids.length > 0
          || artifact.project_candidate_ids.length > 0)
        .map((artifact) => artifact.virtual_source_id),
    );
    const documentSignals = buildCorpusDocumentSignals({
      corpusSourceSnapshotId: sourceSnapshotId,
      corpusAnalysisId: analysisIdentity.corpus_analysis_id,
      decoderProfiles: registry.profile(),
      documents: [...normalized.entries()].map(([artifactId, record]) => ({
        virtual_source_id: artifactId,
        format: record.format,
        decoder_id: record.decoder_id,
        decoder_version: record.decoder_version,
        decoded: record.decodes,
        reason: record.reason,
        blocks: (record.blocks ?? []).map((block) => ({
          block_id: block.block_id,
          kind: block.kind,
          locator: block.locator,
        })),
      })),
      interpreted: new Set(
        [...interpreted.entries()]
          .filter(([, record]) => record.assertions.length > 0)
          .map(([artifactId]) => artifactId),
      ),
      lexicallyAnalyzed: new Set(lexical.keys()),
      candidateMembers,
    });

    const decodableIds = new Set(decodable.map((artifact) => artifact.virtualSourceId));
    const decodedIds = new Set(
      [...normalized.entries()].filter(([, record]) => record.decodes).map(([id]) => id),
    );
    // Why the eligible documents that are not normalized documents are not.
    //
    // Tallied from the refusal reasons the decoders actually returned rather
    // than guessed from extensions, because the two disagree in exactly the case
    // that matters: a `.pdf` is a format a decoder claims, and a *scanned* `.pdf`
    // is one it opens and correctly reports as having no text layer. An
    // extension-only tally calls the first a decode failure and never sees the
    // second at all.
    const refusalReasons = new Map<string, number>();
    for (const record of normalized.values()) {
      if (record.decodes || record.reason === null) continue;
      refusalReasons.set(record.reason, (refusalReasons.get(record.reason) ?? 0) + 1);
    }
    const refusals = (...reasons: string[]): number =>
      reasons.reduce((sum, reason) => sum + (refusalReasons.get(reason) ?? 0), 0);
    const namedRefusals = new Set([
      "decoder.ocr_required", "decoder.encrypted", "decoder.malformed",
      "not_utf8", "binary", "encoding",
    ]);
    const decodeGap = {
      secret_skipped: skipped.secret,
      oversized: skipped.oversized,
      encoding_rejected: refusals("not_utf8", "binary", "encoding"),
      ocr_required: refusals("decoder.ocr_required"),
      encrypted: refusals("decoder.encrypted"),
      malformed: refusals("decoder.malformed"),
      other_refusal: [...refusalReasons.entries()]
        .filter(([reason]) => !namedRefusals.has(reason))
        .reduce((sum, [, count]) => sum + count, 0),
      unaccounted: 0,
    };
    // The residual, computed rather than assumed zero: if a document goes missing
    // between eligibility and decoding by a route nobody named, it surfaces here
    // instead of vanishing into the difference between two totals.
    decodeGap.unaccounted = decodableIds.size - decodedIds.size
      - decodeGap.secret_skipped - decodeGap.oversized - decodeGap.encoding_rejected
      - decodeGap.ocr_required - decodeGap.encrypted - decodeGap.malformed
      - decodeGap.other_refusal;
    const interpretationEligible = artifacts.filter(
      (artifact) => interpretEnabled && extractors.some((extractor) => extractor.matches(artifact.rootRelativePath)),
    );
    const lexicalEligible = artifacts.filter(
      (artifact) => isLexicallyAnalyzable(artifact.rootRelativePath)
        || isProseDocumentFormat(registry.forPath(artifact.rootRelativePath)?.format ?? ""),
    );
    const encryptedCount = active.reduce(
      (sum, entry) =>
        sum
        + entry.observation.archives.reduce(
          (holds, archive) =>
            holds + archive.holds.filter((hold) => hold.code === "archive.member_encrypted").length,
          0,
        ),
      0,
    );
    // Artifacts carrying at least one `work.*` claim. This is the denominator a
    // reader needs beside "3 blocked": three of eleven documents that say anything
    // about their own state is a different corpus from three of eleven thousand.
    const workSignalArtifacts = new Set<string>();
    for (const [artifactId, record] of interpreted) {
      if (record.assertions.some((assertion) => assertion.predicate.startsWith("work."))) {
        workSignalArtifacts.add(artifactId);
      }
    }
    const dependencyPredicates = new Map<string, number>();
    for (const record of interpreted.values()) {
      for (const assertion of record.assertions) {
        if (!assertion.predicate.startsWith("work.depends_on")
          && !assertion.predicate.startsWith("work.blocked_by")
          && !assertion.predicate.startsWith("work.references")) continue;
        dependencyPredicates.set(
          assertion.predicate,
          (dependencyPredicates.get(assertion.predicate) ?? 0) + 1,
        );
      }
    }
    const uniqueHashes = new Map<string, number>();
    for (const artifact of artifacts) {
      if (artifact.contentHash === null) continue;
      if (!uniqueHashes.has(artifact.contentHash)) {
        uniqueHashes.set(artifact.contentHash, artifact.sizeBytes ?? 0);
      }
    }
    const reasoningEligible = projectCandidates.filter(
      (candidate) =>
        candidate.member_ids.some((id) => decodedIds.has(id))
        && candidate.member_ids.some((id) => (signalsById.get(id) ?? []).length > 0),
    ).length;

    const cacheStats = cacheStatsDelta(cacheAtStart, cache.stats());
    // ── 8b. readiness evidence ────────────────────────────────────────────
    // Built after candidate discovery so a body of work can be told how many
    // consolidation candidates its own members appear in. Readiness is evidence
    // about candidates; it cannot be assembled before the candidates exist.
    const consolidationsByArtifact = new Map<string, string[]>();
    for (const candidate of semantic?.consolidations.candidates ?? []) {
      for (const memberId of candidate.member_artifact_ids) {
        const bucket = consolidationsByArtifact.get(memberId) ?? [];
        bucket.push(candidate.candidate_id);
        consolidationsByArtifact.set(memberId, bucket);
      }
    }
    const readiness = buildReadinessEvidence({
      corpusSourceSnapshotId: sourceSnapshotId,
      corpusAnalysisId: analysisIdentity.corpus_analysis_id,
      artifacts: readinessInputs,
      bodies,
      context: {
        signalsById,
        artifactsById: new Map(
          readinessInputs.map((artifact) => [artifact.virtual_source_id, artifact]),
        ),
        rootById: rootByArtifact,
        exactDuplicateIds,
        clusterByArtifact,
        consolidationsByArtifact,
        nearDuplicatePairs: nearPairs,
      },
    });

    const coverage: CorpusCoverage = {
      schema: CORPUS_COVERAGE_SCHEMA,
      corpus_source_snapshot_id: sourceSnapshotId,
      corpus_analysis_id: analysisIdentity.corpus_analysis_id,
      root_ids: bound.roots.map((root) => root.root_id).sort(compareCodePoints),
      corpus: {
        root_count_requested: snapshot.counts.root_count_requested,
        root_count_observed: snapshot.counts.root_count_observed,
        root_count_failed: snapshot.counts.root_count_failed,
        total_physical_artifacts: artifacts.filter((a) => !a.isArchiveMember).length,
        total_virtual_archive_artifacts: artifacts.filter((a) => a.isArchiveMember).length,
        total_bytes_observed: snapshot.counts.total_bytes,
        archive_count: archives.length,
        archive_member_count: snapshot.counts.archive_member_count,
      },
      hashing: {
        fully_rehashed_count: verification.fully_rehashed_artifact_count,
        cached_hash_reuse_count: verification.cached_hash_reuse_count,
        unhashed_count: verification.unhashed_artifact_count,
        verification_class: verification.verification_class,
        verification_mode: verification.mode,
      },
      documents: {
        decoder_eligible_count: decodableIds.size,
        normalized_document_count: decodedIds.size,
        unsupported_format_count: artifacts.filter(
          (artifact) => undecodedExtensions.has(artifact.extension),
        ).length,
        // A decoder that was offered bytes it claimed and could not read them.
        // Distinct from an artifact no decoder claims — one is a gap in this
        // corpus, the other a gap in the decoder set — and distinct again from a
        // page that simply has no text on it, which is neither.
        decoder_failure_count: decodeGap.malformed + decodeGap.encoding_rejected
          + decodeGap.other_refusal + decodeGap.unaccounted,
        // Two routes to the same finding: a raster file, known by its extension,
        // and a document a decoder opened to discover its pages are images.
        ocr_required_count: artifacts.filter((a) => ocrExtensions.has(a.extension)).length
          + decodeGap.ocr_required,
        encrypted_document_count: encryptedCount + decodeGap.encrypted,
        oversized_document_count: skipped.oversized,
        secret_skipped_count: skipped.secret,
        decode_gap: decodeGap,
      },
      semantics: {
        interpreted_artifact_count: interpreted.size,
        work_signal_artifact_count: workSignalArtifacts.size,
        exact_duplicate_cluster_count: clusters.length,
        near_duplicate_candidate_count: nearCandidates.length,
        topic_candidate_count: topicCandidates.length,
        project_candidate_count: projectCandidates.length,
        consolidation_candidate_count: semantic?.consolidations.candidates.length ?? 0,
      },
      embeddings: {
        enabled: input.embeddingReport?.enabled === true,
        eligible_count: input.embeddingReport?.enabled === true
          ? input.embeddingReport.eligible_artifact_count
          : null,
        embedded_count: input.embeddingReport?.enabled === true
          ? input.embeddingReport.embedded_artifact_count
          : null,
        cache_hit_count: input.embeddingReport?.enabled === true
          ? input.embeddingReport.cache_hits
          : null,
        provider_failure_count: input.embeddingReport?.enabled === true
          ? input.embeddingReport.eligible_artifact_count
            - input.embeddingReport.embedded_artifact_count
            - input.embeddingReport.secret_candidates_skipped
          : null,
      },
      exact_hash_coverage: coverageRatio(
        artifacts.filter((artifact) => artifact.contentHash !== null).length,
        artifacts.length,
      ),
      normalized_document_coverage: coverageRatio(decodedIds.size, decodableIds.size),
      interpretation_coverage: coverageRatio(
        interpretationEligible.filter((artifact) => interpreted.has(artifact.virtualSourceId)).length,
        interpretationEligible.length,
      ),
      lexical_analysis_coverage: coverageRatio(
        lexicalEligible.filter((artifact) => lexical.has(artifact.virtualSourceId)).length,
        lexicalEligible.length,
      ),
      embedding_coverage_when_enabled: null,
      unsupported_format_counts: formatCounts(
        artifacts
          .filter((artifact) => undecodedExtensions.has(artifact.extension))
          .map((artifact) => ({ extension: artifact.extension, bytes: artifact.sizeBytes ?? 0 })),
      ),
      reasoning_handoff: {
        reasoning_eligible_candidate_count: reasoningEligible,
        reasoning_candidate_count: semantic?.reasoningCandidates.length ?? 0,
        reasoning_evidence_pack_count: semantic?.evidencePacks.length ?? 0,
        truncated_evidence_pack_count: semantic?.evidencePacks.filter(
          (pack) => pack.truncation.truncated,
        ).length ?? 0,
        corpus_snapshot_ref: "corpus-snapshot.json",
        corpus_coverage_ref: "corpus-coverage.json",
        readiness_evidence_refs: {
          schema: readiness.schema,
          file: "readiness-evidence.json",
          body_of_work_count: readiness.bodies_of_work.length,
          signal_vocabulary: READINESS_SIGNALS,
        },
        dependency_evidence_refs: [...dependencyPredicates.entries()]
          .map(([predicate, assertion_count]) => ({ predicate, assertion_count }))
          .sort((a, b) => compareCodePoints(a.predicate, b.predicate)),
        duplicate_evidence_refs: {
          exact_duplicate_cluster_count: clusters.length,
          exact_duplicate_artifact_count: exactDuplicateIds.size,
          recoverable_duplicate_bytes: candidatesDocument.summary.recoverable_duplicate_bytes,
          near_duplicate_candidate_count: nearCandidates.length,
          near_duplicate_threshold: Math.round(nearDuplicateThreshold * 1e6) / 1e6,
        },
        unique_content_estimate: uniqueHashes.size,
        unique_content_bytes_estimate: [...uniqueHashes.values()].reduce((sum, bytes) => sum + bytes, 0),
        no_priority_statement: NO_PRIORITY_STATEMENT,
      },
      cache: {
        enabled: cacheStats.enabled,
        hit_ratio: cacheStats.hit_ratio,
        hits: cacheStats.hits,
        misses: cacheStats.misses,
        writes: cacheStats.writes,
        corrupt: cacheStats.corrupt,
        layers: cacheStats.layers.map((layer) => ({
          layer: layer.layer,
          hits: layer.hits,
          misses: layer.misses,
          writes: layer.writes,
          corrupt: layer.corrupt,
        })),
      },
    };

    for (const note of cache.diagnostics().slice(cacheNotesAtStart)) {
      diagnostics.push({
        code: note.code,
        severity: note.severity,
        message: `${note.layer}: ${note.message}`,
      });
      session?.fail({ code: note.code, severity: note.severity, message: note.message });
    }
    if (skipped.encoding > 0) {
      diagnostics.push({
        code: "corpus.unsupported_encoding",
        severity: "info",
        message: `${skipped.encoding} file(s) were hashed but are not valid UTF-8 and were not decoded`,
      });
    }

    const diff = input.previousSnapshot
      ? buildCorpusDiff(input.previousSnapshot, snapshot)
      : null;
    const orderedDiagnostics = [...diagnostics].sort(
      (a, b) => compareCodePoints(a.code, b.code)
        || compareCodePoints(a.corpus_path ?? "", b.corpus_path ?? "")
        || compareCodePoints(a.message, b.message),
    );

    return {
      snapshot,
      rootPackets,
      candidates: candidatesDocument,
      readiness,
      coverage,
      diff,
      diagnostics: orderedDiagnostics,
      cacheStats,
      bindings: bound.roots,
      precheck,
      scanned: { files: scannedFiles, bytes: scannedBytes },
      documentIndex,
      documentSignals,
      semantic,
    };
  } finally {
    for (const observation of disposals) observation.dispose();
  }
}

/** Canonical bytes of the candidate projection. */
export function renderCorpusCandidates(document: CorpusCandidatesDocument): string {
  return `${canonicalCorpusJson(document)}\n`;
}

/** Canonical bytes of one root's document coverage. */
export function renderDocumentCoverage(coverage: RootDocumentCoverage): string {
  return `${canonicalCorpusJson(coverage)}\n`;
}

/** Canonical bytes of the readiness projection. */
export function renderReadinessEvidence(evidence: ReadinessEvidence): string {
  return `${canonicalCorpusJson(evidence)}\n`;
}
