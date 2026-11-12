import { ArchitectureCoverageDiagnostic, ArchitectureRecognitionForm, ArchitectureStatementClass } from "./extractors/architecture_statements";
import type { DocumentBlockView } from "./extractors/document_blocks";
/** Schema of the complete payload. One record per line. */
export declare const ARCHITECTURE_EVIDENCE_SCHEMA = "l9.architecture-evidence/v1";
/** Schema of the payload's completeness and integrity receipt. */
export declare const ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA = "l9.architecture-evidence-manifest/v1";
/** Where the payload and its manifest are written inside a generation. */
export declare const ARCHITECTURE_EVIDENCE_PAYLOAD_FILE = "architecture-evidence.jsonl";
export declare const ARCHITECTURE_EVIDENCE_MANIFEST_FILE = "architecture-evidence.manifest.json";
/** Identity of the whole projection: the reader plus the selection profile. */
export declare const ARCHITECTURE_EVIDENCE_PROFILE_ID = "meta-injector-architecture-evidence";
export declare const ARCHITECTURE_EVIDENCE_PROFILE_VERSION = "1.2.0";
/** The one selection profile this release ships. A view over the records, not a vocabulary. */
export declare const ARCHITECTURE_SELECTION_PROFILE_ID = "architecture-development/v2";
/** Moves whenever a role, a rule, a vocabulary or the declaration grammar changes. */
export declare const ARCHITECTURE_SELECTION_POLICY_VERSION = "2.0.0";
/** What every record is, epistemically. Stated on each one so no reader has to remember. */
export declare const ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS = "source-declared";
export declare const ARCHITECTURE_EVIDENCE_STATEMENT: string;
/**
 * The roles the selection profile recognizes, each from explicit evidence only.
 *
 * `decision_record`     — a declared `decision` kind, a decision-record status
 *                         declaration (`## Status` → `Accepted.`, `Status: Proposed`),
 *                         or a title that opens with an `ADR-NNN` identifier.
 * `development_handoff` — a declared checklist kind, or the document carries the
 *                         task, blocker or dependency declarations a handoff is
 *                         made of.
 * `historical_record`   — a declared retired status (`archived`, `cancelled`,
 *                         `superseded`, `deprecated`, `rejected`) or a declared
 *                         successor (`work.superseded_by`).
 * `research`            — a declared `research` kind.
 * `specification`       — a declared `specification` kind.
 * `wip_proposal`        — a declared kind in the proposal family, or a declared
 *                         status that says the work is not finished (`proposed`
 *                         included).
 * `unknown`             — none of the above was declared.
 *
 * Roles overlap: a proposed ADR is a decision record and a WIP proposal; a
 * superseded ADR is a decision record and a historical record. The classes it
 * selects are the union of its roles'.
 */
export declare const ARCHITECTURE_DOCUMENT_ROLES: readonly ["decision_record", "development_handoff", "historical_record", "research", "specification", "unknown", "wip_proposal"];
export type ArchitectureDocumentRole = (typeof ARCHITECTURE_DOCUMENT_ROLES)[number];
/**
 * The status vocabulary a decision record declares about itself. Closed; read
 * only from a `## Status` section's first item or a `Status:` label, never from
 * prose. `superseded` read from a `Status:` label is already a `work.status`
 * assertion and is not read twice.
 */
export declare const DECISION_RECORD_STATUSES: readonly ["accepted", "deprecated", "proposed", "rejected", "superseded"];
/** Predicates of the declarations this selection reads from blocks itself. */
export declare const DOCUMENT_DECLARATION_PREDICATES: readonly ["document.declared_status", "document.decision_record_title"];
/** The selection policy, as the data its hash is taken over. */
export declare function architectureSelectionPolicy(): Record<string, unknown>;
/** Hash of the selection policy alone, reported in the manifest. */
export declare function architectureSelectionPolicyHash(): string;
/**
 * Hash of the rules this projection applies: the reader's grammar and vocabulary,
 * the selection policy, and the record contract. Bound into the analysis identity
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
/**
 * A status or type the document declared about itself, read by this selection
 * from a block. `declaration_id` is stable across runs and output locations;
 * `block_id` and `structured_locator` say where the declaration was made.
 */
export interface DocumentDeclarationRef {
    predicate: string;
    object: string;
    declaration_id: string;
    block_id: string;
    structured_locator: Record<string, unknown>;
}
/**
 * Why a role was assigned: one example per predicate that established it, with
 * the count. `source` says whether the example is an existing work assertion
 * (resolvable by `assertion_id` in the root's packet) or a declaration this
 * selection read from a block (resolvable by `block_id` and `structured_locator`).
 */
export interface RoleEvidence extends WorkEvidenceRef {
    role: ArchitectureDocumentRole;
    /** How many assertions or declarations of this predicate and rule the document carries. */
    count: number;
    source: "work_assertion" | "document_declaration";
    block_id: string | null;
    structured_locator: Record<string, unknown> | null;
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
    /**
     * Blocks after `block_id` the statement continues into (a Markdown list item's
     * lazy continuation lines), in order. Empty for a one-block statement.
     */
    continuation_block_ids: string[];
    /**
     * The exact coordinate, in the format's own terms. Its `kind` says which shape.
     * A `line_span` starts on the statement's first line and ends on its last.
     */
    structured_locator: Record<string, unknown>;
    /** Line of the block's text the statement is on, or null for a whole-block statement. */
    unit_index: number | null;
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
        /** Statuses and types the document declared that this selection read from its blocks. */
        declarations: DocumentDeclarationRef[];
    };
    selection: {
        profile_id: string;
        policy_version: string;
        roles: ArchitectureDocumentRole[];
        role_evidence: RoleEvidence[];
        /**
         * The status families the document's declared statuses fall in. More than one
         * of `in_progress`, `settled`, `retired` is a contradiction the document made;
         * it is reported here and resolved nowhere.
         */
        status_families: string[];
        status_conflict: boolean;
        selected: boolean;
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
    selection_policy_version: string;
    selection_policy_hash: string;
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
/**
 * The statuses and types a document declares about itself in its blocks.
 *
 * Three explicit forms, nothing else: the first paragraph or list item under a
 * heading labelled `Status` (`## Status` then `Accepted.`), whose first word is a
 * decision-record status; a `Status:` labelled line whose value's first word is a
 * decision-record status the work reader does not already read; and a title that
 * opens with an `ADR-NNN` identifier. Code blocks are never read.
 */
export declare function readDocumentDeclarations(artifactId: string, blocks: readonly DocumentBlockView[]): DocumentDeclarationRef[];
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
