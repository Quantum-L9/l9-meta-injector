import type { ArchitectureDocumentRole, ArchitectureEvidenceExport } from "./corpus_architecture_evidence";
import type { ArchitectureStatementClass } from "./extractors/architecture_statements";
export declare const METADATA_SELECTION_SCHEMA = "l9.metadata-selection/v1";
export declare const METADATA_SELECTION_MANIFEST_SCHEMA = "l9.metadata-selection-manifest/v1";
export declare const METADATA_SELECTION_PAYLOAD_FILE = "metadata-selection.jsonl";
export declare const METADATA_SELECTION_MANIFEST_FILE = "metadata-selection.manifest.json";
/** The one policy this package ships. Its rules are the table below. */
export declare const METADATA_SELECTION_POLICY_ID = "local-source-metadata-selection/v1";
export declare const METADATA_SELECTION_POLICY_VERSION = "1.0.0";
/**
 * Where a local-source run's metadata lives: in the generation the scan
 * publishes, beside the evidence it was derived from. The run observes files; it
 * never writes into them, and this view changes nothing about that.
 */
export declare const METADATA_CARRIER_DISPOSITION = "external-generation";
export declare const METADATA_CARRIER_STATEMENT: string;
export declare const METADATA_SELECTION_STATEMENT: string;
/**
 * What the run is for. Each intent is a static row in the table below; the
 * vocabulary is closed, and an intent this package does not know is refused at
 * the CLI rather than mapped to the nearest one.
 */
export declare const METADATA_SELECTION_INTENTS: readonly ["accepted_declaration", "development_handoff", "historical_review", "wip_design"];
export type MetadataSelectionIntent = (typeof METADATA_SELECTION_INTENTS)[number];
export declare function isMetadataSelectionIntent(value: string): value is MetadataSelectionIntent;
/**
 * The existing record fields the policy may select, by the path a reader would
 * use on an `ArchitectureEvidenceRecord`. Nothing outside this catalog is ever
 * carried, and the catalog names no field the evidence contract does not have.
 */
export declare const METADATA_FIELD_CATALOG: readonly [{
    readonly field: "evidence_id";
    readonly carries: "the record's identity, stable across runs and locations";
}, {
    readonly field: "artifact_id";
    readonly carries: "the corpus identity of the document";
}, {
    readonly field: "source_path";
    readonly carries: "the document's root-relative path";
}, {
    readonly field: "statement_class";
    readonly carries: "which of the five classes the statement is";
}, {
    readonly field: "declared_text";
    readonly carries: "the statement as written";
}, {
    readonly field: "structured_locator";
    readonly carries: "the exact coordinate in the format's own terms";
}, {
    readonly field: "bounded_excerpt";
    readonly carries: "the surrounding text, when it says more than the statement";
}, {
    readonly field: "recognition";
    readonly carries: "the written form and label the statement was read from";
}, {
    readonly field: "raw_content_hash";
    readonly carries: "the bytes the declaration was read from";
}, {
    readonly field: "work_context.kinds";
    readonly carries: "what kind of document it declares itself to be";
}, {
    readonly field: "work_context.statuses";
    readonly carries: "what stage the document declares it is at";
}, {
    readonly field: "work_context.applicability";
    readonly carries: "whether the document says it still applies";
}, {
    readonly field: "work_context.handoff";
    readonly carries: "the tasks, blockers and dependencies it carries, counted";
}, {
    readonly field: "selection.roles";
    readonly carries: "the roles the selection policy filed the document under";
}, {
    readonly field: "selection.role_evidence";
    readonly carries: "the declarations that established those roles";
}, {
    readonly field: "authority_verified";
    readonly carries: "that no statement in the view is verified (always false)";
}];
export type MetadataField = (typeof METADATA_FIELD_CATALOG)[number]["field"];
/** Carried on every included record whatever the intent: identity, class, text, coordinate. */
export declare const METADATA_ALWAYS_FIELDS: readonly MetadataField[];
export interface MetadataIntentRule {
    intent: MetadataSelectionIntent;
    statement: string;
    /** Documents filed under any of these roles are in the view. */
    roles: readonly ArchitectureDocumentRole[];
    /** Whether a document with no declared role is kept for recall. */
    retains_unknown_role: boolean;
    /** The classes the intent wants, most useful first; the order bounds the view. */
    classes: readonly ArchitectureStatementClass[];
    /** Fields beyond the always-set this intent carries. */
    fields: readonly MetadataField[];
    /** At most this many included records per document, taken in class order. */
    max_per_document: number;
}
export declare function metadataIntentRule(intent: MetadataSelectionIntent): MetadataIntentRule;
/** Why a record is in the view or not. Closed vocabulary; the manifest tallies it. */
export declare const METADATA_RECORD_REASONS: readonly ["role_matches_intent", "role_unknown_retained", "role_outside_intent", "class_outside_intent", "bounded_out"];
export type MetadataRecordReason = (typeof METADATA_RECORD_REASONS)[number];
/** Why a field is carried or not. */
export declare const METADATA_FIELD_DISPOSITIONS: readonly ["always", "intent_selects", "not_in_intent", "empty", "redundant"];
export type MetadataFieldDisposition = (typeof METADATA_FIELD_DISPOSITIONS)[number];
export interface MetadataSelectionPolicy {
    policy_id: string;
    policy_version: string;
    always_fields: MetadataField[];
    field_catalog: {
        field: MetadataField;
        carries: string;
    }[];
    intents: {
        intent: MetadataSelectionIntent;
        statement: string;
        roles: ArchitectureDocumentRole[];
        retains_unknown_role: boolean;
        classes: ArchitectureStatementClass[];
        fields: MetadataField[];
        max_per_document: number;
    }[];
    record_reasons: MetadataRecordReason[];
    field_dispositions: MetadataFieldDisposition[];
    /** The two field-level rules that are not a table row. */
    redundancy_rules: string[];
}
/** The whole policy, as the manifest carries it so a reason can be checked against its row. */
export declare function metadataSelectionPolicy(): MetadataSelectionPolicy;
/**
 * Hash of the policy: every row, the catalog and the rules. Independent of the
 * intent, which is a run parameter; the two are bound together into the analysis
 * identity by `metadataSelectionProfileHash`.
 */
