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
  OCR_REQUIRED_EXTENSIONS,
  UNDECODED_DOCUMENT_EXTENSIONS,
  coverageRatio,
  formatCounts,
} from "./corpus_coverage";
import { CorpusDiff, buildCorpusDiff } from "./corpus_diff";
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
  corpusSnapshotId,
  defaultRootKey,
  rootIdentity,
  virtualSourceId,
} from "./corpus_roots";
import {
  CORPUS_SNAPSHOT_SCHEMA,
  CorpusSnapshot,
  CorpusSnapshotArchive,
  CorpusSnapshotArtifact,
  snapshotPrechecks,
} from "./corpus_snapshot";
import {
  CorpusResourceBudgets,
  CorpusSessionStore,
  DEFAULT_CORPUS_BUDGETS,
  MemoryBudget,
  boundedMap,
} from "./corpus_session";
import { probeFileEncoding } from "./encoding";
import { defaultExtractors } from "./extractors";
import {
  DEFAULT_MAX_FILE_BYTES,
  Extractor,
  InterpretedAssertion,
  InterpretationDiagnostic,
  interpretDocumentContent,
  interpretationProfileHash,
  isSecretCandidatePath,
} from "./interpretation";
import { LocalArchivePolicy } from "./local_archive_policy";
import { LocalSourceObservation, acquireLocalSource } from "./local_source";
import { compareCodePoints } from "./ordering";
import { stableId } from "./repository_model";

export const CORPUS_CANDIDATES_SCHEMA = "l9.corpus-candidates/v1";

/** Decoder that turns exact bytes into the text every later layer reads. */
export const TEXT_DECODER_ID = "utf8-text-decoder";
export const TEXT_DECODER_VERSION = "1.0.0";

/** Decoder that reads a build manifest's declared name out of its body. */
export const MANIFEST_DECODER_ID = "manifest-identifier-reader";
export const MANIFEST_DECODER_VERSION = "1.0.0";

/** Extensions the text decoder claims beyond the lexical-analysis set. */
const STRUCTURED_TEXT_EXTENSIONS = new Set([
  ".cfg", ".clj", ".conf", ".gradle", ".ini", ".json", ".mod", ".properties",
  ".sbt", ".toml", ".xml", ".yaml", ".yml",
]);

/** Extensionless files the text decoder claims by name. */
const STRUCTURED_TEXT_NAMES = new Set([
  "dockerfile", "containerfile", "gemfile", "jenkinsfile", "makefile", "procfile",
]);

const LEXICAL_EXTENSIONS = new Set(NEAR_DUPLICATE_EXTENSIONS);
const OCR_EXTENSIONS = new Set(OCR_REQUIRED_EXTENSIONS);
const UNDECODED_EXTENSIONS = new Set(UNDECODED_DOCUMENT_EXTENSIONS);

// ───────────────────────────── inputs ─────────────────────────────

export interface CorpusScanInput {
  roots: readonly CorpusRootSpec[];
  producerVersion: string;
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
}

export interface CorpusScanDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  corpus_path?: string;
}

