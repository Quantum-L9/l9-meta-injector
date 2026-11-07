// corpus_architecture_evidence.ts — the architectural statements a corpus declares,
// as a queryable payload with a receipt.
//
// `document-work-signals.jsonl` answers "what state does each document say it is
// in". It does not answer "what did this design document actually say it was
// bound by", and a person holding a hundred plans cannot grep their way to the
// answer either: the constraints are in prose, under headings that differ by
// author, in formats that differ by decade. This module writes them down.
//
// Three rules shape it, and all three are inherited rather than new.
//
// It reads the normalized blocks the scan already holds (ADR-043), so it never
// opens a file, never reads a byte the decoders did not, and cites the coordinate
// each format has. A Markdown statement cites its line; a Word statement cites
// its block; neither borrows the other's coordinate system.
//
// It is opt-in, and its identity lives in the analysis half of the corpus
// identity (ADR-041): selecting it moves `corpus_analysis_id` and nothing else.
// The source snapshot, the per-root packets, the interpretation cache and the
// work-signal payload are untouched by its presence, because none of them is a
// function of whether this projection was asked for.
//
// It is complete and it is a payload: one JSONL line per statement, never
// sampled, with a manifest stating the count and hashing the bytes two ways —
// exactly the contract `corpus_work_signal_export.ts` already keeps, so a consumer
// that can verify one can verify the other.
//
// What the selection profile adds is a *view*, not a filter. Every statement a
// document declares is emitted. The profile reads the document's own declared
// `work.kind`, `work.status` and handoff evidence, decides which statement
// classes a reader of that kind of document is looking for, and marks each record
// selected or not — with the rule and the evidence that decided it. A document
// whose role is undeclared has every class selected, because an unknown role is
// not a reason to hide what the document said.
import { canonicalCorpusJson } from "./corpus_analysis";
import type { DocumentBlockView } from "./extractors/document_blocks";
import {
  ARCHITECTURE_STATEMENT_CLASSES,
  ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
  ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION,
  ArchitectureCoverageDiagnostic,
  ArchitectureRecognitionForm,
  ArchitectureStatementClass,
  architectureStatementLocator,
  architectureStatementRules,
  readArchitectureStatements,
} from "./extractors/architecture_statements";
import { compareCodePoints } from "./ordering";
import { semanticHash, sha256TextPrefixed, stableId } from "./repository_model";

/** Schema of the complete payload. One record per line. */
export const ARCHITECTURE_EVIDENCE_SCHEMA = "l9.architecture-evidence/v1";
/** Schema of the payload's completeness and integrity receipt. */
export const ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA = "l9.architecture-evidence-manifest/v1";

/** Where the payload and its manifest are written inside a generation. */
export const ARCHITECTURE_EVIDENCE_PAYLOAD_FILE = "architecture-evidence.jsonl";
export const ARCHITECTURE_EVIDENCE_MANIFEST_FILE = "architecture-evidence.manifest.json";

/** Identity of the whole projection: the reader plus the selection profile. */
export const ARCHITECTURE_EVIDENCE_PROFILE_ID = "meta-injector-architecture-evidence";
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
export const ARCHITECTURE_EVIDENCE_PROFILE_VERSION = "1.3.0";

/** The one selection profile this release ships. A view over the records, not a vocabulary. */
export const ARCHITECTURE_SELECTION_PROFILE_ID = "architecture-development/v2";

/** What every record is, epistemically. Stated on each one so no reader has to remember. */
export const ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS = "source-declared";
export const ARCHITECTURE_EVIDENCE_STATEMENT =
  "Every record is a statement a document explicitly declared about itself, read from a "
  + "labelled field, a labelled list or a labelled section at the cited coordinate. None is "
  + "verified architecture: a decision_statement is a document recording a decision, not an "
  + "accepted ADR, an authoritative contract or an approved implementation. Contradictory "
  + "declarations are all retained. The selection profile marks which classes a reader of "
  + "this kind of document is looking for; it removes nothing.";

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
export const ARCHITECTURE_DOCUMENT_ROLES = [
  "development_handoff",
  "research_notes",
  "specification",
  "unknown",
  "wip_proposal",
] as const;

