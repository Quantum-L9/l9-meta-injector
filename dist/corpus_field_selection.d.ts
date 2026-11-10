import type { ArchitectureDocumentRole, ArchitectureEvidenceRecord } from "./corpus_architecture_evidence";
export declare const FIELD_SELECTION_SCHEMA = "l9.local-source-field-selection/v1";
export declare const FIELD_SELECTION_MANIFEST_SCHEMA = "l9.local-source-field-selection-manifest/v1";
export declare const FIELD_SELECTION_PAYLOAD_FILE = "field-selection.jsonl";
export declare const FIELD_SELECTION_MANIFEST_FILE = "field-selection.manifest.json";
export declare const FIELD_SELECTION_POLICY_ID = "local-source-field-selection/v1";
/** Moves whenever a table, a rule or the record shape changes. */
export declare const FIELD_SELECTION_POLICY_VERSION = "1.0.0";
export declare const FIELD_SELECTION_STATEMENT: string;
/** The run intents the policy knows. Closed. */
export declare const FIELD_SELECTION_INTENTS: readonly ["architecture_review", "design_exploration", "development_handoff", "history_audit"];
export type FieldSelectionIntent = (typeof FIELD_SELECTION_INTENTS)[number];
/** Where a field's values come from. Each is a payload the generation already holds. */
export type FieldSource = "architecture_evidence" | "document_work_signals" | "repository_model_packet";
/**
 * The field vocabulary: every field is an existing evidence field. Statement
 * fields are architecture-evidence records by class; declaration fields are the
 * selection's block-read declarations; work fields are work-signal predicates,
 * from the packet's interpreted assertions or the block-signal payload.
 */
export declare const FIELD_SELECTION_FIELDS: readonly ["declaration.decision_record_title", "declaration.declared_status", "document.heading", "document.title", "statement.assumption", "statement.constraint", "statement.decision_statement", "statement.intent", "statement.open_question", "work.blocked_by", "work.depends_on", "work.kind", "work.milestone", "work.references", "work.status", "work.superseded_by", "work.supersedes", "work.task.completed", "work.task.open"];
export type FieldSelectionField = (typeof FIELD_SELECTION_FIELDS)[number];
/** What happened to a field, for one document. Closed. */
export declare const FIELD_DISPOSITIONS: readonly ["not_selected_for_intent", "omitted_by_budget", "redundant", "selected", "unavailable"];
export type FieldDisposition = (typeof FIELD_DISPOSITIONS)[number];
/** The output bound, per document. Part of the profile hash. */
export interface FieldSelectionBudget {
    maxFields: number;
    maxValuesPerField: number;
    maxCharacters: number;
}
export declare const DEFAULT_FIELD_SELECTION_BUDGET: Readonly<FieldSelectionBudget>;
/** Carriers this view can be written to, and what was decided for each. */
export declare const FIELD_SELECTION_CARRIER: {
    readonly disposition: "external_generation";
    readonly path: "field-selection.jsonl";
    readonly observed_files_mutated: false;
    readonly refused: readonly [{
        readonly carrier: "central_manifest";
        readonly reason: "a central manifest is written into the observed repository; local-source never writes under an observed root (ADR-036)";
    }, {
        readonly carrier: "inline_managed";
        readonly reason: "an inline carrier rewrites the observed file; local-source never modifies an observed file (ADR-036)";
    }];
};
/** Whether a budget is usable. A view nobody can bound is refused, not clamped. */
export declare function validateFieldSelectionBudget(budget: FieldSelectionBudget): string[];
/** The policy as the data its hash is taken over. */
export declare function fieldSelectionPolicy(): Record<string, unknown>;
/** Hash of the policy alone. */
export declare function fieldSelectionPolicyHash(): string;
/**
 * Hash of what a run selected under: the policy, the intent and the budget. Bound
 * into `corpus_analysis_id` as `field_selection_profile` when the view is
 * selected, so two runs with different intents or bounds never share an
 * analysis identity.
 */
