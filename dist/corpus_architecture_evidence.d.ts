import type { DocumentBlockView } from "./extractors/document_blocks";
import { ArchitectureCoverageDiagnostic, ArchitectureRecognitionForm, ArchitectureStatementClass } from "./extractors/architecture_statements";
/** Schema of the complete payload. One record per line. */
export declare const ARCHITECTURE_EVIDENCE_SCHEMA = "l9.architecture-evidence/v1";
/** Schema of the payload's completeness and integrity receipt. */
export declare const ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA = "l9.architecture-evidence-manifest/v1";
/** Where the payload and its manifest are written inside a generation. */
export declare const ARCHITECTURE_EVIDENCE_PAYLOAD_FILE = "architecture-evidence.jsonl";
export declare const ARCHITECTURE_EVIDENCE_MANIFEST_FILE = "architecture-evidence.manifest.json";
/** Identity of the whole projection: the reader plus the selection profile. */
export declare const ARCHITECTURE_EVIDENCE_PROFILE_ID = "meta-injector-architecture-evidence";
/**
 * 1.1.0: the reader's coverage closure (`architecture-statements/v1` 1.1.0) and
 * the `unit_count` field on every record. Record identity is unchanged.
 *
 * 1.2.0: the selection policy moves to `architecture-development/v2` — the
 * `historical`, `research` and `accepted_declaration` roles, each from explicit
 * declarations only, the policy table carried in the manifest, and the role
 * selector exported so the query can file every record's document under the
 * same roles. Record identity is unchanged.
 */
export declare const ARCHITECTURE_EVIDENCE_PROFILE_VERSION = "1.3.0";
/** The one selection profile this release ships. A view over the records, not a vocabulary. */
export declare const ARCHITECTURE_SELECTION_PROFILE_ID = "architecture-development/v2";
/** What every record is, epistemically. Stated on each one so no reader has to remember. */
export declare const ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS = "source-declared";
export declare const ARCHITECTURE_EVIDENCE_STATEMENT: string;
/**
 * The roles the selection profile recognizes, each from explicit evidence only.
 *
 * `wip_proposal`        — a declared kind in the proposal family (design, plan,
 *                         proposal, roadmap), or a declared status that says the
 *                         work is not finished (draft, planned, wip). A legacy
 *                         selection-family name: matching a plan kind says what
 *                         the document is for, not that it is unfinished today.
 * `specification`       — a declared specification or decision kind.
 * `development_handoff` — a declared checklist kind, or the document carries the
 *                         task, blocker or dependency declarations a handoff is
 *                         made of.
 * `research_notes`      — a declared research or notes kind. Research is not
 *                         evidence of a WIP proposal; a research document is also
 *                         a `wip_proposal` only when it declares a WIP status.
 * `unknown`             — no supported role rule matched the declarations.
 *
 * A role is a retrieval-selection classification, never a lifecycle judgement.
 * `work.status` stays a separate, independently queryable axis: an archived
 * specification is a specification whose declared status is archived, not a
 * different role. Roles overlap: a `Type: plan` document with open tasks is both
 * a proposal and a handoff, and the classes each selects are the union. Every
 * role is a reading of what the document declared about itself; none is a
 * verdict about whether the declaration is true today.
 */
export declare const ARCHITECTURE_DOCUMENT_ROLES: readonly ["development_handoff", "research_notes", "specification", "unknown", "wip_proposal"];
export type ArchitectureDocumentRole = (typeof ARCHITECTURE_DOCUMENT_ROLES)[number];
/** What the unknown role says about itself: a fallback, never a reading of evidence. */
export declare const UNKNOWN_ROLE_EXPLANATION: string;
/** The policy, as the manifest states it: every rule, nothing hidden in code. */
export interface SelectionPolicyRule {
    role: ArchitectureDocumentRole;
    /** `work.kind` values that establish the role. */
    kinds: string[];
    /** `work.status` values that establish the role. */
    statuses: string[];
    /** Predicates whose presence establishes the role. */
    predicates: string[];
    /** Statement classes the role selects. */
    classes: ArchitectureStatementClass[];
}
export interface SelectionPolicy {
    profile_id: string;
    rules: SelectionPolicyRule[];
    /** What a document matching no rule selects. */
    unknown_role_selects: ArchitectureStatementClass[];
    statement: string;
}
export declare const SELECTION_POLICY_STATEMENT: string;
/** The selection policy this profile applies, for the manifest and the docs. */
export declare function architectureSelectionPolicy(): SelectionPolicy;
/**
 * Hash of the rules this projection applies: the reader's grammar and vocabulary,
 * the selection table, and the record contract. Bound into the analysis identity
 * when the projection is selected, and nowhere when it is not.
 */
