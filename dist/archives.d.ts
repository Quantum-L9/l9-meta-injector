import type { OmitMatcher } from "./omit";
import { ArchiveExecutionResolution } from "./archive_execution";
import type { LocalArchivePolicy } from "./local_archive_policy";
/** Directory-name suffix for an expanded archive (sibling of the .zip). */
export declare const EXTRACTED_DIR_SUFFIX = ".l9extracted";
/** Archive extensions expanded in local-files mode (v1: zip only). Owned by `archive_formats.ts`. */
export declare const EXPANDABLE_ARCHIVE_EXTS: ReadonlySet<string>;
export interface ArchiveRecord {
    zipPath: string;
    extractDir: string;
    memberCount: number;
    sidecarPath?: string;
    nestedDepth: number;
    /** Why this archive was observed but not expanded. */
    heldReason?: string;
}
export interface ExpandArchivesOptions {
    /** When true, nothing in the source tree is mutated. */
    dryRun: boolean;
    verbose: boolean;
    /** Max nested-zip depth (outer zip = 0). Default: policy maxNestedDepth. */
    maxDepth?: number;
    /** Optional archive resource-policy overrides for the whole run. */
    archivePolicy?: Partial<LocalArchivePolicy>;
    /** Shared omit matcher (inventory/pipeline/skills). */
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
/** List canonical member paths inside a ZIP. */
export declare function listZipMembers(zipPath: string): string[];
/**
 * Reason an existing extraction directory may not be replaced, or null when it may.
 * Destructive authority is exact provenance, never a suffix or owner-prefix guess.
 */
export declare function extractionRefusalReason(extractDir: string, zipPath?: string): string | null;
/**
 * Standalone materialization convenience. Multi-archive runs use one shared
 * resolution and one context per archive through expandArchivesUnderRoot.
 */
export declare function extractZip(zipPath: string, extractDir: string, allowedMembers?: string[], options?: {
    depth?: number;
    policy?: Partial<LocalArchivePolicy>;
    resolution?: ArchiveExecutionResolution;
}): number;
/** Discover expandable archives under root. */
export declare function findArchives(root: string, omit?: OmitMatcher): {
    archives: string[];
    omitted: string[];
};
/** Write `<zip>.l9meta.yaml` describing the archive and its extract location. */
export declare function writeArchiveSidecar(zipPath: string, extractDir: string, memberCount: number, extras?: Record<string, unknown>): string;
/** Expand all ZIPs under root with one acquisition-wide policy and budget. */
export declare function expandArchivesUnderRoot(root: string, opts: ExpandArchivesOptions): ExpandArchivesResult;