export interface CorpusCandidatesDocument {
  schema: string;
  corpus_snapshot_id: string;
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

export interface CorpusScanResult {
  snapshot: CorpusSnapshot;
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
  statPrecheck?: { size_bytes: number; mtime_ms: number };
}

/** What the text decoder established about one set of bytes. */
interface NormalizedDocumentRecord {
  decodes: boolean;
  reason: string | null;
  byte_length: number;
  normalized_content_hash: string | null;
  token_count: number;
}

interface LexicalFeatureRecord {
  normalized_content_hash: string;
  token_count: number;
  shingles: string[];
  term_counts: [string, number][];
}

interface InterpretationRecord {
  assertions: InterpretedAssertion[];
  diagnostics: InterpretationDiagnostic[];
}

// ───────────────────────────── helpers ─────────────────────────────

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

/** True when the text decoder claims this artifact at all. */
export function isTextDecodable(rootRelativePath: string): boolean {
  const basename = basenameOf(rootRelativePath);
  const extension = extensionOf(basename);
  if (LEXICAL_EXTENSIONS.has(extension)) return true;
  if (STRUCTURED_TEXT_EXTENSIONS.has(extension)) return true;
  return extension === "" && STRUCTURED_TEXT_NAMES.has(basename);
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
    interpretEnabled, maxFileBytes, rootPathsById, rootKeyById, into,
  } = context;
  const { normalized, lexical, interpreted, manifestIdentifiers, skipped } = into;
  const contentHash = artifact.contentHash as string;
  const documentKey = normalizedDocumentKey({
    contentHash,
    decoderId: TEXT_DECODER_ID,
    decoderVersion: TEXT_DECODER_VERSION,
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
      normalized_document_identity: documentKey,
      source_path: artifact.rootRelativePath,
    }),
    interpretationProfileHash: interpretProfile,
  });
  const wantsLexical = isLexicallyAnalyzable(artifact.rootRelativePath);
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
  const lexicalHit = wantsLexical
    ? cache.get<LexicalFeatureRecord>("lexical_features", lexicalKey)
    : undefined;
  const interpretHit = wantsInterpretation
    ? cache.get<InterpretationRecord>("interpretation", interpretKey)
    : undefined;
  const identifierKey = normalizedDocumentKey({
    contentHash,
    decoderId: MANIFEST_DECODER_ID,
    decoderVersion: MANIFEST_DECODER_VERSION,
  });
  const identifierHit = wantsIdentifier
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
      };
      cache.put("normalized_document", documentKey, record);
      normalized.set(artifact.virtualSourceId, record);
      return;
    }
    let text: string;
    try {
      text = fs.readFileSync(absolute, "utf8");
    } catch {
      skipped.unreadable += 1;
      return;
    }
    const analysisText = normalizeForAnalysis(text);
    const tokens = analysisTokens(analysisText);
    const record: NormalizedDocumentRecord = {
      decodes: true,
      reason: null,
      byte_length: Buffer.byteLength(text, "utf8"),
      normalized_content_hash: stableId("normtext", { text: analysisText }),
      token_count: tokens.length,
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
        repositorySubjectId: `repo:${rootKeyById.get(artifact.rootId) ?? artifact.rootId}`,
        sourcePath: artifact.rootRelativePath,
        content: text,
        extractors,
        pathExists: (relativePath) => {
          consultedRoot = true;
          return observedPaths.has(relativePath.replace(/^\.\//, ""));
        },
      });
      const stored: InterpretationRecord = {
        assertions: result.assertions,
        diagnostics: result.diagnostics,
      };
      if (!consultedRoot) cache.put("interpretation", interpretKey, stored);
      interpreted.set(artifact.virtualSourceId, stored);
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
  const interpretProfile = interpretationProfileHash(extractors);
  const interpretEnabled = input.interpret !== false;

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
  const disposals: LocalSourceObservation[] = [];
  try {
    for (const spec of input.roots) {
      const rootKey = spec.name !== undefined && spec.name.length > 0
        ? spec.name
        : defaultRootKey(spec.path);
      assertUsableRootKey(rootKey, spec.path);
      const observation = acquireLocalSource({
        path: spec.path,
        sourceKind: "auto",
        name: rootKey,
        expandArchives: input.expandArchives !== false,
        ...(input.archivePolicy ? { archivePolicy: input.archivePolicy } : {}),
        ...(input.omitPatterns ? { omitPatterns: input.omitPatterns } : {}),
        ...(input.omitFile !== undefined ? { omitFile: input.omitFile } : {}),
        ...(input.hashMaxBytes !== undefined ? { hashMaxBytes: input.hashMaxBytes } : {}),
        ...(input.scratchParent !== undefined ? { scratchParent: input.scratchParent } : {}),
      });
      disposals.push(observation);
      if (!observation.stable) {
        throw new Error(
          `corpus: SOURCE_CHANGED_DURING_OBSERVATION under root '${rootKey}'; `
          + "the root changed while it was being read, so it has no deterministic snapshot",
        );
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
    const snapshotId = corpusSnapshotId({
      rootSourceRevisions: bound.roots.map((root) => root.source_revision),
      corpusProfileHash,
    });
    session?.setTarget(snapshotId);

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

    for (const entry of active) {
      const binding = bindingById.get(entry.binding.root_id) as CorpusRootBinding;
      const observed = new Set<string>();
      const memberPaths = new Set(
        entry.observation.virtualArtifacts.map((member) => member.virtualSourcePath),
      );
      for (const record of entry.observation.inventory.records) {
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
            artifact.statPrecheck = { size_bytes: stats.size, mtime_ms: Math.trunc(stats.mtimeMs) };
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
        && (isTextDecodable(artifact.rootRelativePath)
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
        into: { normalized, lexical, interpreted, manifestIdentifiers, skipped },
      }));

    // ── 5. readiness signals ──────────────────────────────────────────────
    const readinessInputs: ReadinessArtifactInput[] = artifacts.map((artifact) => ({
      virtual_source_id: artifact.virtualSourceId,
      corpus_path: artifact.corpusPath,
      root_relative_path: artifact.rootRelativePath,
      content_hash: artifact.contentHash,
      size_bytes: artifact.sizeBytes,
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
    const featureIdentities = lexicalDocuments.map((document) => document.normalizedContentHash);

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
    const snapshot: CorpusSnapshot = {
      schema: CORPUS_SNAPSHOT_SCHEMA,
      corpus_snapshot_id: snapshotId,
      corpus_profile_hash: corpusProfileHash,
      roots: bound.roots.map(rootIdentity),
      artifacts: snapshotArtifacts,
      archives: orderedArchives,
      counts: {
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
      corpus_snapshot_id: snapshotId,
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
    const readiness = buildReadinessEvidence({
      corpusSnapshotId: snapshotId,
      artifacts: readinessInputs,
      bodies,
      context: {
        signalsById,
        artifactsById: new Map(
          readinessInputs.map((artifact) => [artifact.virtual_source_id, artifact]),
        ),
        rootById: rootByArtifact,
        exactDuplicateIds,
        nearDuplicatePairs: nearPairs,
      },
    });

    const decodableIds = new Set(decodable.map((artifact) => artifact.virtualSourceId));
    const decodedIds = new Set(
      [...normalized.entries()].filter(([, record]) => record.decodes).map(([id]) => id),
    );
    const interpretationEligible = artifacts.filter(
      (artifact) => interpretEnabled && extractors.some((extractor) => extractor.matches(artifact.rootRelativePath)),
    );
    const lexicalEligible = artifacts.filter((artifact) => isLexicallyAnalyzable(artifact.rootRelativePath));
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
    const coverage: CorpusCoverage = {
      schema: CORPUS_COVERAGE_SCHEMA,
      corpus_snapshot_id: snapshotId,
      root_ids: bound.roots.map((root) => root.root_id).sort(compareCodePoints),
      total_files: artifacts.length,
      total_bytes: snapshot.counts.total_bytes,
      archive_count: archives.length,
      archive_member_count: snapshot.counts.archive_member_count,
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
      embedding_enabled: false,
      unsupported_format_counts: formatCounts(
        artifacts
          .filter((artifact) => UNDECODED_EXTENSIONS.has(artifact.extension))
          .map((artifact) => ({ extension: artifact.extension, bytes: artifact.sizeBytes ?? 0 })),
      ),
      ocr_required_count: artifacts.filter((artifact) => OCR_EXTENSIONS.has(artifact.extension)).length,
      encrypted_document_count: encryptedCount,
      oversized_document_count: skipped.oversized,
      secret_skipped_count: skipped.secret,
      project_candidate_count: projectCandidates.length,
      topic_candidate_count: topicCandidates.length,
      reasoning_eligible_candidate_count: reasoningEligible,
      reasoning_handoff: {
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
      candidates: candidatesDocument,
      readiness,
      coverage,
      diff,
      diagnostics: orderedDiagnostics,
      cacheStats,
      bindings: bound.roots,
      precheck,
      scanned: { files: scannedFiles, bytes: scannedBytes },
    };
  } finally {
    for (const observation of disposals) observation.dispose();
  }
}

/** Canonical bytes of the candidate projection. */
export function renderCorpusCandidates(document: CorpusCandidatesDocument): string {
  return `${canonicalCorpusJson(document)}\n`;
}

/** Canonical bytes of the readiness projection. */
export function renderReadinessEvidence(evidence: ReadinessEvidence): string {
  return `${canonicalCorpusJson(evidence)}\n`;
}
