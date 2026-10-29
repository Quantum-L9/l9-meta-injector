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
/**
 * Deterministic discovery with one terminal disposition per entry.
 *
 * `indexGoverned` is internal and is set only by the index-compiling governed run
 * (`carrier_operation.ts`, through the pipeline's internal governed entry). Such a
 * run must hold a file that would otherwise be eligible but whose path the metadata
 * index cannot represent (DEC-RC-013 B). Every other caller — public `findFiles`, a
 * non-governed `runPipelineAsync` — compiles no index and keeps that file eligible.
 */
export declare function discoverFiles(root: string, glob: string, opts?: FindFilesOptions, indexGoverned?: boolean): DiscoveryResult;
/** Backward-compatible file-only discovery wrapper. */
export declare function findFiles(root: string, glob: string, opts?: FindFilesOptions): string[];
export declare function scanFiles(filePaths: string[]): ScanEntry[];
