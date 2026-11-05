/**
 * Repository metadata-authority loading and validation.
 *
 * The authority file is intentionally parsed with a narrow, fail-closed grammar.
 * It accepts l9.meta-authority/v1 and l9.meta-authority/v2 and never attempts
 * permissive YAML recovery. A malformed authority declaration is an error, not
 * an invitation to infer repository policy.
 */
import { type AuthorityConfig, type AuthorityConflict, type AuthorityConflictCode, type AuthorityWriter, type HeaderIdentityRequest, type HeaderIdentityResolution, type ProductDeclaration, type SemanticFoundationBinding } from "./operation_contracts";
export declare const META_AUTHORITY_RELATIVE_PATH: ".l9/meta-authority.yaml";
export interface AuthorityLoadOptions {
    authorityPath?: string;
    expectedWriter?: Partial<AuthorityWriter>;
}
export interface AuthorityLoadResult {
    path: string;
    authority?: AuthorityConfig;
    conflicts: AuthorityConflict[];
    /**
     * `sha256:`-prefixed digest of the exact authority bytes that were parsed.
     * Present whenever the document was read, whether or not it parsed, so a
     * caller can cite the bytes a verdict was reached on.
     */
    digest?: string;
}
/** Parse the intentionally small l9.meta-authority/v1 YAML grammar. */
export declare function parseAuthorityYaml(text: string): AuthorityConfig;
export declare function loadRepositoryAuthority(root: string, options?: AuthorityLoadOptions): AuthorityLoadResult;
export declare function resolveHeaderIdentity(root: string, request?: HeaderIdentityRequest): HeaderIdentityResolution;
export declare function assertHeaderIdentity(resolution: HeaderIdentityResolution): HeaderIdentityResolution;
export declare function verifySemanticFoundation(binding: SemanticFoundationBinding, semanticsRoot: string): AuthorityConflict[];
/** The only repository a Semantic Foundation binding may name (ADR-052). */
export declare const SEMANTIC_FOUNDATION_REPOSITORY: "Quantum-L9/.github";
/**
 * What a repository's authority file establishes about its Semantic Foundation
 * binding, observed read-only.
 *
 * `unbound` — no authority file. `v1` — an l9.meta-authority/v1 file, which by
 * construction declares no Foundation. `bound` — a structurally valid v2 binding.
 * `invalid` — an authority file exists and does not parse or validate.
 */
export type SemanticBindingStatus = "unbound" | "v1" | "bound" | "invalid";
/**
 * Whether the cited Foundation content was checked, and against what.
 *
 * `verified` means exactly the checks in `SEMANTIC_BINDING_VERIFICATION_SCOPE`
 * passed against an operator-supplied checkout. It never means admission: a
 * `candidate` binding with verified digests is still a candidate.
 */
export type SemanticBindingVerificationStatus = "verified" | "not_run" | "failed";
/** The checks a `verified` result covers, named so a consumer cannot read more into it. */
export declare const SEMANTIC_BINDING_VERIFICATION_SCOPE: readonly ["binding-names-foundation-repository", "checkout-origin-names-foundation-repository", "checkout-head-equals-bound-revision", "every-cited-ledger-present-once", "every-cited-ledger-digest-matches", "product-id-equals-observed-repository-name"];
export interface SemanticBindingObservation {
    status: SemanticBindingStatus;
    /** Repository-relative authority path. Never absolute. */
    bindingPath: typeof META_AUTHORITY_RELATIVE_PATH;
    /** Digest of the exact authority bytes, when a file was read. */
    bindingDigest?: string;
    authoritySchema?: string;
    semanticFoundation?: SemanticFoundationBinding;
    product?: ProductDeclaration;
    verification: {
        status: SemanticBindingVerificationStatus;
        /** Revision the checkout was observed at, when it was read. */
        checkoutRevision?: string;
        ledgersVerified?: number;
    };
    /**
     * Codes and repository-portable messages of every problem found. Absolute
     * paths are deliberately absent: these can be carried into a packet.
     */
    conflicts: Array<{
        code: AuthorityConflictCode;
        message: string;
    }>;
}
export interface SemanticBindingObservationOptions {
    /**
     * An operator-supplied Quantum-L9/.github checkout. Supplying it requests
     * verification; without it the binding is reported as declared, never verified.
     * Mutable remote state is never fetched.
     */
    semanticsRoot?: string;
    /** The repository name the caller is observing; compared with `product.id`. */
    repositoryName?: string;
}
/**
 * Observe the repository's Semantic Foundation binding without mutating anything.
 *
 * This is a reader of `loadRepositoryAuthority`, not a second parser, and it
 * reuses `verifySemanticFoundation` for the ledger checks. It never upgrades
 * admission, never fetches, and returns conflicts instead of throwing so the
 * caller decides what is fatal.
 */
export declare function observeSemanticBinding(root: string, options?: SemanticBindingObservationOptions): SemanticBindingObservation;
