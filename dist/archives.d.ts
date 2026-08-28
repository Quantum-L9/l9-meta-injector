import type { OmitMatcher } from "./omit";
/** Directory-name suffix for an expanded archive (sibling of the .zip). */
export declare const EXTRACTED_DIR_SUFFIX = ".l9extracted";
/** Archive extensions expanded in local-files mode (v1: zip only). */
export declare const EXPANDABLE_ARCHIVE_EXTS: Set<string>;
export interface ArchiveRecord {
    zipPath: string;
    extractDir: string;
    memberCount: number;
    sidecarPath?: string;
    nestedDepth: number;
    /**
     * Why this archive was observed but not expanded. Absent when it was expanded.
     * A refusal is reported rather than thrown so one unsafe archive does not abort
     * a whole local-files run.
     */
    heldReason?: string;
}
export interface ExpandArchivesOptions {
    /** When true, nothing is extracted and no sidecar is written: zero source mutation. */
    dryRun: boolean;
    verbose: boolean;
    /** Max nested-zip depth (outer zip = 0). Default 3. */
    maxDepth?: number;
    /**
     * Shared omit matcher (inventory/pipeline/skills). When set, omitted archives
     * and members are skipped — same policy as findFiles / inventoryTree.
     */
    omit?: OmitMatcher;
}
export interface ExpandArchivesResult {
    archives: ArchiveRecord[];
    /** Absolute extract-dir roots created/refreshed this run. */
    extractedRoots: string[];
    /** Relative paths of archives skipped by omit. */
    omittedArchives: string[];
}
/** Sibling extract directory for a zip: `Archive.zip` → `Archive.l9extracted`. */
export declare function extractDirFor(zipPath: string): string;
/**
 * List member paths inside a zip, rejecting Zip-Slip (`..` / absolute) names.
 *
 * Read from the central directory rather than from `unzip -Z1`. The names a
 * subprocess prints are already its own interpretation of the bytes, so taking
 * them as input meant trusting a second parser about what a member is even
 * called. Directory entries keep a trailing separator so callers can still tell
 * them from files.
 */
export declare function listZipMembers(zipPath: string): string[];
/**
 * Reason an existing extraction directory may not be replaced, or null when it may.
 *
 * Ownership must be proven, never inferred from the path. A directory named
 * `Foo.l9extracted` next to `Foo.zip` can be a user directory: without the
 * ownership marker this tool writes, removing it would destroy data this package
 * never created.
 */
export declare function extractionRefusalReason(extractDir: string): string | null;
/**
 * Refresh extractDir and materialize allowed members into it.
 *
 * When `allowedMembers` is set, only those canonical paths are written (omit
 * filter). Returns the number of members actually extracted.
 *
 * Throws rather than deleting when the target exists and is not provably this
 * tool's own output, and refuses the whole archive when canonical preflight
 * holds it. Admission is decided before the directory is refreshed, so a hostile
 * archive never reaches the point of removing anything.
 */
export declare function extractZip(zipPath: string, extractDir: string, allowedMembers?: string[]): number;
/** Discover expandable archives under root (does not enter existing *.l9extracted dirs). */
export declare function findArchives(root: string, omit?: OmitMatcher): {
    archives: string[];
    omitted: string[];
};
/** Write `<zip>.l9meta.yaml` describing the archive and its extract location. */
export declare function writeArchiveSidecar(zipPath: string, extractDir: string, memberCount: number, extras?: Record<string, unknown>): string;
/**
 * Expand all zips under root (and nested zips inside freshly extracted trees)
 * up to maxDepth. Writes archive sidecars unless dryRun. Honors `opts.omit`.
 */
export declare function expandArchivesUnderRoot(root: string, opts: ExpandArchivesOptions): ExpandArchivesResult;
