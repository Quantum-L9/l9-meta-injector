/**
 * Read-only scan for competing repository metadata authorities.
 *
 * This scanner intentionally includes hidden control surfaces that normal artifact
 * discovery omits. It does not make those paths mutation candidates. It looks for
 * executable writer scripts and invocations, while treating marker text in docs,
 * tests, fixtures, and reports as inert evidence rather than an active conflict.
 */
import { type AuthorityLoadOptions } from "./authority";
import { type AuthorityConfig, type AuthorityConflict, type OperationMode } from "./operation_contracts";
export type AuthorityEvidenceKind = "writer_script" | "writer_invocation" | "legacy_marker" | "canonical_invocation";
export interface AuthorityEvidence {
    path: string;
    kind: AuthorityEvidenceKind;
    rule: string;
    line?: number;
    excerpt?: string;
}
export interface AuthorityScanOptions {
    maxFileBytes?: number;
    excludedDirectoryNames?: string[];
}
export interface AuthorityScanResult {
    scannedPaths: string[];
    evidence: AuthorityEvidence[];
    scanGaps: AuthorityConflict[];
    conflicts: AuthorityConflict[];
}
export interface RepositoryAuthorityInspection {
    root: string;
    authorityPath: string;
    authority?: AuthorityConfig;
    authorityResolved: boolean;
    scannedPaths: string[];
    evidence: AuthorityEvidence[];
    scanGaps: AuthorityConflict[];
    conflicts: AuthorityConflict[];
}
export declare function scanRepositoryAuthority(root: string, options?: AuthorityScanOptions): AuthorityScanResult;
export declare function inspectRepositoryAuthority(root: string, options?: AuthorityLoadOptions & AuthorityScanOptions): RepositoryAuthorityInspection;
export declare function assertRepositoryAuthorityForOperation(mode: OperationMode, inspection: RepositoryAuthorityInspection): AuthorityConfig | undefined;
