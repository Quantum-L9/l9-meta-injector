/**
 * Deterministic central metadata index.
 *
 * The index is newline-delimited canonical JSON at `.l9/metadata-index.jsonl`.
 * It is the sole default metadata carrier for source, configuration, test,
 * automation, infrastructure, structured data, and inventory-only artifacts.
 * This module never creates adjacent sidecars or inject logs.
 */
import type { ArtifactType } from "./schema";
import type { CarrierDecision, MetadataCarrier, OperationMode } from "./operation_contracts";
import { type CarrierSubject } from "./mutation_policy";
import type { AuthorityConfig } from "./operation_contracts";
export declare const METADATA_INDEX_SCHEMA: "l9.metadata-index/v1";
export declare const METADATA_INDEX_RELATIVE_PATH: ".l9/metadata-index.jsonl";
export type MaterializedMetadataCarrier = Exclude<MetadataCarrier, "hard_skip">;
export interface ManagedMetadataSubject extends CarrierSubject {
    contentHash: string;
    metadata: Readonly<Record<string, unknown>>;
}
export interface MetadataIndexRecord {
    schema: typeof METADATA_INDEX_SCHEMA;
    path: string;
    carrier: MaterializedMetadataCarrier;
    artifact_type: ArtifactType;
    content_hash: string;
    metadata: Record<string, unknown>;
}
export interface MetadataIndexCompilation {
    records: MetadataIndexRecord[];
    bytes: string;
    sha256: string;
    carrierDecisions: CarrierDecision[];
}
export interface CompileMetadataIndexInput {
    authority: AuthorityConfig;
    mode: OperationMode;
    subjects: readonly ManagedMetadataSubject[];
}
export interface WriteMetadataIndexOptions {
    dryRun?: boolean;
}
export interface WriteMetadataIndexResult extends MetadataIndexCompilation {
    absolutePath: string;
    relativePath: typeof METADATA_INDEX_RELATIVE_PATH;
    changed: boolean;
    written: boolean;
}
export declare function serializeMetadataIndex(records: readonly MetadataIndexRecord[]): string;
export declare function compileMetadataIndex(input: CompileMetadataIndexInput): MetadataIndexCompilation;
export declare function writeMetadataIndex(root: string, input: CompileMetadataIndexInput, options?: WriteMetadataIndexOptions): WriteMetadataIndexResult;
export declare function parseMetadataIndex(bytes: string): MetadataIndexRecord[];