export type ArchitectureDocumentRole = (typeof ARCHITECTURE_DOCUMENT_ROLES)[number];

interface RoleRule {
  role: Exclude<ArchitectureDocumentRole, "unknown">;
  kinds: readonly string[];
  statuses: readonly string[];
  predicates: readonly string[];
  classes: readonly ArchitectureStatementClass[];
}

/**
 * The selection table. Static, closed, and part of the profile hash.
 *
 * Deliberately not a weighting: a class is selected for a role or it is not,
 * and the reason a record carries names the rule and the evidence. A document
 * matching no rule selects every class.
 */
const ROLE_RULES: readonly RoleRule[] = [
  {
    role: "wip_proposal",
    kinds: ["design", "plan", "proposal", "roadmap"],
    statuses: ["draft", "planned", "wip"],
    predicates: [],
    classes: ["assumption", "constraint", "decision_statement", "intent", "open_question"],
  },
  {
    role: "specification",
    kinds: ["decision", "specification"],
    statuses: [],
    predicates: [],
    classes: ["constraint", "decision_statement"],
  },
  {
    role: "development_handoff",
    kinds: ["checklist"],
    statuses: [],
    predicates: ["work.blocked_by", "work.depends_on", "work.task.completed", "work.task.open"],
    classes: ["constraint", "open_question"],
  },
  {
    // Deliberately high-recall: research and notes are read for everything they
    // declare. Weighing those classes by what a run is for is not this table's job.
    role: "research_notes",
    kinds: ["notes", "research"],
    statuses: [],
    predicates: [],
    classes: ["assumption", "constraint", "decision_statement", "intent", "open_question"],
  },
];

/** What the unknown role says about itself: a fallback, never a reading of evidence. */
export const UNKNOWN_ROLE_EXPLANATION =
  "no supported document-role rule matched the available source declarations; "
  + "all observed architectural classes remain selected to preserve recall";

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

export const SELECTION_POLICY_STATEMENT =
  "A role is a retrieval-selection reading of what the document declared about itself "
  + "(work.kind, work.status and handoff predicates), cited by assertion id; it is not a "
  + "lifecycle judgement, and a declared status such as archived stays a separate axis. "
  + "Roles overlap with no priority among them; a statement's selection is the union of its "
  + "roles' selected classes and selected_for_roles names exactly the roles whose rule "
  + "selected it. A document matching no rule is unknown and selects every class. No role "
  + "is a verdict that a declaration is true, accepted or authoritative today.";

/** The selection policy this profile applies, for the manifest and the docs. */
export function architectureSelectionPolicy(): SelectionPolicy {
  return {
    profile_id: ARCHITECTURE_SELECTION_PROFILE_ID,
    rules: ROLE_RULES.map((rule) => ({
      role: rule.role,
      kinds: [...rule.kinds],
      statuses: [...rule.statuses],
      predicates: [...rule.predicates],
      classes: [...rule.classes],
    })),
    unknown_role_selects: [...ARCHITECTURE_STATEMENT_CLASSES],
    statement: SELECTION_POLICY_STATEMENT,
  };
}

/** Existing work predicates a handoff is made of, counted on every record's document. */
const HANDOFF_PREDICATES: readonly string[] = [
  "work.blocked_by",
  "work.depends_on",
  "work.references",
  "work.task.completed",
  "work.task.open",
];

/** Existing predicates that say whether a document still applies. */
const APPLICABILITY_PREDICATES: readonly string[] = [
  "work.status",
  "work.superseded_by",
  "work.supersedes",
];

/**
 * Hash of the rules this projection applies: the reader's grammar and vocabulary,
 * the selection table, and the record contract. Bound into the analysis identity
 * when the projection is selected, and nowhere when it is not.
 */