export declare function architectureEvidenceProfileHash(): string;
/** An existing work-signal assertion, by the identity it already carries. */
export interface ExistingWorkAssertion {
    assertion_id: string;
    predicate: string;
    object: string;
}
/** A reference to an existing assertion, as a record cites it. */
export interface WorkEvidenceRef {
    predicate: string;
    object: string;
    assertion_id: string;
}
/** Why a role was assigned: one example per predicate that established it, with the count. */
export interface RoleEvidence extends WorkEvidenceRef {
    role: ArchitectureDocumentRole;
    /** How many assertions of this predicate the document carries. */
    count: number;
}
/**
 * One architectural statement, as a downstream consumer receives it.
 *
 * Nothing here names an output directory, a cache, a host or a clock. The same
 * statement read from the same bytes is the same record wherever it is written.
 */
export interface ArchitectureEvidenceRecord {
    /** Stable across runs and output locations. Never derived from a path. */
    evidence_id: string;
    /** Corpus identity (`vsrc:…`), resolving in `document-index.json` and the snapshot. */
    artifact_id: string;
    /** The same artifact inside its root's Repository Model Packet (`artifact:…`). */
    rmp_artifact_id: string;
    /** Root-relative, or a virtual `archive.zip!/member` locator. Never absolute. */
    source_path: string;
    format: string;
    /** Hash of the source bytes, not of the decoded text. */
    raw_content_hash: string | null;
    normalized_document_id: string | null;
    decoder_id: string;
    decoder_version: string;
    block_id: string;
    block_kind: string;
    /** The exact coordinate, in the format's own terms. Its `kind` says which shape. */
    structured_locator: Record<string, unknown>;
    /** Line of the block's text the statement starts on, or null for a whole-block statement. */
    unit_index: number | null;
    /** How many of the block's lines the statement spans from `unit_index`. */
    unit_count: number;
    statement_class: ArchitectureStatementClass;
    /** The statement as written, normalized as a quotation and bounded. */
    declared_text: string;
    declared_text_truncated: boolean;
    bounded_excerpt: string;
    recognition: {
        form: ArchitectureRecognitionForm;
        label: string;
    };
    /** What the document already declared about itself, by existing assertion id. */
    work_context: {
        kinds: WorkEvidenceRef[];
        statuses: WorkEvidenceRef[];
        /** `work.status`, `work.supersedes`, `work.superseded_by`: whether the document still applies. */
        applicability: WorkEvidenceRef[];
        /** Tasks, blockers, dependencies and references the document carries, counted. */
        handoff: {
            predicate: string;
            count: number;
        }[];
    };
    selection: {
        profile_id: string;
        roles: ArchitectureDocumentRole[];
        role_evidence: RoleEvidence[];
        selected: boolean;
        /**
         * Exactly the matched roles whose rule selects this record's class, in code-point
         * order; `selected` is true exactly when it is non-empty. Derived from the same
         * typed rule evaluation as `reasons`, never from those sentences. Absent on
         * payloads written before profile 1.3.0, which recorded only `selected`.
         */
        selected_for_roles?: ArchitectureDocumentRole[];
        /** One sentence per rule that selected this record's class. Empty when none did. */
        reasons: string[];
    };
    epistemic_class: typeof ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS;
    authority_verified: false;
    extractor_id: string;
    extractor_version: string;
    profile_version: string;
}
export interface ArchitectureEvidenceDiagnosticRecord extends ArchitectureCoverageDiagnostic {
    artifact_id: string;
    source_path: string;
}
export interface ArchitectureEvidenceManifest {
    schema: string;
    corpus_source_snapshot_id: string;
    corpus_analysis_id: string;
    profile_id: string;
    profile_version: string;
    profile_hash: string;
    extractor_id: string;
    extractor_version: string;
    selection_profile_id: string;
    /** Every rule the selection applied, so a reader can check a reason against the row. */
    selection_policy: SelectionPolicy;
    payload_file: string;
    record_count: number;
    selected_record_count: number;
    /** Distinct artifacts that declared at least one statement. */
    document_count: number;
    /** Decoded documents the reader was given, whether or not they declared anything. */
    documents_read: number;
    by_class: {
        statement_class: string;
        record_count: number;
        selected_count: number;
    }[];
    by_format: {
        format: string;
        document_count: number;
        record_count: number;
    }[];
    by_role: {
        role: string;
        document_count: number;
    }[];
    by_recognition_form: {
        form: string;
        record_count: number;
    }[];
    /** Every coverage diagnostic the reader raised, bounded per document. */
    diagnostics: ArchitectureEvidenceDiagnosticRecord[];
    diagnostic_count: number;
    /** Diagnostics beyond the per-document bound, counted so none is silently lost. */
    diagnostics_omitted: number;
    payload_byte_length: number;
    payload_artifact_hash: string;
    payload_semantic_hash: string;
    epistemic_class: string;
    statement: string;
}
export interface ArchitectureEvidenceExport {
    records: ArchitectureEvidenceRecord[];
    manifest: ArchitectureEvidenceManifest;
    payloadJsonl: string;
    manifestJson: string;
}
/** Reference to the payload, small enough to sit inside the snapshot. */
export interface ArchitectureEvidenceRef {
    schema: string;
    manifest_ref: string;
    payload_ref: string;
    record_count: number;
    payload_semantic_hash: string;
    payload_artifact_hash: string;
}
/** One decoded document, as this projection needs it. */
export interface ArchitectureEvidenceDocumentInput {
    artifactId: string;
    rmpArtifactId: string;
    sourcePath: string;
    format: string;
    rawContentHash: string | null;
    normalizedDocumentId: string | null;
    decoderId: string;
    decoderVersion: string;
    blocks: readonly DocumentBlockView[];
    /** Every existing work-signal assertion about this document, from either reader. */
    workAssertions: readonly ExistingWorkAssertion[];
}
export interface BuildArchitectureEvidenceInput {
    corpusSourceSnapshotId: string;
    corpusAnalysisId: string;
    documents: readonly ArchitectureEvidenceDocumentInput[];
}
export interface DocumentSelection {
    roles: ArchitectureDocumentRole[];
    roleEvidence: RoleEvidence[];
    /** Why each selected class was selected: one sentence per selecting rule. */
    reasonsByClass: Map<ArchitectureStatementClass, string[]>;
    /** Which matched roles select each class: the typed form of `reasonsByClass`, same pass. */
    rolesByClass: Map<ArchitectureStatementClass, ArchitectureDocumentRole[]>;
}
/**
 * Decide the document's roles from its own declarations, and which classes they select.
 *
 * Every role is established by a named assertion, and every selected class by a
 * named rule. The sentences are generated from the table rather than written
 * per document, so a reader can check a reason against the table and find the
 * row.
 */
