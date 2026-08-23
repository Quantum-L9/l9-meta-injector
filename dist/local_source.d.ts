import { InventoryResult } from "./inventory";
import { OmitMatcher } from "./omit";
import { ArchiveHold, ArchivePreflightResult } from "./archive_preflight";
import { LocalArchivePolicy } from "./local_archive_policy";
/** Separator between an archive path and a member path in a virtual locator. */
export declare const ARCHIVE_MEMBER_SEPARATOR = "!/";
/** Ownership marker written at the root of every scratch directory this module creates. */
export declare const SCRATCH_OWNER_FILE = ".l9-scratch-owner.json";
export declare const SCRATCH_OWNER_ID = "l9-meta-injector.local-source";
/**
 * Generated artifacts this package itself produces. They are excluded from
 * canonical source observation so a second run never observes the first run's
 * output as if it were user content.
 */
export declare const GENERATED_ARTIFACT_OMIT_PATTERNS: readonly string[];
/** Marker a tool-owned legacy extraction directory carries. */
export declare const LEGACY_EXTRACTION_OWNER_FILE = ".l9extracted-owner.json";
export declare const LEGACY_EXTRACTION_SUFFIX = ".l9extracted";
export type LocalSourceKind = "file" | "directory" | "archive";
export type RequestedSourceKind = LocalSourceKind | "auto";
export type LocalEntryKind = "file" | "directory" | "symlink" | "special";
export type LocalSourceDiagnosticSeverity = "info" | "warning" | "error";
export interface LocalSourceDiagnostic {
    code: string;
    severity: LocalSourceDiagnosticSeverity;
    message: string;
    /** Repository-relative or virtual path the diagnostic is about, when it has one. */
    sourcePath?: string;
}
export interface LocalArchiveObservation {
    /** Source-relative POSIX path of the archive file, or a virtual locator when nested. */
    sourcePath: string;
    /** `sha256:`-prefixed digest of the exact archive bytes. */
    contentHash: string;
    sizeBytes: number;
    /** Nesting depth; the outermost archive is 0. */
    nestedDepth: number;
    /** Digest of the containing archive when this archive is itself a member. */
    parentArchiveHash: string | null;
    /** Source path of the containing archive when this archive is itself a member. */
    parentArchivePath: string | null;
    /** True when the archive's members were expanded and are claimed as observed. */
    expanded: boolean;
    memberCount: number;
    omittedMemberCount: number;
    /** Violations that held the archive. Empty when it was expanded. */
    holds: ArchiveHold[];
}
export interface LocalArchiveMemberObservation {
    /** Machine-independent virtual locator, e.g. `Bundle.zip!/docs/a.md`. */
    virtualSourcePath: string;
    /** Canonical member path inside its own archive. */
    memberPath: string;
    /** `sha256:`-prefixed digest of the exact member bytes. */
    contentHash: string;
    sizeBytes: number;
    parentArchiveHash: string;
    parentArchivePath: string;
    nestedDepth: number;
    compressionMethod: number;
    crc32: number;
    /** Absolute staged path. Implementation detail; never semantic, never emitted. */
    stagedPath: string;
}
export interface LocalSourceAcquireInput {
    /** Absolute or relative path to the file, directory, or archive to observe. */
    path: string;
    sourceKind?: RequestedSourceKind;
    /** Canonical source name. Defaults to the basename of the source path. */
    name?: string;
    /** Expand ZIP archives into tool-owned staging. Default true. */
    expandArchives?: boolean;
    archivePolicy?: Partial<LocalArchivePolicy>;
    /** Pre-built omit matcher. When absent one is built from the patterns below. */
    omit?: OmitMatcher;
    omitPatterns?: string[];
    omitFile?: string;
    /**
     * Optional ceiling on the bytes hashed per file. Unset means every regular file
     * is hashed in full. When set and exceeded, the hash is absent, a diagnostic is
     * emitted, and the canonical snapshot is blocked rather than silently degraded.
     */
    hashMaxBytes?: number;
    /** Scratch parent directory. Defaults to the OS temporary directory. */
    scratchParent?: string;
    /**
     * Exact hashes a previous fully-verified run established, by relative path.
     *
     * Supplying this switches a file from "read every byte" to "read the bytes only
     * if size or mtime moved". That is a revalidation signal, never content truth:
     * a file rewritten in place within one filesystem timestamp tick and to exactly
     * the same length would be reported unchanged. The observation records how many
     * hashes were reused so nothing downstream can call the result byte-verified —
     * see `hashing` on the observation.
     */
    knownHashes?: ReadonlyMap<string, KnownFileHash>;
    /**
     * Where an archive's preflight verdict may be read from and written to.
     *
     * An unchanged outer ZIP does not need its central directory re-read and its
     * policy rules re-evaluated to produce the same verdict it produced last time.
     * The key is the archive's own content hash plus the reader and policy
     * versions, so a stricter policy is never answered from a looser one's entry.
     *
     * The archive's bytes are still staged: the members are needed by whatever
     * reads them next, and a manifest does not contain them.
     */
    archiveManifests?: ArchiveManifestStore;
}
/** Read-through storage for archive preflight verdicts. */
export interface ArchiveManifestStore {
    get(key: {
        archiveContentHash: string;
        readerVersion: string;
        policyVersion: string;
    }): ArchivePreflightResult | undefined;
    put(key: {
        archiveContentHash: string;
        readerVersion: string;
        policyVersion: string;
    }, value: ArchivePreflightResult): void;
}
/** Version of the ZIP reader whose output an archive manifest describes. */
export declare const ARCHIVE_READER_VERSION = "1.0.0";
/** What a previous run established about one file, and the stat it saw. */
export interface KnownFileHash {
    /** `sha256:`-prefixed, as a previous run computed it from the exact bytes. */
    content_hash: string;
    size_bytes: number;
    mtime_ms: number;
    /** Nanosecond mtime, where the platform reports one. Compared when present. */
    mtime_ns?: string;
}
/** How the hashes in one observation were arrived at. */
export interface LocalSourceHashingReport {
    /** Files whose bytes this run read in full. */
    fully_rehashed_count: number;
    /** Files whose hash was carried over because size and mtime had not moved. */
    cached_reuse_count: number;
    /** Files with no hash at all: over budget, or unreadable. */
    unhashed_count: number;
}
export interface LocalSourceObservation {
    sourceKind: LocalSourceKind;
    sourceName: string;
    /** `file:sha256:…`, `archive:sha256:…`, or `fs:sha256:…`. Derived, never supplied. */
    sourceRevision: string;
    /** `sha256:`-prefixed digest of the canonical physical manifest. */
    physicalSnapshotHash: string;
    /** How the hashes were arrived at: read, carried over, or absent. */
    hashing: LocalSourceHashingReport;
    /** Physical entries plus virtual archive members, in the inventory record shape. */
    inventory: InventoryResult;
    archives: LocalArchiveObservation[];
    virtualArtifacts: LocalArchiveMemberObservation[];
    diagnostics: LocalSourceDiagnostic[];
    /** Applied archive policy, recorded so a manifest states the rules that produced it. */
    archivePolicy: LocalArchivePolicy;
    /**
     * False when the source changed while it was being observed. A canonical
     * Repository Model Packet must not be produced from an unstable observation.
     */
    stable: boolean;
    /** Tool-owned staging root. Implementation detail; never semantic. */
    scratchRoot: string;
    /** Remove the staging root. Safe to call more than once. */
    dispose(): void;
}
/**
 * Recursively remove a scratch root, but only after re-reading its ownership
 * marker. Without this check a corrupted or reassigned `scratchRoot` would make
 * `dispose()` a recursive delete of an arbitrary path.
 */
