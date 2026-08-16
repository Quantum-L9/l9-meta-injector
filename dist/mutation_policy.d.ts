/**
 * Deterministic metadata-carrier policy.
 *
 * Carrier selection is deliberately separate from file discovery and mutation.
 * Every discovered path receives one policy decision before later workstreams
 * decide how to materialize a central manifest or an inline managed patch.
 */
import type { ArtifactType } from "./schema";
import type { AuthorityConfig, CarrierDecision, MetadataCarrier, OperationMode } from "./operation_contracts";
export declare const CARRIER_PRECEDENCE: readonly MetadataCarrier[];
export declare const INLINE_MANAGED_ARTIFACT_TYPES: Set<ArtifactType>;
export type CarrierInjectionStrategy = "yaml-frontmatter" | "line-comment" | "block-comment" | "sidecar" | "skip-binary";
/**
 * Why a subject cannot act as its own inline carrier.
 *
 * Structural mirror of `PipelineMetadataSubject.inlineCarrierBlock`, declared here so the
 * carrier policy stays independent of the pipeline module.
 */
export interface CarrierInlineBlock {
    code: string;
    malformed: boolean;
}
export interface CarrierSubject {
    /** Repository-relative path. Absolute or traversal paths are rejected. */
    path: string;
    artifactType: ArtifactType;
    strategy: CarrierInjectionStrategy;
    /** Set when the file's existing frontmatter is outside the inline-patchable subset. */
    inlineCarrierBlock?: CarrierInlineBlock;
}
export interface CarrierPolicyInput {
    authority: AuthorityConfig;
    mode: OperationMode;
    subjects: readonly CarrierSubject[];
}
export declare function resolveCarrierDecision(subject: CarrierSubject, authority: AuthorityConfig, mode: OperationMode): CarrierDecision;
export declare function resolveCarrierDecisions(input: CarrierPolicyInput): CarrierDecision[];
export declare function assertCarrierDecisionCoverage(subjects: readonly CarrierSubject[], decisions: readonly CarrierDecision[]): void;