export function architectureEvidenceProfileHash(): string {
  return semanticHash({
    id: ARCHITECTURE_EVIDENCE_PROFILE_ID,
    version: ARCHITECTURE_EVIDENCE_PROFILE_VERSION,
    schema: ARCHITECTURE_EVIDENCE_SCHEMA,
    reader: architectureStatementRules(),
    selection: {
      profile_id: ARCHITECTURE_SELECTION_PROFILE_ID,
      roles: ROLE_RULES.map((rule) => ({
        role: rule.role,
        kinds: [...rule.kinds],
        statuses: [...rule.statuses],
        predicates: [...rule.predicates],
        classes: [...rule.classes],
      })),
      unknown_role_selects: [...ARCHITECTURE_STATEMENT_CLASSES],
      role_vocabulary: [...ARCHITECTURE_DOCUMENT_ROLES],
      handoff_predicates: [...HANDOFF_PREDICATES],
      applicability_predicates: [...APPLICABILITY_PREDICATES],
    },
    epistemic_class: ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS,
    ordering: "code-point",
  });
}

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
  recognition: { form: ArchitectureRecognitionForm; label: string };
  /** What the document already declared about itself, by existing assertion id. */
  work_context: {
    kinds: WorkEvidenceRef[];
    statuses: WorkEvidenceRef[];
    /** `work.status`, `work.supersedes`, `work.superseded_by`: whether the document still applies. */
    applicability: WorkEvidenceRef[];
    /** Tasks, blockers, dependencies and references the document carries, counted. */
    handoff: { predicate: string; count: number }[];
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
  by_class: { statement_class: string; record_count: number; selected_count: number }[];
  by_format: { format: string; document_count: number; record_count: number }[];
  by_role: { role: string; document_count: number }[];
  by_recognition_form: { form: string; record_count: number }[];
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

/** Total order over records. `evidence_id` last makes it total. */
function compareRecords(left: ArchitectureEvidenceRecord, right: ArchitectureEvidenceRecord): number {
  return (
    compareCodePoints(left.artifact_id, right.artifact_id)
    || compareCodePoints(left.block_id, right.block_id)
    || (left.unit_index ?? -1) - (right.unit_index ?? -1)
    || compareCodePoints(left.statement_class, right.statement_class)
    || compareCodePoints(left.declared_text, right.declared_text)
    || compareCodePoints(left.evidence_id, right.evidence_id)
  );
}

function compareRefs(left: WorkEvidenceRef, right: WorkEvidenceRef): number {
  return (
    compareCodePoints(left.predicate, right.predicate)
    || compareCodePoints(left.object, right.object)
    || compareCodePoints(left.assertion_id, right.assertion_id)
  );
}

/** Assertions of one predicate, as refs, in a fixed order. */
function refsFor(assertions: readonly ExistingWorkAssertion[], predicate: string): WorkEvidenceRef[] {
  return assertions
    .filter((assertion) => assertion.predicate === predicate)
    .map((assertion) => ({
      predicate: assertion.predicate,
      object: assertion.object,
      assertion_id: assertion.assertion_id,
    }))
    .sort(compareRefs);
}

/** The lowest-ordered ref for a predicate, as the one example a role cites. */
function exampleRef(assertions: readonly ExistingWorkAssertion[], predicate: string): WorkEvidenceRef | undefined {
  return refsFor(assertions, predicate)[0];
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
export function selectForDocument(assertions: readonly ExistingWorkAssertion[]): DocumentSelection {
  const roles: ArchitectureDocumentRole[] = [];
  const roleEvidence: RoleEvidence[] = [];
  const reasonsByClass = new Map<ArchitectureStatementClass, string[]>();
  const rolesByClass = new Map<ArchitectureStatementClass, ArchitectureDocumentRole[]>();
  const kinds = refsFor(assertions, "work.kind");
  const statuses = refsFor(assertions, "work.status");

  for (const rule of ROLE_RULES) {
    const evidence: RoleEvidence[] = [];
    const matchedKinds = kinds.filter((ref) => rule.kinds.includes(ref.object));
    const matchedStatuses = statuses.filter((ref) => rule.statuses.includes(ref.object));
    if (matchedKinds.length > 0) {
      const first = matchedKinds[0] as WorkEvidenceRef;
      evidence.push({ role: rule.role, ...first, count: matchedKinds.length });
    }
    if (matchedStatuses.length > 0) {
      const first = matchedStatuses[0] as WorkEvidenceRef;
      evidence.push({ role: rule.role, ...first, count: matchedStatuses.length });
    }
    for (const predicate of rule.predicates) {
      const example = exampleRef(assertions, predicate);
      if (example === undefined) continue;
      evidence.push({
        role: rule.role,
        ...example,
        count: assertions.filter((assertion) => assertion.predicate === predicate).length,
      });
    }
    if (evidence.length === 0) continue;
    roles.push(rule.role);
    roleEvidence.push(...evidence);
    const because = evidence
      .map((item) => `${item.predicate}=${item.object} (${item.assertion_id})`)
      .join(", ");
    for (const statementClass of rule.classes) {
      const reasons = reasonsByClass.get(statementClass) ?? [];
      reasons.push(`${rule.role} selects ${statementClass}: ${because}`);
      reasonsByClass.set(statementClass, reasons);
      const selecting = rolesByClass.get(statementClass) ?? [];
      selecting.push(rule.role);
      rolesByClass.set(statementClass, selecting);
    }
  }

  if (roles.length === 0) {
    roles.push("unknown");
    for (const statementClass of ARCHITECTURE_STATEMENT_CLASSES) {
      reasonsByClass.set(statementClass, [`unknown selects ${statementClass}: ${UNKNOWN_ROLE_EXPLANATION}`]);
      rolesByClass.set(statementClass, ["unknown"]);
    }
  }

  roles.sort(compareCodePoints);
  roleEvidence.sort(
    (a, b) => compareCodePoints(a.role, b.role) || compareRefs(a, b),
  );
  for (const selecting of rolesByClass.values()) selecting.sort(compareCodePoints);
  return { roles, roleEvidence, reasonsByClass, rolesByClass };
}

/** One record, canonically rendered onto a single line. */
export function renderArchitectureEvidenceRecord(record: ArchitectureEvidenceRecord): string {
  return canonicalCorpusJson(record, 0);
}

function tallyClasses(records: readonly ArchitectureEvidenceRecord[]): ArchitectureEvidenceManifest["by_class"] {
  return ARCHITECTURE_STATEMENT_CLASSES.map((statementClass) => {
    const matching = records.filter((record) => record.statement_class === statementClass);
    return {
      statement_class: statementClass,
      record_count: matching.length,
      selected_count: matching.filter((record) => record.selection.selected).length,
    };
  });
}

function tallyFormats(records: readonly ArchitectureEvidenceRecord[]): ArchitectureEvidenceManifest["by_format"] {
  const byFormat = new Map<string, { records: number; documents: Set<string> }>();
  for (const record of records) {
    const entry = byFormat.get(record.format) ?? { records: 0, documents: new Set<string>() };
    entry.records += 1;
    entry.documents.add(record.artifact_id);
    byFormat.set(record.format, entry);
  }
  return [...byFormat.entries()]
    .map(([format, entry]) => ({ format, document_count: entry.documents.size, record_count: entry.records }))
    .sort((a, b) => compareCodePoints(a.format, b.format));
}

function tallyRoles(records: readonly ArchitectureEvidenceRecord[]): ArchitectureEvidenceManifest["by_role"] {
  const byRole = new Map<string, Set<string>>();
  for (const record of records) {
    for (const role of record.selection.roles) {
      const documents = byRole.get(role) ?? new Set<string>();
      documents.add(record.artifact_id);
      byRole.set(role, documents);
    }
  }
  return [...byRole.entries()]
    .map(([role, documents]) => ({ role, document_count: documents.size }))
    .sort((a, b) => compareCodePoints(a.role, b.role));
}

function tallyForms(records: readonly ArchitectureEvidenceRecord[]): ArchitectureEvidenceManifest["by_recognition_form"] {
  const byForm = new Map<string, number>();
  for (const record of records) {
    byForm.set(record.recognition.form, (byForm.get(record.recognition.form) ?? 0) + 1);
  }
  return [...byForm.entries()]
    .map(([form, record_count]) => ({ form, record_count }))
    .sort((a, b) => compareCodePoints(a.form, b.form));
}

function compareDiagnostics(
  left: ArchitectureEvidenceDiagnosticRecord,
  right: ArchitectureEvidenceDiagnosticRecord,
): number {
  return (
    compareCodePoints(left.artifact_id, right.artifact_id)
    || compareCodePoints(left.block_id, right.block_id)
    || compareCodePoints(left.code, right.code)
    || compareCodePoints(left.message, right.message)
  );
}

/**
 * Build the complete payload and its manifest from the documents a scan holds.
 *
 * Refuses a duplicate `evidence_id` rather than collapsing it, for the reason the
 * work-signal export gives: two records under one id are a defect in the identity
 * formula or in the reader, and a payload that deduplicated them would report a
 * count nobody could reconcile.
 */
export function buildArchitectureEvidenceExport(
  input: BuildArchitectureEvidenceInput,
): ArchitectureEvidenceExport {
  const records: ArchitectureEvidenceRecord[] = [];
  const diagnostics: ArchitectureEvidenceDiagnosticRecord[] = [];
  let diagnosticsOmitted = 0;

  for (const document of input.documents) {
    const reading = readArchitectureStatements(document.blocks);
    for (const diagnostic of reading.diagnostics) {
      diagnostics.push({ ...diagnostic, artifact_id: document.artifactId, source_path: document.sourcePath });
    }
    diagnosticsOmitted += reading.diagnostics_omitted;
    if (reading.statements.length === 0) continue;

    const selection = selectForDocument(document.workAssertions);
    const workContext: ArchitectureEvidenceRecord["work_context"] = {
      kinds: refsFor(document.workAssertions, "work.kind"),
      statuses: refsFor(document.workAssertions, "work.status"),
      applicability: APPLICABILITY_PREDICATES.flatMap((predicate) => refsFor(document.workAssertions, predicate)),
      handoff: HANDOFF_PREDICATES
        .map((predicate) => ({
          predicate,
          count: document.workAssertions.filter((assertion) => assertion.predicate === predicate).length,
        }))
        .filter((entry) => entry.count > 0),
    };

    for (const statement of reading.statements) {
      const reasons = selection.reasonsByClass.get(statement.statement_class) ?? [];
      const selectedForRoles = selection.rolesByClass.get(statement.statement_class) ?? [];
      const identity = {
        artifact_id: document.artifactId,
        block_id: statement.block.block_id,
        declared_text: statement.declared_text,
        extractor_id: ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
        recognition_form: statement.recognition.form,
        statement_class: statement.statement_class,
        unit_index: statement.unit_index,
      };
      records.push({
        evidence_id: stableId("architecture_evidence", identity),
        artifact_id: document.artifactId,
        rmp_artifact_id: document.rmpArtifactId,
        source_path: document.sourcePath,
        format: document.format,
        raw_content_hash: document.rawContentHash,
        normalized_document_id: document.normalizedDocumentId,
        decoder_id: document.decoderId,
        decoder_version: document.decoderVersion,
        block_id: statement.block.block_id,
        block_kind: statement.block.kind,
        structured_locator: architectureStatementLocator(statement.block, statement.unit_index, statement.unit_count) as unknown as Record<string, unknown>,
        unit_index: statement.unit_index,
        unit_count: statement.unit_count,
        statement_class: statement.statement_class,
        declared_text: statement.declared_text,
        declared_text_truncated: statement.declared_text_truncated,
        bounded_excerpt: statement.bounded_excerpt,
        recognition: { ...statement.recognition },
        work_context: workContext,
        selection: {
          profile_id: ARCHITECTURE_SELECTION_PROFILE_ID,
          roles: [...selection.roles],
          role_evidence: selection.roleEvidence.map((item) => ({ ...item })),
          selected: selectedForRoles.length > 0,
          selected_for_roles: [...selectedForRoles],
          reasons: [...reasons],
        },
        epistemic_class: ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS,
        authority_verified: false,
        extractor_id: ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
        extractor_version: ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION,
        profile_version: ARCHITECTURE_EVIDENCE_PROFILE_VERSION,
      });
    }
  }

  records.sort(compareRecords);
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.evidence_id)) {
      throw new Error(
        `architecture-evidence: duplicate evidence_id ${record.evidence_id} `
        + `(${record.source_path} ${record.statement_class}); the payload must carry each statement once`,
      );
    }
    seen.add(record.evidence_id);
  }
  diagnostics.sort(compareDiagnostics);

  const payloadJsonl = records.map((record) => `${renderArchitectureEvidenceRecord(record)}\n`).join("");
  const manifest: ArchitectureEvidenceManifest = {
    schema: ARCHITECTURE_EVIDENCE_MANIFEST_SCHEMA,
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    profile_id: ARCHITECTURE_EVIDENCE_PROFILE_ID,
    profile_version: ARCHITECTURE_EVIDENCE_PROFILE_VERSION,
    profile_hash: architectureEvidenceProfileHash(),
    extractor_id: ARCHITECTURE_STATEMENT_EXTRACTOR_ID,
    extractor_version: ARCHITECTURE_STATEMENT_EXTRACTOR_VERSION,
    selection_profile_id: ARCHITECTURE_SELECTION_PROFILE_ID,
    selection_policy: architectureSelectionPolicy(),
    payload_file: ARCHITECTURE_EVIDENCE_PAYLOAD_FILE,
    record_count: records.length,
    selected_record_count: records.filter((record) => record.selection.selected).length,
    document_count: new Set(records.map((record) => record.artifact_id)).size,
    documents_read: input.documents.length,
    by_class: tallyClasses(records),
    by_format: tallyFormats(records),
    by_role: tallyRoles(records),
    by_recognition_form: tallyForms(records),
    diagnostics,
    diagnostic_count: diagnostics.length,
    diagnostics_omitted: diagnosticsOmitted,
    payload_byte_length: Buffer.byteLength(payloadJsonl, "utf8"),
    payload_artifact_hash: sha256TextPrefixed(payloadJsonl),
    payload_semantic_hash: sha256TextPrefixed(
      canonicalCorpusJson({ schema: ARCHITECTURE_EVIDENCE_SCHEMA, records }, 0),
    ),
    epistemic_class: ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS,
    statement: ARCHITECTURE_EVIDENCE_STATEMENT,
  };

  return {
    records,
    manifest,
    payloadJsonl,
    manifestJson: `${canonicalCorpusJson(manifest)}\n`,
  };
}

