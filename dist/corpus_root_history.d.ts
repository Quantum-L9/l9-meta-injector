import type { RootIdentityClass } from "./corpus_roots";
/** A longitudinal operation, named as the refusal will name it. */
export declare const LONGITUDINAL_OPERATIONS: readonly ["previous-snapshot diff", "resume", "incremental hash reuse"];
export type LongitudinalOperation = (typeof LONGITUDINAL_OPERATIONS)[number];
/** One root as either side of a continuity claim knows it. */
export interface RootIdentityRecord {
    root_id: string;
    root_key: string;
    /**
     * How the key was chosen.
     *
     * Optional because a snapshot or session written before the class was recorded
     * says nothing about it. Absent is read as `inferred`: the weaker reading, and
     * the only honest one — a document that does not say the operator named the
     * root is not evidence that they did.
     */
    root_identity_class?: RootIdentityClass;
}
/** One root whose continuity this run would be asserting. */
export interface RootContinuityClaim {
    root_id: string;
    root_key: string;
    previous_identity_class: RootIdentityClass;
    current_identity_class: RootIdentityClass;
}
/** What the operator authorized, recorded where the run's provenance is recorded. */
export interface InferredRootHistoryOverride {
    enabled: boolean;
    /** Roots whose continuity rested on an inferred key. */
    affected_root_ids: string[];
    /** Operations the override was applied to, in code-point order. */
    operations: string[];
}
export interface LongitudinalAuthorization {
    /** Roots matched across the two observations, whatever their identity class. */
    matched_root_ids: string[];
    /** Of those, the ones whose continuity rests on an inferred key. */
    weak_claims: RootContinuityClaim[];
    /** True when a weak claim was allowed only because the operator said so. */
    override_used: boolean;
}
/**
 * Refusal to make a continuity claim the operator has not underwritten.
 *
 * Carries the roots rather than only a message so a caller can report several
 * without re-deriving them, and so a test can assert the reason rather than a
 * string.
 */
export declare class InferredRootHistoryError extends Error {
    readonly operation: LongitudinalOperation;
    readonly claims: RootContinuityClaim[];
    constructor(operation: LongitudinalOperation, claims: RootContinuityClaim[]);
}
/** A document that does not say how its key was chosen did not have one declared. */
export declare function identityClassOf(record: RootIdentityRecord): RootIdentityClass;
export interface AssertLongitudinalRootIdentityInput {
    operation: LongitudinalOperation;
    /** Roots as this run keyed them. */
    currentRoots: readonly RootIdentityRecord[];
    /** Roots as the snapshot or session being continued from keyed them. */
    previousRoots: readonly RootIdentityRecord[];
    /** The operator's explicit acceptance of a weaker identity. */
    allowInferredRootHistory: boolean;
}
/**
 * Decide whether this run may claim continuity with a previous observation.
 *
 * Only *matched* roots are considered. A root that appears on one side and not
 * the other makes no continuity claim — it was added or it was removed, and
 * neither statement depends on the key being trustworthy — so an added root
 * never forces an override the operator would have no way to reason about.
 *
 * Throws `InferredRootHistoryError` when a matched root's continuity rests on an
 * inferred key and the operator has not accepted that. Returns what was matched
 * and what was weak otherwise, so a caller can record the override it used.
 */
export declare function assertLongitudinalRootIdentityAuthorized(input: AssertLongitudinalRootIdentityInput): LongitudinalAuthorization;
/**
 * The provenance record for an override that was used.
 *
 * Null when no weak claim was made, so a run that needed nothing records nothing
 * — an `enabled: false` entry on every ordinary run would train a reader to skip
 * the field that matters.
 */
export declare function inferredRootHistoryOverride(authorizations: readonly {
    operation: LongitudinalOperation;
    result: LongitudinalAuthorization;
}[]): InferredRootHistoryOverride | null;
/** The caution a run states when it proceeded on an identity it was told to accept. */
export declare function inferredRootHistoryWarning(override: InferredRootHistoryOverride): string;
