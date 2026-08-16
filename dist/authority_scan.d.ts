/**
 * Read-only scan for competing repository metadata authorities.
 *
 * This scanner intentionally includes hidden control surfaces that normal artifact
 * discovery omits. It does not make those paths mutation candidates.
 *
 * Three distinct things are separated here, because collapsing them is what made a
 * mature repository un-adoptable without source surgery:
 *
 *   historical marker        legacy L9 metadata *text*, with nothing showing that the
 *                            containing surface writes L9 metadata. Always inert.
 *   dormant writer artifact  a control surface whose own evidence specifically claims to
 *                            write/inject/verify/generate/sync L9 metadata, but which
 *                            nothing invokes. Blocking under `forbidden`; a recorded
 *                            migration notice under `migration_only`.
 *   active invocation        a live control surface that calls a competing writer.
 *                            Blocking under every policy.
 *
 * A generic `writeFileSync` / `json.dump` / `yaml.safe_dump` / `open(..., "w")` is never
 * sufficient on its own. The write has to be tied to the L9 metadata surface, either on
 * the same line or by a filename that names it.
 *
 * The repository's declared `legacy_writers` policy is an input to this decision, not a
 * separate validation pass: there is exactly one authority scanner.
 */
import { type AuthorityLoadOptions } from "./authority";
import { type AuthorityConfig, type AuthorityConflict, type AuthorityLegacyPolicy, type AuthorityNotice, type OperationMode } from "./operation_contracts";
export type AuthorityEvidenceKind = "writer_script" | "writer_invocation" | "legacy_marker" | "canonical_invocation";
/** How the repository's legacy policy dispositions one piece of evidence. */
export type AuthorityEvidenceDisposition = "inert" | "migration" | "conflict";
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
    /**
     * Repository legacy-writer policy. Absent means the authority did not resolve, and the
     * scan fails closed: every legacy writer signal is treated as a conflict.
     */
    legacyPolicy?: AuthorityLegacyPolicy;
}
export interface AuthorityScanResult {
    scannedPaths: string[];
    evidence: AuthorityEvidence[];
    scanGaps: AuthorityConflict[];
    conflicts: AuthorityConflict[];
    /** Non-blocking findings: inert historical markers and migration allowances. */
    notices: AuthorityNotice[];
}
export interface RepositoryAuthorityInspection {
    root: string;
    authorityPath: string;
    authority?: AuthorityConfig;
    authorityResolved: boolean;
    /** The policy actually applied to legacy evidence, when the authority resolved. */
    legacyPolicy?: AuthorityLegacyPolicy;
    scannedPaths: string[];
    evidence: AuthorityEvidence[];
    scanGaps: AuthorityConflict[];
    conflicts: AuthorityConflict[];
    notices: AuthorityNotice[];
}
/**
 * Apply the repository's declared legacy-writer policy to one piece of evidence.
 *
 * An absent policy means the authority did not resolve; the scan then fails closed and
 * treats every legacy writer signal as a conflict.
 */
export declare function dispositionForEvidence(kind: AuthorityEvidenceKind, policy: AuthorityLegacyPolicy | undefined): AuthorityEvidenceDisposition;
export declare function scanRepositoryAuthority(root: string, options?: AuthorityScanOptions): AuthorityScanResult;
export declare function inspectRepositoryAuthority(root: string, options?: AuthorityLoadOptions & AuthorityScanOptions): RepositoryAuthorityInspection;
export declare function assertRepositoryAuthorityForOperation(mode: OperationMode, inspection: RepositoryAuthorityInspection): AuthorityConfig | undefined;
