import { InventoryResult } from "./inventory";
/** Identity of the interpretation policy. Bumped when extraction rules change. */
export declare const INTERPRETATION_PROFILE_ID = "meta-injector-repository-interpretation";
/**
 * 1.1.0 adds artifact-scoped assertion subjects and the deterministic
 * work-intelligence extractors. Both change what this profile observes, so the
 * version — and through it every packet's semantic identity — moves with them.
 */
export declare const INTERPRETATION_PROFILE_VERSION = "1.1.0";
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
    /**
     * Subject the assertions attach to, already resolved for the extractor's own
     * scope: the repository id for a repository-scoped extractor, this file's
     * artifact id for an artifact-scoped one.
     */
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
/**
 * What an extractor's assertions are *about*.
 *
 * `repository` — the file evidences something about the repository as a whole
 * (its declared status, its manifest, its canonical authority list).
 * `artifact` — the file evidences something about *itself* (this plan is a WIP,
 * this note lists these tasks).
 *
 * The distinction is not cosmetic. A corpus of a thousand documents that all
 * report their status against one repository subject says nothing about which
 * document is which; the same claims against artifact subjects are a work map.
 */
export type ExtractorSubjectScope = "repository" | "artifact";
export interface Extractor {
    id: string;
    version: string;
    /**
     * Scope of this extractor's assertion subjects. Absent means `repository`,
     * which is what every extractor written before the scope existed meant: an
     * extractor never silently changes scope because the interpreter learned to
     * support both.
     */
    subjectScope?: ExtractorSubjectScope;
    /** True when this extractor claims the file. Path-based and side-effect free. */
    matches(sourcePath: string): boolean;
    /** Parse and report. Must not throw on malformed input; return [] instead. */
    extract(input: ExtractorFileInput): AssertionDraft[];
}
/** The scope an extractor declares, defaulting to the pre-scope behavior. */
export declare function extractorSubjectScope(extractor: Extractor): ExtractorSubjectScope;
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
    /**
     * Repository subject, e.g. `repo:golden-repo`. Repository-scoped extractors
     * attach their assertions here; artifact-scoped ones attach to the artifact
     * derived from this same id, so both stay inside one identity domain.
     */
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
