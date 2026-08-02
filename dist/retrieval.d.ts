import { ScanEntry } from "./schema";
import { OmitMatcher } from "./omit";
import { DiscoverySummary } from "./discovery_contracts";
export interface FindFilesOptions {
    /** Extra omit patterns in gitignore syntax. */
    omitPatterns?: string[];
    /** Optional omit-file path. */
    omitFile?: string;
    /** When true, built-in SKILL.md protect applies. */
    protectSkillMd?: boolean;
    /** Pre-built matcher; when set, other omit fields are ignored. */
    omit?: OmitMatcher;
}
export interface DiscoveryResult {
    files: string[];
    summary: DiscoverySummary;
}
export declare function discoverFiles(root: string, glob: string, opts?: FindFilesOptions): DiscoveryResult;
/** Backward-compatible file-only discovery wrapper. */
export declare function findFiles(root: string, glob: string, opts?: FindFilesOptions): string[];
export declare function scanFiles(filePaths: string[]): ScanEntry[];