export declare function selectForDocument(assertions: readonly ExistingWorkAssertion[]): DocumentSelection;
/** One record, canonically rendered onto a single line. */
export declare function renderArchitectureEvidenceRecord(record: ArchitectureEvidenceRecord): string;
/**
 * Build the complete payload and its manifest from the documents a scan holds.
 *
 * Refuses a duplicate `evidence_id` rather than collapsing it, for the reason the
 * work-signal export gives: two records under one id are a defect in the identity
 * formula or in the reader, and a payload that deduplicated them would report a
 * count nobody could reconcile.
 */
export declare function buildArchitectureEvidenceExport(input: BuildArchitectureEvidenceInput): ArchitectureEvidenceExport;
/** The snapshot-sized reference to a payload. */
export declare function architectureEvidenceRef(manifest: ArchitectureEvidenceManifest): ArchitectureEvidenceRef;
export interface VerifyArchitectureEvidenceExportInput {
    manifest: ArchitectureEvidenceManifest;
    /** The payload exactly as it was written or read back. */
    payloadJsonl: string;
    /** Artifact ids the corpus observed. A record naming anything else is dangling. */
    knownArtifactIds: ReadonlySet<string>;
    /** Normalized document ids the corpus produced. */
    knownNormalizedDocumentIds: ReadonlySet<string>;
}
/**
 * Prove a payload is the complete set its manifest claims, before it is published.
 *
 * The checks mirror the work-signal export's, and add the two this contract
 * promises on every record: that it is classed source-declared and that it
 * claims no verified authority. A record that said otherwise would be the
 * payload promoting a document's statement into something the corpus never
 * established.
 */
export declare function verifyArchitectureEvidenceExport(input: VerifyArchitectureEvidenceExportInput): string[];
