// local_source_model.ts — Repository Model Packet egress for a local source.
//
// Joins the two halves: `acquireLocalSource` produces a read-only observation of
// a file, folder or archive, and `buildRepositoryModelPacket` turns observations
// into the packet the bound topology consumer accepts. Nothing new is invented
// between them — this module supplies the archive provenance overlay and makes
// sure the staged member bytes stay alive exactly as long as interpretation needs
// them.
//
// Two refusals live here, and both are deliberate:
//
//   - An unstable observation never becomes a packet. A packet declares a
//     deterministic snapshot identity, and a snapshot assembled while the source
//     was being written is not one.
//   - A missing required content hash blocks the canonical packet for the same
//     reason: a snapshot whose bytes were never fully read cannot claim to
//     identify them.
import * as fs from "node:fs";
import * as path from "node:path";
import { InterpretationResult, interpretRepository, looksSecret } from "./interpretation";
import { defaultExtractors } from "./extractors";
import {
  LocalSourceAcquireInput,
  LocalSourceObservation,
  acquireLocalSource,
} from "./local_source";
import { LocalArchivePolicy } from "./local_archive_policy";
import {
  CorpusIndex,
  NearDuplicateOptions,
  buildCorpusIndex,
  renderCorpusIndex,
} from "./corpus_analysis";
import { renderCorpusReport } from "./corpus_report";
import {
  RepositoryModelLocalSourceInput,
  RepositoryModelPacket,
  buildRepositoryModelPacket,
} from "./repository_model";

/** Schema of the acquisition manifest written beside a bundle. */
export const LOCAL_SOURCE_MANIFEST_SCHEMA = "l9.local-source-manifest/v1";

export interface LocalSourceModelInput extends LocalSourceAcquireInput {
  /** Producer version recorded in the packet and in every evidence record. */
  producerVersion: string;
  /** Emission timestamp; excluded from semantic identity. */
  generatedAt?: string;
  /** Run the deterministic interpretation pass. Default true. */
  interpret?: boolean;
}

export interface LocalSourceModelResult {
  packet: RepositoryModelPacket;
  observation: LocalSourceObservation;
  interpretation?: InterpretationResult;
}

/** Map an acquisition into the packet builder's provenance overlay. */
export function toRepositoryModelLocalSource(
  observation: LocalSourceObservation,
): RepositoryModelLocalSourceInput {
  return {
    sourceKind: observation.sourceKind,
    archivePolicyVersion: observation.archivePolicy.version,
    archives: observation.archives.map((archive) => ({
      sourcePath: archive.sourcePath,
      contentHash: archive.contentHash,
      sizeBytes: archive.sizeBytes,
      nestedDepth: archive.nestedDepth,
      parentArchivePath: archive.parentArchivePath,
      parentArchiveHash: archive.parentArchiveHash,
      expanded: archive.expanded,
      memberCount: archive.memberCount,
      omittedMemberCount: archive.omittedMemberCount,
      holdCodes: archive.holds.map((hold) => hold.code),
    })),
    members: observation.virtualArtifacts.map((member) => ({
      virtualSourcePath: member.virtualSourcePath,
      memberPath: member.memberPath,
      contentHash: member.contentHash,
      sizeBytes: member.sizeBytes,
      parentArchivePath: member.parentArchivePath,
      parentArchiveHash: member.parentArchiveHash,
      nestedDepth: member.nestedDepth,
    })),
    diagnostics: observation.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.sourcePath !== undefined ? { sourcePath: diagnostic.sourcePath } : {}),
    })),
  };
}

/** Reason the observation cannot become a canonical packet, or null when it can. */
export function canonicalBlockReason(observation: LocalSourceObservation): string | null {
  if (!observation.stable) {
    return "SOURCE_CHANGED_DURING_OBSERVATION: the source changed while it was being observed, "
      + "so no deterministic snapshot exists to emit";
  }
  const missing = observation.inventory.records.filter(
    (record) =>
      record.content_hash === null
      && record.artifact_type !== "folder"
      && record.unknowns.some((unknown) => unknown.startsWith("content_hash_skipped:")),
  );
  if (missing.length > 0) {
    return `a required content hash is missing for ${missing.length} file(s); `
      + "raise the hash budget rather than emitting a snapshot that cannot identify its bytes";
  }
  return null;
}