export declare function metadataSelectionPolicyHash(): string;
/**
 * What enters `corpus_analysis_id` when the view is selected: the policy and the
 * intent it was applied with. A run for a handoff and a run for a review conclude
 * different things from the same evidence, so they are different analyses of the
 * same source snapshot.
 */
export declare function metadataSelectionProfileHash(intent: MetadataSelectionIntent): string;
export interface MetadataFieldReason {
    field: MetadataField;
    disposition: MetadataFieldDisposition;
    reason: string;
}
/**
 * One evidence record's place in the view. Every evidence record has one; only
 * an included record carries `fields`, and those are copies of the record's own
 * values under the catalog's paths.
 */
export interface MetadataSelectionRecord {
    evidence_id: string;
    artifact_id: string;
    source_path: string;
    statement_class: ArchitectureStatementClass;
    intent: MetadataSelectionIntent;
    roles: ArchitectureDocumentRole[];
    included: boolean;
    reason: MetadataRecordReason;
    /** One sentence naming the row or bound that decided `reason`. */
    explanation: string;
    fields?: Record<string, unknown>;
    field_reasons?: MetadataFieldReason[];
    policy_id: string;
    policy_version: string;
}
export interface MetadataSelectionManifest {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    policy_id: string;
    policy_version: string;
    policy_hash: string;
    profile_hash: string;
    intent: MetadataSelectionIntent;
    intent_statement: string;
    /** The evidence this view derives from, by the hashes its own manifest states. */
    derived_from: {
        schema: string;
        payload_file: string;
        profile_hash: string;
        payload_semantic_hash: string;
        record_count: number;
    };
    carrier: {
        disposition: typeof METADATA_CARRIER_DISPOSITION;
        mutates_observed_files: false;
        statement: string;
    };
    policy: MetadataSelectionPolicy;
    payload_file: string;
    record_count: number;
    included_record_count: number;
    document_count: number;
    included_document_count: number;
    by_reason: {
        reason: MetadataRecordReason;
        record_count: number;
    }[];
    by_class: {
        statement_class: string;
        included_count: number;
        excluded_count: number;
    }[];
    by_field: {
        field: MetadataField;
        carried_count: number;
        omitted_count: number;
    }[];
    payload_byte_length: number;
    payload_artifact_hash: string;
    payload_semantic_hash: string;
    epistemic_class: string;
    authority_verified: false;
    statement: string;
}
export interface MetadataSelectionExport {
    records: MetadataSelectionRecord[];
    manifest: MetadataSelectionManifest;
    payloadJsonl: string;
    manifestJson: string;
}
/** Reference to the payload, small enough to sit inside the snapshot. */
export interface MetadataSelectionRef {
    schema: string;
    manifest_ref: string;
    payload_ref: string;
    intent: MetadataSelectionIntent;
    record_count: number;
    included_record_count: number;
    payload_semantic_hash: string;
    payload_artifact_hash: string;
}
export interface BuildMetadataSelectionInput {
    intent: MetadataSelectionIntent;
    evidence: ArchitectureEvidenceExport;
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
}
export declare function renderMetadataSelectionRecord(record: MetadataSelectionRecord): string;
/**
 * Apply the intent's row to every evidence record. Records keep the evidence
 * payload's order; the per-document bound is taken in the row's class order so
 * that the most useful classes survive it, and a record it drops is listed as
 * `bounded_out` rather than vanishing.
 */
export declare function buildMetadataSelectionExport(input: BuildMetadataSelectionInput): MetadataSelectionExport;
export declare function metadataSelectionRef(manifest: MetadataSelectionManifest): MetadataSelectionRef;
export interface VerifyMetadataSelectionExportInput {
    manifest: MetadataSelectionManifest;
    payloadJsonl: string;
    /** The evidence the view claims to derive from: every record must point into it, once. */
    knownEvidenceIds: ReadonlySet<string>;
    /** The evidence manifest's semantic hash, so a view over other evidence is refused. */
    evidencePayloadSemanticHash: string;
}
/**
 * Prove the view is the one its manifest claims, before it is published: the
 * counts, both hashes, one verdict per evidence record and no other, fields only
 * on included records and only from the catalog, and every field the policy row
 * promised accounted for.
 */
export declare function verifyMetadataSelectionExport(input: VerifyMetadataSelectionExportInput): string[];
