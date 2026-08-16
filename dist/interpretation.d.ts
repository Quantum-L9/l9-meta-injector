import { InventoryResult } from "./inventory";
/** Identity of the interpretation policy. Bumped when extraction rules change. */
export declare const INTERPRETATION_PROFILE_ID = "meta-injector-repository-interpretation";
export declare const INTERPRETATION_PROFILE_VERSION = "1.0.0";
/**
 * How an assertion was evidenced.
 *
 * `declared` — the repository states it about itself (a manifest field, a
 * contract clause, a documented status).
 * `observed` — the extractor saw the construct in source (a route decorator, a
 * marker inside a handler body).
 *
 * There is deliberately no `inferred` class. An extractor that would need one is
 * out of scope for this profile.
 */
export type InterpretedEvidenceClass = "declared" | "observed";
/** Mirrors the Repository Model authority vocabulary. */
export type InterpretedAuthority = "source" | "validated-machine" | "derived" | "candidate" | "unknown";
export type InterpretedConfidenceLevel = "low" | "medium" | "high";
/** 1-based, inclusive line span of the evidence inside `source_path`. */
export interface InterpretedSourceRange {
    start_line: number;
    end_line: number;
}
export interface InterpretedAssertion {
    assertion_id: string;
    subject_id: string;
    predicate: string;
    object: string;
    source_path: string;
    source_range: InterpretedSourceRange;
    evidence_excerpt: string;
    source_content_hash: string;
    extractor_id: string;
    evidence_class: InterpretedEvidenceClass;
    authority: InterpretedAuthority;
    confidence: InterpretedConfidenceLevel;
}
export interface InterpretationDiagnostic {
    code: string;
    severity: "info" | "warning" | "error";
    message: string;
    extractor_id?: string;
    source_path?: string;
}
export interface InterpretationProfile {
    profile_id: string;
    profile_version: string;
    profile_hash: string;
    /** Every extractor consulted, whether or not it produced an assertion. */
    extractor_versions: Record<string, string>;
}
export interface InterpretationResult {
    profile: InterpretationProfile;
    assertions: InterpretedAssertion[];
    diagnostics: InterpretationDiagnostic[];
}
export interface ExtractorFileInput {
    /** Subject the assertions attach to, e.g. `repo:golden-repo`. */
    subjectId: string;
    /** Repository-relative POSIX path. Never absolute: identity must be portable. */
    sourcePath: string;
    content: string;
    /** `sha256:`-prefixed hash of the exact file bytes. */
    contentHash: string;
    /**
     * True when a repository-relative path was observed by inventory.
     *
     * Lets an extractor distinguish a reference that resolves from one that does
     * not, without guessing: a document naming a file that is not in the tree is
     * itself a fact worth reporting.
     */
    pathExists(relativePath: string): boolean;
}
/** What an extractor returns. Identity and evidence plumbing is added centrally. */
export interface AssertionDraft {
    predicate: string;
    object: string;
    sourceRange: InterpretedSourceRange;
    evidenceExcerpt: string;
    evidenceClass: InterpretedEvidenceClass;
    authority: InterpretedAuthority;
    confidence: InterpretedConfidenceLevel;
}
export interface Extractor {
    id: string;
    version: string;
    /** True when this extractor claims the file. Path-based and side-effect free. */
    matches(sourcePath: string): boolean;
    /** Parse and report. Must not throw on malformed input; return [] instead. */
    extract(input: ExtractorFileInput): AssertionDraft[];
}
export declare function isSecretCandidatePath(sourcePath: string): boolean;
export declare function looksSecret(value: string): boolean;
/** Excerpts are bounded so a packet can never become a file mirror. */
export declare const MAX_EXCERPT_LENGTH = 240;
/** Files larger than this are reported as a diagnostic rather than interpreted. */
export declare const DEFAULT_MAX_FILE_BYTES: number;
export declare function boundExcerpt(value: string): string;
export interface InterpretRepositoryInput {
    /** Repository root the inventory was taken from. */
    root: string;
    /** Subject the assertions attach to, e.g. `repo:golden-repo`. */
    subjectId: string;
    inventory: InventoryResult;
    /**
     * Extractors to consult. Passed in rather than defaulted here so the contract
     * does not depend on the registry that implements it; callers use
     * `defaultExtractors()` from `./extractors`.
     */
    extractors: Extractor[];
    maxFileBytes?: number;
}
/**
 * Interpret a repository that inventory has already observed.
 *
 * Returns an empty assertion set rather than throwing when nothing matches: a
 * repository the profile has no rules for is not an error, it is a repository
 * with no declared semantics this profile can read.
 */
export declare function interpretRepository(input: InterpretRepositoryInput): InterpretationResult;