/**
 * Observe a local source and build its Repository Model Packet.
 *
 * The caller owns the returned observation and must call `observation.dispose()`
 * once it is done with it; the staged member bytes are still on disk until then.
 * Use `withLocalSourceModel` when the packet is all that is needed.
 */
export function observeLocalSourceModel(input: LocalSourceModelInput): LocalSourceModelResult {
  const observation = acquireLocalSource(input);
  try {
    const blocked = canonicalBlockReason(observation);
    if (blocked !== null) throw new Error(`local-source: ${blocked}`);

    const subjectId = `repo:${observation.sourceName}`;
    const interpretation =
      input.interpret === false
        ? undefined
        : interpretRepository({
            root: path.resolve(input.path),
            subjectId,
            inventory: observation.inventory,
            extractors: defaultExtractors(),
          });

    const packet = buildRepositoryModelPacket({
      inventory: observation.inventory,
      repositoryName: observation.sourceName,
      sourceRevision: observation.sourceRevision,
      producerVersion: input.producerVersion,
      localSource: toRepositoryModelLocalSource(observation),
      ...(interpretation ? { interpretation } : {}),
      ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
    });
    return { packet, observation, ...(interpretation ? { interpretation } : {}) };
  } catch (error) {
    observation.dispose();
    throw error;
  }
}

/** Run `body` against a fresh observation and always dispose the staging root. */
export function withLocalSourceModel<T>(
  input: LocalSourceModelInput,
  body: (result: LocalSourceModelResult) => T,
): T {
  const result = observeLocalSourceModel(input);
  try {
    return body(result);
  } finally {
    result.observation.dispose();
  }
}

// ───────────────────────────── corpus intelligence ─────────────────────────────

export interface LocalSourceCorpusOptions {
  nearDuplicates?: NearDuplicateOptions;
}

export interface LocalSourceCorpusOutputs {
  index: CorpusIndex;
  /** Rendered `corpus-index.json` bytes. */
  indexJson: string;
  /** Rendered `corpus-report.md` bytes. */
  report: string;
}

/**
 * Derive the corpus index and its human report from an already-built model.
 *
 * Everything here is a projection of the observation, the packet and the two
 * duplicate analyses. The staged archive-member bytes must still be on disk,
 * because the similarity pass reads member text the same way it reads a physical
 * file — so call this before `observation.dispose()`.
 */
export function buildLocalSourceCorpus(
  result: LocalSourceModelResult,
  options: LocalSourceCorpusOptions = {},
): LocalSourceCorpusOutputs {
  const index = buildCorpusIndex({
    acquisition: result.observation,
    packet: result.packet,
    ...(result.interpretation ? { interpretation: result.interpretation } : {}),
    ...(options.nearDuplicates ? { nearDuplicates: options.nearDuplicates } : {}),
  });
  return { index, indexJson: renderCorpusIndex(index), report: renderCorpusReport(index) };
}

// ───────────────────────────── acquisition manifest ─────────────────────────────

export interface LocalSourceManifest {
  schema: string;
  source_kind: string;
  source_name: string;
  source_revision: string;
  physical_snapshot_hash: string;
  /** Operational, never semantic: excluded from every identity in this package. */
  observed_at: string;
  source_mutated: false;
  archive_policy: LocalArchivePolicy;
  archives: {
    source_path: string;
    archive_hash: string;
    size_bytes: number;
    nested_depth: number;
    expanded: boolean;
    member_count: number;
    omitted_member_count: number;
    hold_codes: string[];
  }[];
  members: {
    virtual_source_path: string;
    member_hash: string;
    size_bytes: number;
    parent_archive_hash: string;
    nested_depth: number;
  }[];
  diagnostics: { code: string; severity: string; message: string; source_path?: string }[];
  omitted_paths: string[];
}

/**
 * Replace any manifest value that resembles a credential.
 *
 * The manifest carries paths, digests and counts, never file content, so this
 * should never fire. It exists because "should never" is not a guarantee, and a
 * pathological filename is a cheaper thing to lose than a leaked secret.
 */
