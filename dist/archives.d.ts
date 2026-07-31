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
}
export interface ExpandArchivesResult {
    archives: ArchiveRecord[];
    /** Absolute extract-dir roots created/refreshed this run. */
    extractedRoots: string[];
}
/** Sibling extract directory for a zip: `Archive.zip` → `Archive.l9extracted`. */
export declare function extractDirFor(zipPath: string): string;
/** List member paths inside a zip; reject Zip-Slip (`..` / absolute) names. */
export declare function listZipMembers(zipPath: string): string[];
/**
 * Remove and recreate extractDir, then unzip into it.
 * Returns the number of non-directory member paths listed by unzip.
 */
export declare function extractZip(zipPath: string, extractDir: string): number;
/** Discover expandable archives under root (does not enter existing *.l9extracted dirs). */
export declare function findArchives(root: string): string[];
/** Write `<zip>.l9meta.yaml` describing the archive and its extract location. */
export declare function writeArchiveSidecar(zipPath: string, extractDir: string, memberCount: number, extras?: Record<string, unknown>): string;
/**
 * Expand all zips under root (and nested zips inside freshly extracted trees)
 * up to maxDepth. Writes archive sidecars unless dryRun.
 */
export declare function expandArchivesUnderRoot(root: string, opts: ExpandArchivesOptions): ExpandArchivesResult;