/** The snapshot-sized reference to a payload. */
export function architectureEvidenceRef(manifest: ArchitectureEvidenceManifest): ArchitectureEvidenceRef {
  return {
    schema: ARCHITECTURE_EVIDENCE_SCHEMA,
    manifest_ref: ARCHITECTURE_EVIDENCE_MANIFEST_FILE,
    payload_ref: manifest.payload_file,
    record_count: manifest.record_count,
    payload_semantic_hash: manifest.payload_semantic_hash,
    payload_artifact_hash: manifest.payload_artifact_hash,
  };
}

export interface VerifyArchitectureEvidenceExportInput {
  manifest: ArchitectureEvidenceManifest;
  /** The payload exactly as it was written or read back. */
  payloadJsonl: string;
  /** Artifact ids the corpus observed. A record naming anything else is dangling. */
  knownArtifactIds: ReadonlySet<string>;
  /** Normalized document ids the corpus produced. */
  knownNormalizedDocumentIds: ReadonlySet<string>;
}

function readPayloadRecords(
  payloadJsonl: string,
): { records: ArchitectureEvidenceRecord[]; problems: string[] } {
  const problems: string[] = [];
  const lines = payloadJsonl.length === 0 ? [] : payloadJsonl.split("\n");
  if (payloadJsonl.length > 0 && lines[lines.length - 1] !== "") {
    problems.push("payload does not end with a newline");
  }
  const bodies = lines.filter((line, index) => !(index === lines.length - 1 && line === ""));
  const records: ArchitectureEvidenceRecord[] = [];
  for (const [index, line] of bodies.entries()) {
    if (line.length === 0) {
      problems.push(`payload line ${index + 1} is empty`);
      continue;
    }
    try {
      records.push(JSON.parse(line) as ArchitectureEvidenceRecord);
    } catch (error) {
      problems.push(`payload line ${index + 1} is not valid JSON: ${(error as Error).message}`);
    }
  }
  return { records, problems };
}

