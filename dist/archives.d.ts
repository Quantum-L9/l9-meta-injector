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
}
export interface ExpandArchivesOptions {
    /** When true, still extract (local-files is mutative for archives) but skip sidecar writes. */
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
/** List member paths inside a zip; reject Zip-Slip (`..` / absolute) names. */
export declare function listZipMembers(zipPath: string): string[];
/**
 * Remove and recreate extractDir, then unzip allowed members into it.
 * When `allowedMembers` is set, only those paths are extracted (omit filter).
 * Returns the number of non-directory members actually extracted.
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
