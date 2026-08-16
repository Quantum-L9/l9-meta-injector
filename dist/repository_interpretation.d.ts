import type { InventoryRecord } from "./inventory";
export declare const INTERPRETATION_PROFILE_ID = "meta-injector-structured-interpretation";
export declare const INTERPRETATION_PROFILE_VERSION = "1.0.0";
/** Per-extractor versions. Changing any of these changes the profile identity. */
export declare const EXTRACTOR_VERSIONS: Readonly<Record<string, string>>;
export type InterpretationFactKind = "package_manager" | "package_identity" | "runtime_constraint" | "declared_dependency" | "service_identity" | "declared_action" | "declared_route" | "implementation_marker";
export type InterpretationEvidenceClass = "declared" | "observed";
export interface InterpretationSourceRef {
    sourcePath: string;
    lineNumber?: number;
    contentHash?: string;
}
export interface InterpretationFact {
    factId: string;
    kind: InterpretationFactKind;
    extractorId: string;
    extractorVersion: string;
    evidenceClass: InterpretationEvidenceClass;
    /** Stable, human-meaningful identity of the fact's value, e.g. `poetry`, `GET /health`. */
    value: string;
    /** Structured detail. Strings only, so canonical JSON stays integer- and float-free. */
    detail: Readonly<Record<string, string>>;
    sourceRef: InterpretationSourceRef;
}
export interface InterpretationDiagnostic {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    sourcePath?: string;
    extractorId?: string;
}
export interface InterpretationProfile {
    id: string;
    version: string;
    hash: string;
    extractorVersions: Readonly<Record<string, string>>;
}
export interface InterpretationResult {
    profile: InterpretationProfile;
    facts: InterpretationFact[];
    diagnostics: InterpretationDiagnostic[];
}
export interface InterpretRepositoryInput {
    root: string;
    records: readonly InventoryRecord[];
    sourceRevision: string;
}
/** Profile identity. Extraction policy participates in packet semantic identity. */
export declare const INTERPRETATION_PROFILE_HASH: string;
export declare function interpretationProfile(): InterpretationProfile;
/**
 * Interpret the supported structured surfaces of an already-observed repository.
 *
 * The observation is read-only: files are read, never written. Every returned fact traces
 * back to a repository-relative path and, where the reader can establish it, a line.
 */
export declare function interpretRepository(input: InterpretRepositoryInput): InterpretationResult;
