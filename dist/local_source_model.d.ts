import { InterpretationResult } from "./interpretation";
import { LocalSourceAcquireInput, LocalSourceObservation } from "./local_source";
import { LocalArchivePolicy } from "./local_archive_policy";
import { CorpusIndex, NearDuplicateOptions } from "./corpus_analysis";
import { RepositoryModelLocalSourceInput, RepositoryModelPacket } from "./repository_model";
/** Schema of the acquisition manifest written beside a bundle. */
export declare const LOCAL_SOURCE_MANIFEST_SCHEMA = "l9.local-source-manifest/v1";
export interface LocalSourceModelInput extends LocalSourceAcquireInput {
    /** Producer version recorded in the packet and in every evidence record. */
    producerVersion: string;
    /** Emission timestamp; excluded from semantic identity. */
    generatedAt?: string;
    /** Run the deterministic interpretation pass. Default true. */
    interpret?: boolean;
}
export interface LocalSourceModelResult {
    packet: RepositoryModelPacket;
    observation: LocalSourceObservation;
    interpretation?: InterpretationResult;
}
/** Map an acquisition into the packet builder's provenance overlay. */
export declare function toRepositoryModelLocalSource(observation: LocalSourceObservation): RepositoryModelLocalSourceInput;
/** Reason the observation cannot become a canonical packet, or null when it can. */
export declare function canonicalBlockReason(observation: LocalSourceObservation): string | null;
/**
 * Observe a local source and build its Repository Model Packet.
 *
 * The caller owns the returned observation and must call `observation.dispose()`
 * once it is done with it; the staged member bytes are still on disk until then.
 * Use `withLocalSourceModel` when the packet is all that is needed.
 */
export declare function observeLocalSourceModel(input: LocalSourceModelInput): LocalSourceModelResult;
/** Run `body` against a fresh observation and always dispose the staging root. */
export declare function withLocalSourceModel<T>(input: LocalSourceModelInput, body: (result: LocalSourceModelResult) => T): T;
export interface LocalSourceCorpusOptions {
    nearDuplicates?: NearDuplicateOptions;
    /** Semantic candidate discovery. On by default. */
    semanticAnalysis?: boolean;
}
export interface LocalSourceCorpusOutputs {
    index: CorpusIndex;
    /** Rendered `corpus-index.json` bytes. */
    indexJson: string;
    /** Rendered `corpus-report.md` bytes. */
    report: string;
}
/**
 * Derive the corpus index and its human report from an already-built model.
 *
 * Everything here is a projection of the observation, the packet and the two
 * duplicate analyses. The staged archive-member bytes must still be on disk,
 * because the similarity pass reads member text the same way it reads a physical
 * file — so call this before `observation.dispose()`.
 */
export declare function buildLocalSourceCorpus(result: LocalSourceModelResult, options?: LocalSourceCorpusOptions): LocalSourceCorpusOutputs;
export interface LocalSourceManifest {
    schema: string;
    source_kind: string;
    source_name: string;
    source_revision: string;
    physical_snapshot_hash: string;
    /** Operational, never semantic: excluded from every identity in this package. */
    observed_at: string;
    source_mutated: false;
    archive_policy: LocalArchivePolicy;
    archives: {
        source_path: string;
        archive_hash: string;
        size_bytes: number;
        nested_depth: number;
        expanded: boolean;
        member_count: number;
        omitted_member_count: number;
        hold_codes: string[];
    }[];
    members: {
        virtual_source_path: string;
        member_hash: string;
        size_bytes: number;
        parent_archive_hash: string;
        nested_depth: number;
    }[];
    diagnostics: {
        code: string;
        severity: string;
        message: string;
        source_path?: string;
    }[];
    omitted_paths: string[];
}
export interface BuildLocalSourceManifestOptions {
    /** Operational observation timestamp. Never participates in semantic identity. */
    observedAt: string;
}
/** Build the acquisition manifest. Never written inside the observed source tree. */
export declare function buildLocalSourceManifest(observation: LocalSourceObservation, options: BuildLocalSourceManifestOptions): LocalSourceManifest;
/** Write the acquisition manifest to a tool-owned output location. */
export declare function writeLocalSourceManifest(manifest: LocalSourceManifest, targetPath: string, sourceRoot: string): string;
/** Write `corpus-index.json` and `corpus-report.md` outside the observed source. */
export declare function writeLocalSourceCorpus(outputs: LocalSourceCorpusOutputs, targets: {
    indexPath: string;
    reportPath: string;
}, sourceRoot: string): {
    indexPath: string;
    reportPath: string;
};