export declare function removeOwnedScratch(root: string, token: string): void;
/**
 * True when a directory carries evidence that this tool created it.
 *
 * A directory is not tool-owned merely because its name ends in `.l9extracted`.
 * Users name directories whatever they like, and treating a name as ownership is
 * exactly how user data gets deleted.
 */
export declare function hasLegacyExtractionOwnership(directory: string): boolean;
/**
 * True when `directory` is a legacy extraction of an archive that sits beside it.
 *
 * Both signals must agree: the ownership marker, and an adjacent archive whose
 * name the directory derives from. Either alone is an assumption.
 */
export declare function isLegacyGeneratedExtraction(absoluteDirectory: string): boolean;
/** Stream a file through SHA-256. Bounded memory regardless of file size. */
export declare function hashFileStreaming(absolutePath: string): {
    hash: string;
    bytes: number;
};
export interface PhysicalManifestEntry {
    path: string;
    kind: LocalEntryKind;
    /** Present for regular files whose bytes were hashed. */
    contentHash?: string;
    /** Present for symlinks: the literal target text, never a resolved path. */
    linkTarget?: string;
}
/**
 * Digest of the physical snapshot.
 *
 * The manifest deliberately carries only repository-relative paths, entry kinds,
 * file content hashes and literal symlink targets. Absolute paths, inode and
 * device numbers, access times, observation wall clock, scratch locations,
 * usernames and hostnames are excluded, so the same tree observed from a
 * different mount point on a different machine yields the same digest.
 */
export declare function physicalManifestDigest(entries: PhysicalManifestEntry[]): string;
/**
 * Observe a local source read-only and return everything a deterministic packet
 * needs: a stable snapshot identity, per-entry evidence, virtual archive members
 * with exact hashes, and the provenance that binds each member to its archive.
 *
 * The caller owns the returned observation's lifetime and must call `dispose()`
 * once the staged member bytes are no longer needed.
 */
export declare function acquireLocalSource(input: LocalSourceAcquireInput): LocalSourceObservation;
