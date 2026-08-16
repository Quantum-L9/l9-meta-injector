/**
 * Shared carrier-aware planning for governed check/apply operations.
 *
 * This module is the single bridge from the canonical pipeline's metadata plan
 * to the carrier policy. It never writes source files, adjacent sidecars, logs,
 * reports, or indexes. Both check and apply consume the exact same plan.
 */
import type { AuthorityConfig, CarrierDecision, CheckDrift } from "./operation_contracts";
import { type MetadataIndexCompilation } from "./metadata_index";
import { type PipelineMetadataSubject, type PipelineResult } from "./pipeline";
import type { InjectionRecord, PipelineConfig } from "./schema";
export declare const CANONICAL_METADATA_WRITER: "Quantum-L9/l9-meta-injector";
export type GovernedCarrierMode = "check" | "apply";
export interface CarrierOperationPlan {
    mode: GovernedCarrierMode;
    root: string;
    authority: AuthorityConfig;
    pipeline: PipelineResult;
    subjects: PipelineMetadataSubject[];
    carrierDecisions: CarrierDecision[];
    metadataIndex: MetadataIndexCompilation;
    inlinePlans: InjectionRecord[];
}
export interface PlanCarrierOperationInput {
    mode: GovernedCarrierMode;
    authority: AuthorityConfig;
    config: PipelineConfig;
}
export declare function buildCarrierOperationPlan(mode: GovernedCarrierMode, rootInput: string, authority: AuthorityConfig, pipeline: PipelineResult): CarrierOperationPlan;
export declare function planCarrierOperationAsync(input: PlanCarrierOperationInput): Promise<CarrierOperationPlan>;
export declare function metadataIndexDrift(plan: CarrierOperationPlan): CheckDrift | null;
/**
 * Drift for decisions the repository's own authority asked for but cannot receive.
 *
 * A malformed header under an explicit `inline_allow` authorization is reported here, not
 * repaired: preserving the file's bytes outranks satisfying the authorization.
 */
export declare function unsatisfiedAuthorizationDrift(plan: CarrierOperationPlan): CheckDrift[];
export declare function inlinePlanDrift(plan: CarrierOperationPlan): CheckDrift[];
