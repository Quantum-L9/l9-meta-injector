/**
 * Repository metadata-authority loading and validation.
 *
 * The authority file is intentionally parsed with a narrow, fail-closed grammar.
 * It accepts only the l9.meta-authority/v1 shape and never attempts permissive
 * YAML recovery. A malformed authority declaration is an error, not an invitation
 * to infer repository policy.
 */
import { type AuthorityConfig, type AuthorityConflict, type AuthorityWriter } from "./operation_contracts";
export declare const META_AUTHORITY_RELATIVE_PATH: ".l9/meta-authority.yaml";
export interface AuthorityLoadOptions {
    authorityPath?: string;
    expectedWriter?: Partial<AuthorityWriter>;
}
export interface AuthorityLoadResult {
    path: string;
    authority?: AuthorityConfig;
    conflicts: AuthorityConflict[];
}
/** Parse the intentionally small l9.meta-authority/v1 YAML grammar. */
export declare function parseAuthorityYaml(text: string): AuthorityConfig;
export declare function loadRepositoryAuthority(root: string, options?: AuthorityLoadOptions): AuthorityLoadResult;