export declare function fieldSelectionProfileHash(intent: FieldSelectionIntent, budget: FieldSelectionBudget): string;
/** One existing value a field could surface. */
export interface FieldValueCandidate {
    record_id: string;
    source: FieldSource;
    value: string;
    /** Position used for a fixed order: a line or block index, or -1. */
    position: number;
}
/** One document's evidence, as the scan holds it. */
export interface FieldSelectionDocumentInput {
    artifactId: string;
    rmpArtifactId: string;
    sourcePath: string;
    format: string | null;
    /** Architecture-evidence records of this document (they carry its roles). */
    architectureRecords: readonly ArchitectureEvidenceRecord[];
    /** Existing work assertions about this document, from the packet or the block signals. */
    workValues: readonly {
        record_id: string;
        source: FieldSource;
        predicate: string;
        object: string;
    }[];
    exactDuplicate: {
        clusterId: string;
        representativeArtifactId: string;
    } | null;
    nearDuplicateCandidateIds: readonly string[];
}
export interface FieldSelectionValue {
    record_id: string;
    source: FieldSource;
    value: string;
}
export interface FieldSelectionFieldDecision {
    field: FieldSelectionField;
    /** `core`, `supporting`, or null for a field the intent and roles did not ask for. */
    tier: "core" | "supporting" | null;
    disposition: FieldDisposition;
    /** One sentence per rule that decided the disposition, naming the rule and its evidence. */
    reasons: string[];
    available_value_count: number;
    /** Distinct values not already in this document's view when the field was decided. */
    new_value_count: number;
    selected_values: FieldSelectionValue[];
    /** Values the field had that the budget left out. */
    values_omitted: number;
}
export interface FieldSelectionRecord {
    view_id: string;
    artifact_id: string;
    rmp_artifact_id: string;
    source_path: string;
    format: string | null;
    intent: FieldSelectionIntent;
    roles: ArchitectureDocumentRole[];
    /** The assertion or declaration ids that established the roles (ADR-090). */
    role_evidence_ids: string[];
    exact_duplicate_cluster_id: string | null;
    near_duplicate_candidate_ids: string[];
    carrier_disposition: typeof FIELD_SELECTION_CARRIER.disposition;
    fields: FieldSelectionFieldDecision[];
    selected_field_count: number;
    selected_character_count: number;
    epistemic_class: "source-declared";
    authority_verified: false;
    policy_id: string;
    policy_version: string;
}
export interface FieldSelectionManifest {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    policy_id: string;
    policy_version: string;
    policy_hash: string;
    profile_hash: string;
    intent: FieldSelectionIntent;
    budget: {
        max_fields: number;
        max_values_per_field: number;
        max_characters: number;
    };
    carrier: typeof FIELD_SELECTION_CARRIER;
    payload_file: string;
    /** Documents that carry any statement or work value: every one has a record. */
    record_count: number;
    selected_field_count: number;
    by_field: {
        field: string;
        selected: number;
        redundant: number;
        omitted_by_budget: number;
        unavailable: number;
        not_selected_for_intent: number;
    }[];
    payload_byte_length: number;
    payload_artifact_hash: string;
    payload_semantic_hash: string;
    epistemic_class: "source-declared";
    statement: string;
}
export interface FieldSelectionExport {
    records: FieldSelectionRecord[];
    manifest: FieldSelectionManifest;
    payloadJsonl: string;
    manifestJson: string;
}
/** The snapshot-sized reference. */
export interface FieldSelectionRef {
    schema: string;
    manifest_ref: string;
    payload_ref: string;
    intent: FieldSelectionIntent;
    record_count: number;
    payload_semantic_hash: string;
    payload_artifact_hash: string;
}
/** Decide one document's view. Pure and total. */
export declare function selectFieldsForDocument(document: FieldSelectionDocumentInput, intent: FieldSelectionIntent, budget: FieldSelectionBudget): FieldSelectionRecord;
export interface BuildFieldSelectionInput {
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
    intent: FieldSelectionIntent;
    budget: FieldSelectionBudget;
    documents: readonly FieldSelectionDocumentInput[];
}
/** The complete view and its receipt. A document with no evidence has no record. */
export declare function buildFieldSelectionExport(input: BuildFieldSelectionInput): FieldSelectionExport;
export declare function fieldSelectionRef(manifest: FieldSelectionManifest): FieldSelectionRef;
export interface VerifyFieldSelectionInput {
    manifest: FieldSelectionManifest;
    payloadJsonl: string;
    /** Every record id the generation's payloads carry: evidence, declaration, signal and assertion ids. */
    knownRecordIds: ReadonlySet<string>;
    knownArtifactIds: ReadonlySet<string>;
}
/**
 * Prove the view is what its manifest claims and cites only what the generation
 * holds, before it is published. A view that cited a value no payload carries
 * would be the view inventing evidence.
 */
export declare function verifyFieldSelectionExport(input: VerifyFieldSelectionInput): string[];
/** True when the value names a known intent. */
export declare function isFieldSelectionIntent(value: string): value is FieldSelectionIntent;
/** Every statement class has a field, so a new class cannot silently fall outside the view. */
export declare const STATEMENT_FIELDS_COVER_CLASSES: boolean;