/**
 * The per-role selection invariants of one record (profile 1.3.0 and later).
 *
 * A payload written before 1.3.0 recorded only `selected`; its records carry no
 * `selected_for_roles` and are not faulted for that. A record that carries the
 * field, from any profile, must satisfy every invariant: no duplicates, code-point
 * order, every member a matched role whose rule selects this class, `selected`
 * true exactly when non-empty, a reason naming each selecting role, source-backed
 * evidence for every non-unknown role, and the stated fallback for unknown.
 */
function verifyRoleSelection(record: ArchitectureEvidenceRecord, profileVersion: string): string[] {
  const problems: string[] = [];
  const selection = record.selection;
  const id = record.evidence_id;
  if (selection === undefined || !Array.isArray(selection.roles)) {
    return [`record ${id} carries no selection`];
  }
  const selectedFor = selection.selected_for_roles;
  if (selectedFor === undefined) {
    if (profileVersion === ARCHITECTURE_EVIDENCE_PROFILE_VERSION) {
      problems.push(`record ${id} carries no selected_for_roles under profile ${profileVersion}`);
    }
    return problems;
  }
  if (!Array.isArray(selectedFor)) return [`record ${id} selected_for_roles is not a list`];
  const sorted = [...selectedFor].sort(compareCodePoints);
  if (sorted.some((role, index) => role !== selectedFor[index])) {
    problems.push(`record ${id} selected_for_roles is not in code-point order`);
  }
  if (new Set(selectedFor).size !== selectedFor.length) {
    problems.push(`record ${id} selected_for_roles carries a duplicate`);
  }
  if (selection.selected !== (selectedFor.length > 0)) {
    problems.push(`record ${id} is marked selected=${String(selection.selected)} but selected_for_roles has ${selectedFor.length} member(s)`);
  }
  for (const role of selectedFor) {
    if (!(ARCHITECTURE_DOCUMENT_ROLES as readonly string[]).includes(role)) {
      problems.push(`record ${id} selected_for_roles names '${String(role)}', which is not a role`);
      continue;
    }
    if (!selection.roles.includes(role)) {
      problems.push(`record ${id} is selected for ${role}, a role its document was not filed under`);
    }
    const rule = ROLE_RULES.find((candidate) => candidate.role === role);
    const classes = rule === undefined && role === "unknown" ? ARCHITECTURE_STATEMENT_CLASSES : rule?.classes ?? [];
    if (!classes.includes(record.statement_class)) {
      problems.push(`record ${id} is selected for ${role}, whose rule does not select ${record.statement_class}`);
    }
    if (!selection.reasons.some((reason) => reason.startsWith(`${role} selects ${record.statement_class}:`))) {
      problems.push(`record ${id} is selected for ${role} without a reason naming it`);
    }
  }
  for (const role of selection.roles) {
    const evidence = selection.role_evidence.filter((item) => item.role === role);
    if (role === "unknown") {
      if (selection.role_evidence.length > 0) problems.push(`record ${id} claims source evidence for the unknown role`);
      if (selection.roles.length !== 1) problems.push(`record ${id} files unknown beside a matched role`);
      if (!selection.reasons.every((reason) => reason.includes(UNKNOWN_ROLE_EXPLANATION))) {
        problems.push(`record ${id} has an unknown role without the fallback explanation`);
      }
    } else if (evidence.length === 0) {
      problems.push(`record ${id} files its document under ${role} with no source evidence`);
    }
  }
  return problems;
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
export function verifyArchitectureEvidenceExport(
  input: VerifyArchitectureEvidenceExportInput,
): string[] {
  const { manifest, payloadJsonl } = input;
  const { records, problems } = readPayloadRecords(payloadJsonl);

  if (records.length !== manifest.record_count) {
    problems.push(`manifest says ${manifest.record_count} record(s) and the payload carries ${records.length}`);
  }
  const byteLength = Buffer.byteLength(payloadJsonl, "utf8");
  if (byteLength !== manifest.payload_byte_length) {
    problems.push(`manifest says ${manifest.payload_byte_length} byte(s) and the payload is ${byteLength}`);
  }
  const artifactHash = sha256TextPrefixed(payloadJsonl);
  if (artifactHash !== manifest.payload_artifact_hash) {
    problems.push(`payload artifact hash ${artifactHash} does not match the manifest's ${manifest.payload_artifact_hash}`);
  }
  if (records.length === manifest.record_count) {
    const semanticHashValue = sha256TextPrefixed(
      canonicalCorpusJson({ schema: ARCHITECTURE_EVIDENCE_SCHEMA, records }, 0),
    );
    if (semanticHashValue !== manifest.payload_semantic_hash) {
      problems.push(`payload semantic hash ${semanticHashValue} does not match the manifest's ${manifest.payload_semantic_hash}`);
    }
    const selected = records.filter((record) => record.selection?.selected === true).length;
    if (selected !== manifest.selected_record_count) {
      problems.push(`manifest selected_record_count is ${manifest.selected_record_count} and the payload marks ${selected} selected`);
    }
    const documentCount = new Set(records.map((record) => record.artifact_id)).size;
    if (documentCount !== manifest.document_count) {
      problems.push(`manifest document_count is ${manifest.document_count} and the payload records name ${documentCount} distinct artifact(s)`);
    }
    for (const [name, expected, actual] of [
      ["by_class", canonicalCorpusJson(tallyClasses(records), 0), canonicalCorpusJson(manifest.by_class, 0)],
      ["by_format", canonicalCorpusJson(tallyFormats(records), 0), canonicalCorpusJson(manifest.by_format, 0)],
      ["by_role", canonicalCorpusJson(tallyRoles(records), 0), canonicalCorpusJson(manifest.by_role, 0)],
      ["by_recognition_form", canonicalCorpusJson(tallyForms(records), 0), canonicalCorpusJson(manifest.by_recognition_form, 0)],
    ] as const) {
      if (expected !== actual) problems.push(`manifest ${name} does not match the payload records: expected ${expected}`);
    }
  }

  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.evidence_id)) problems.push(`duplicate evidence_id ${record.evidence_id}`);
    seen.add(record.evidence_id);
    if (!input.knownArtifactIds.has(record.artifact_id)) {
      problems.push(`record ${record.evidence_id} names artifact ${record.artifact_id}, which this corpus did not observe`);
    }
    if (record.normalized_document_id !== null && !input.knownNormalizedDocumentIds.has(record.normalized_document_id)) {
      problems.push(`record ${record.evidence_id} names normalized document ${record.normalized_document_id}, which this corpus did not produce`);
    }
    if (record.epistemic_class !== ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS || record.authority_verified !== false) {
      problems.push(`record ${record.evidence_id} is not classed ${ARCHITECTURE_EVIDENCE_EPISTEMIC_CLASS} with authority_verified false`);
    }
    if (!(ARCHITECTURE_STATEMENT_CLASSES as readonly string[]).includes(record.statement_class)) {
      problems.push(`record ${record.evidence_id} carries statement_class '${String(record.statement_class)}', which is not in the vocabulary`);
    }
    problems.push(...verifyRoleSelection(record, manifest.profile_version));
  }
  if (manifest.diagnostic_count !== manifest.diagnostics.length) {
    problems.push(`manifest diagnostic_count is ${manifest.diagnostic_count} and it lists ${manifest.diagnostics.length}`);
  }
  const classTotal = manifest.by_class.reduce((sum, entry) => sum + entry.record_count, 0);
  if (classTotal !== manifest.record_count) {
    problems.push(`by_class totals ${classTotal} and the manifest states ${manifest.record_count}`);
  }
  return problems;
}