function scrubSecretValues(
  manifest: LocalSourceManifest,
): { manifest: LocalSourceManifest; redactions: number } {
  let redactions = 0;
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") {
      if (looksSecret(value)) { redactions++; return "[redacted]"; }
      return value;
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value !== null && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
    }
    return value;
  };
  return { manifest: scrub(manifest) as LocalSourceManifest, redactions };
}

export interface BuildLocalSourceManifestOptions {
  /** Operational observation timestamp. Never participates in semantic identity. */
  observedAt: string;
}

/** Build the acquisition manifest. Never written inside the observed source tree. */
export function buildLocalSourceManifest(
  observation: LocalSourceObservation,
  options: BuildLocalSourceManifestOptions,
): LocalSourceManifest {
  const manifest: LocalSourceManifest = {
    schema: LOCAL_SOURCE_MANIFEST_SCHEMA,
    source_kind: observation.sourceKind,
    source_name: observation.sourceName,
    source_revision: observation.sourceRevision,
    physical_snapshot_hash: observation.physicalSnapshotHash,
    observed_at: options.observedAt,
    source_mutated: false,
    archive_policy: observation.archivePolicy,
    archives: observation.archives.map((archive) => ({
      source_path: archive.sourcePath,
      archive_hash: archive.contentHash,
      size_bytes: archive.sizeBytes,
      nested_depth: archive.nestedDepth,
      expanded: archive.expanded,
      member_count: archive.memberCount,
      omitted_member_count: archive.omittedMemberCount,
      hold_codes: archive.holds.map((hold) => hold.code),
    })),
    members: observation.virtualArtifacts.map((member) => ({
      virtual_source_path: member.virtualSourcePath,
      member_hash: member.contentHash,
      size_bytes: member.sizeBytes,
      parent_archive_hash: member.parentArchiveHash,
      nested_depth: member.nestedDepth,
    })),
    diagnostics: observation.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      severity: diagnostic.severity,
      message: diagnostic.message,
      ...(diagnostic.sourcePath !== undefined ? { source_path: diagnostic.sourcePath } : {}),
    })),
    omitted_paths: observation.inventory.omittedPaths,
  };
  return scrubSecretValues(manifest).manifest;
}

/**
 * Resolve an output path, refusing anything inside the observed source tree.
 *
 * An output written beside the source would mutate what was just observed, and
 * the next run would then observe this run's output as if it were user content.
 */
function resolveOutsideSource(targetPath: string, sourceRoot: string, what: string): string {
  const absoluteTarget = path.resolve(targetPath);
  const absoluteSource = path.resolve(sourceRoot);
  const sourceDirectory = fs.statSync(absoluteSource).isDirectory()
    ? absoluteSource
    : path.dirname(absoluteSource);
  if (absoluteTarget === sourceDirectory || absoluteTarget.startsWith(sourceDirectory + path.sep)) {
    throw new Error(
      `local-source: refusing to write ${what} inside the observed source tree: ${absoluteTarget}`,
    );
  }
  return absoluteTarget;
}

/** Write the acquisition manifest to a tool-owned output location. */
export function writeLocalSourceManifest(
  manifest: LocalSourceManifest,
  targetPath: string,
  sourceRoot: string,
): string {
  const absoluteTarget = resolveOutsideSource(targetPath, sourceRoot, "the acquisition manifest");
  fs.mkdirSync(path.dirname(absoluteTarget), { recursive: true });
  fs.writeFileSync(absoluteTarget, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return absoluteTarget;
}

/** Write `corpus-index.json` and `corpus-report.md` outside the observed source. */
export function writeLocalSourceCorpus(
  outputs: LocalSourceCorpusOutputs,
  targets: { indexPath: string; reportPath: string },
  sourceRoot: string,
): { indexPath: string; reportPath: string } {
  const indexPath = resolveOutsideSource(targets.indexPath, sourceRoot, "the corpus index");
  const reportPath = resolveOutsideSource(targets.reportPath, sourceRoot, "the corpus report");
  fs.mkdirSync(path.dirname(indexPath), { recursive: true });
  fs.writeFileSync(indexPath, outputs.indexJson, "utf8");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, outputs.report, "utf8");
  return { indexPath, reportPath };
}
