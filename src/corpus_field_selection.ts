// corpus_field_selection.ts — which of a document's existing evidence fields a run
// asked for, and why: an opt-in, deterministic view over a local-source generation.
//
// A local-source run indexes everything: every statement a document declared
// (architecture evidence), every work signal (packet assertions and block
// signals), every duplicate relation. That completeness is the point, and it is
// also the problem a reader has — a handoff reader wants open tasks and blockers,
// an architecture reviewer wants decisions and constraints, an auditor wants the
// status and the supersession chain, and all of them want it bounded.
//
// This module decides, per document, which existing fields to surface for one
// declared run intent, and says why for every field it surfaced and every field it
// did not. It is a view, written as one more payload in the same generation:
//
//   - it selects among fields the generation already holds, cites each value by the
//     record id its own payload gave it, and copies nothing it cannot cite;
//   - it never removes, rewrites or re-ranks a source record, so the complete
//     index beside it is unchanged;
//   - it decides from closed tables — the run intent, the document's
//     source-declared roles (ADR-090), which fields actually carry a value,
//     whether a value is new to the view, and a stated output budget — and from
//     nothing else: no weights, no scores, no model, no rule language;
//   - its carrier is the external generation local-source always writes to; no
//     observed file is touched (ADR-036), and the in-repository carriers are
//     recorded as refused rather than silently unused.
//
// It is not a context assembler: it writes no prose, joins no documents, and
// resolves no authority. A selected `decision_statement` from a record that
// declared itself `Accepted` is still a source declaration.
import { canonicalCorpusJson } from "./corpus_analysis";
import type { ArchitectureDocumentRole, ArchitectureEvidenceRecord } from "./corpus_architecture_evidence";
import { ARCHITECTURE_STATEMENT_CLASSES } from "./extractors/architecture_statements";
import { MAX_EXCERPT_LENGTH, boundExcerpt } from "./interpretation";
import { compareCodePoints } from "./ordering";
import { semanticHash, sha256TextPrefixed, stableId } from "./repository_model";

export const FIELD_SELECTION_SCHEMA = "l9.local-source-field-selection/v1";
export const FIELD_SELECTION_MANIFEST_SCHEMA = "l9.local-source-field-selection-manifest/v1";
export const FIELD_SELECTION_PAYLOAD_FILE = "field-selection.jsonl";
export const FIELD_SELECTION_MANIFEST_FILE = "field-selection.manifest.json";

export const FIELD_SELECTION_POLICY_ID = "local-source-field-selection/v1";
/** Moves whenever a table, a rule or the record shape changes. */
export const FIELD_SELECTION_POLICY_VERSION = "1.0.0";

export const FIELD_SELECTION_STATEMENT =
  "A derived view over this generation's own evidence. Every selected value is an existing "
  + "record, cited by the id its payload gave it; nothing was removed from, rewritten in or "
  + "re-ranked within any payload. Selection follows the declared run intent, the document's "
  + "source-declared roles, which fields carry a value, whether a value is new to the view, and "
  + "the stated budget. Roles and statuses are what documents declared about themselves, not "
  + "verified authority. The view is written to the external generation only; no observed file "
  + "was modified.";

/** The run intents the policy knows. Closed. */
export const FIELD_SELECTION_INTENTS = [
  "architecture_review",
  "design_exploration",
  "development_handoff",
  "history_audit",
] as const;
export type FieldSelectionIntent = (typeof FIELD_SELECTION_INTENTS)[number];

/** Where a field's values come from. Each is a payload the generation already holds. */
export type FieldSource = "architecture_evidence" | "document_work_signals" | "repository_model_packet";

/**
 * The field vocabulary: every field is an existing evidence field. Statement
 * fields are architecture-evidence records by class; declaration fields are the
 * selection's block-read declarations; work fields are work-signal predicates,
 * from the packet's interpreted assertions or the block-signal payload.
 */
export const FIELD_SELECTION_FIELDS = [
  "declaration.decision_record_title",
  "declaration.declared_status",
  "document.heading",
  "document.title",
  "statement.assumption",
  "statement.constraint",
  "statement.decision_statement",
  "statement.intent",
  "statement.open_question",
  "work.blocked_by",
  "work.depends_on",
  "work.kind",
  "work.milestone",
  "work.references",
  "work.status",
  "work.superseded_by",
  "work.supersedes",
  "work.task.completed",
  "work.task.open",
] as const;
export type FieldSelectionField = (typeof FIELD_SELECTION_FIELDS)[number];

/** What happened to a field, for one document. Closed. */
export const FIELD_DISPOSITIONS = [
  "not_selected_for_intent",
  "omitted_by_budget",
  "redundant",
  "selected",
  "unavailable",
] as const;
export type FieldDisposition = (typeof FIELD_DISPOSITIONS)[number];

/** The intent table: the fields a reader with this intent asks for, core first. */
const INTENT_FIELDS: Readonly<Record<FieldSelectionIntent, { core: readonly FieldSelectionField[]; supporting: readonly FieldSelectionField[] }>> = {
  architecture_review: {
    core: ["statement.decision_statement", "statement.constraint", "declaration.declared_status"],
    supporting: ["statement.assumption", "statement.intent", "work.status", "work.superseded_by", "declaration.decision_record_title"],
  },
  design_exploration: {
    core: ["statement.intent", "statement.open_question", "statement.assumption"],
    supporting: ["statement.constraint", "work.references", "work.status", "statement.decision_statement"],
  },
  development_handoff: {
    core: ["work.task.open", "work.blocked_by", "statement.open_question", "statement.constraint"],
    supporting: ["work.depends_on", "work.status", "statement.decision_statement", "work.milestone"],
  },
  history_audit: {
    core: ["declaration.declared_status", "work.status", "work.superseded_by", "work.supersedes", "statement.decision_statement"],
    supporting: ["statement.intent", "document.title", "work.references"],
  },
};

/**
 * The role table: fields a source-declared role promotes to core, whatever the
 * intent. This is what makes the view adapt to the document: a historical record
 * surfaces its successor under any intent, a handoff its open tasks.
 */
const ROLE_PROMOTIONS: Readonly<Record<ArchitectureDocumentRole, readonly FieldSelectionField[]>> = {
  decision_record: ["statement.decision_statement", "declaration.declared_status"],
  development_handoff: ["work.task.open", "work.blocked_by", "work.depends_on"],
  historical_record: ["work.superseded_by", "declaration.declared_status", "work.status"],
  research: ["statement.assumption", "statement.open_question"],
  specification: ["statement.constraint"],
  unknown: [],
  wip_proposal: ["statement.open_question", "statement.assumption", "work.status"],
};

/** The output bound, per document. Part of the profile hash. */
export interface FieldSelectionBudget {
  maxFields: number;
  maxValuesPerField: number;
  maxCharacters: number;
}

export const DEFAULT_FIELD_SELECTION_BUDGET: Readonly<FieldSelectionBudget> = {
  maxFields: 6,
  maxValuesPerField: 5,
  maxCharacters: 2000,
};

/** Carriers this view can be written to, and what was decided for each. */
export const FIELD_SELECTION_CARRIER = {
  disposition: "external_generation",
  path: FIELD_SELECTION_PAYLOAD_FILE,
  observed_files_mutated: false,
  refused: [
    {
      carrier: "central_manifest",
      reason: "a central manifest is written into the observed repository; local-source never writes under an observed root (ADR-036)",
    },
    {
      carrier: "inline_managed",
      reason: "an inline carrier rewrites the observed file; local-source never modifies an observed file (ADR-036)",
    },
  ],
} as const;

/** Whether a budget is usable. A view nobody can bound is refused, not clamped. */
export function validateFieldSelectionBudget(budget: FieldSelectionBudget): string[] {
  const problems: string[] = [];
  for (const [name, value, min, max] of [
    ["maxFields", budget.maxFields, 1, FIELD_SELECTION_FIELDS.length],
    ["maxValuesPerField", budget.maxValuesPerField, 1, 100],
    ["maxCharacters", budget.maxCharacters, 1, 1_000_000],
  ] as const) {
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      problems.push(`${name} must be an integer in [${min}, ${max}], got ${String(value)}`);
    }
  }
  return problems;
}

/** The policy as the data its hash is taken over. */
export function fieldSelectionPolicy(): Record<string, unknown> {
  return {
    policy_id: FIELD_SELECTION_POLICY_ID,
    policy_version: FIELD_SELECTION_POLICY_VERSION,
    schema: FIELD_SELECTION_SCHEMA,
    fields: [...FIELD_SELECTION_FIELDS],
    dispositions: [...FIELD_DISPOSITIONS],
    intents: FIELD_SELECTION_INTENTS.map((intent) => [
      intent,
      { core: [...INTENT_FIELDS[intent].core], supporting: [...INTENT_FIELDS[intent].supporting] },
    ]),
    role_promotions: Object.keys(ROLE_PROMOTIONS)
      .sort(compareCodePoints)
      .map((role) => [role, [...ROLE_PROMOTIONS[role as ArchitectureDocumentRole]]]),
    order: "core (intent order, then role promotions in role order) > supporting > rest by field name",
    redundancy: {
      value_identity: "trimmed, lowercased, whitespace-collapsed text",
      exact_duplicate_non_representative: "every available field redundant with the cluster representative",
      near_duplicates: "reported, never suppressing (they are candidates, not facts)",
    },
    value_bound_characters: MAX_EXCERPT_LENGTH,
    carrier: FIELD_SELECTION_CARRIER,
  };
}

/** Hash of the policy alone. */
export function fieldSelectionPolicyHash(): string {
  return semanticHash(fieldSelectionPolicy());
}

/**
 * Hash of what a run selected under: the policy, the intent and the budget. Bound
 * into `corpus_analysis_id` as `field_selection_profile` when the view is
 * selected, so two runs with different intents or bounds never share an
 * analysis identity.
 */
export function fieldSelectionProfileHash(intent: FieldSelectionIntent, budget: FieldSelectionBudget): string {
  return semanticHash({
    policy_hash: fieldSelectionPolicyHash(),
    intent,
    budget: { max_fields: budget.maxFields, max_values_per_field: budget.maxValuesPerField, max_characters: budget.maxCharacters },
  });
}

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
  workValues: readonly { record_id: string; source: FieldSource; predicate: string; object: string }[];
  exactDuplicate: { clusterId: string; representativeArtifactId: string } | null;
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
  budget: { max_fields: number; max_values_per_field: number; max_characters: number };
  carrier: typeof FIELD_SELECTION_CARRIER;
  payload_file: string;
  /** Documents that carry any statement or work value: every one has a record. */
  record_count: number;
  selected_field_count: number;
  by_field: { field: string; selected: number; redundant: number; omitted_by_budget: number; unavailable: number; not_selected_for_intent: number }[];
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

function valueKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function locatorPosition(locator: Record<string, unknown>): number {
  const line = locator.line_start;
  if (typeof line === "number") return line;
  const block = locator.block_index;
  return typeof block === "number" ? block : -1;
}

/** Every value each field could surface for one document, in a fixed order. */
function candidatesFor(document: FieldSelectionDocumentInput): Map<FieldSelectionField, FieldValueCandidate[]> {
  const out = new Map<FieldSelectionField, FieldValueCandidate[]>();
  const add = (field: FieldSelectionField, candidate: FieldValueCandidate): void => {
    const list = out.get(field) ?? [];
    if (!list.some((existing) => existing.record_id === candidate.record_id)) list.push(candidate);
    out.set(field, list);
  };
  for (const record of document.architectureRecords) {
    add(`statement.${record.statement_class}` as FieldSelectionField, {
      record_id: record.evidence_id,
      source: "architecture_evidence",
      value: record.declared_text,
      position: locatorPosition(record.structured_locator),
    });
    for (const declaration of record.work_context.declarations ?? []) {
      const field = `declaration.${declaration.predicate.replace(/^document\./, "")}` as FieldSelectionField;
      if (!(FIELD_SELECTION_FIELDS as readonly string[]).includes(field)) continue;
      add(field, {
        record_id: declaration.declaration_id,
        source: "architecture_evidence",
        value: declaration.object,
        position: locatorPosition(declaration.structured_locator),
      });
    }
  }
  for (const work of document.workValues) {
    if (!(FIELD_SELECTION_FIELDS as readonly string[]).includes(work.predicate)) continue;
    add(work.predicate as FieldSelectionField, { record_id: work.record_id, source: work.source, value: work.object, position: -1 });
  }
  for (const list of out.values()) {
    list.sort((a, b) => a.position - b.position || compareCodePoints(a.value, b.value) || compareCodePoints(a.record_id, b.record_id));
  }
  return out;
}

/** The ordered candidate fields for an intent and a set of roles, with the rule that put each there. */
function plannedFields(
  intent: FieldSelectionIntent,
  roles: readonly ArchitectureDocumentRole[],
): { field: FieldSelectionField; tier: "core" | "supporting"; because: string[] }[] {
  const planned = new Map<FieldSelectionField, { tier: "core" | "supporting"; because: string[] }>();
  for (const field of INTENT_FIELDS[intent].core) {
    planned.set(field, { tier: "core", because: [`intent ${intent} asks for ${field} (core)`] });
  }
  for (const role of [...roles].sort(compareCodePoints)) {
    for (const field of ROLE_PROMOTIONS[role]) {
      const existing = planned.get(field);
      const reason = `declared role ${role} promotes ${field} to core`;
      if (existing === undefined) planned.set(field, { tier: "core", because: [reason] });
      else if (!existing.because.includes(reason)) existing.because.push(reason);
    }
  }
  for (const field of INTENT_FIELDS[intent].supporting) {
    if (!planned.has(field)) planned.set(field, { tier: "supporting", because: [`intent ${intent} asks for ${field} (supporting)`] });
  }
  return [...planned.entries()].map(([field, entry]) => ({ field, ...entry }));
}

/** Decide one document's view. Pure and total. */
export function selectFieldsForDocument(
  document: FieldSelectionDocumentInput,
  intent: FieldSelectionIntent,
  budget: FieldSelectionBudget,
): FieldSelectionRecord {
  const first = document.architectureRecords[0];
  const roles: ArchitectureDocumentRole[] = first !== undefined ? [...first.selection.roles] : ["unknown"];
  const roleEvidenceIds = first !== undefined
    ? [...new Set(first.selection.role_evidence.map((item) => item.assertion_id))].sort(compareCodePoints)
    : [];
  const candidates = candidatesFor(document);
  const planned = plannedFields(intent, roles);
  const decisions: FieldSelectionFieldDecision[] = [];
  const seen = new Set<string>();
  let characters = 0;
  let selectedFields = 0;

  const duplicate = document.exactDuplicate;
  const nonRepresentative = duplicate !== null && duplicate.representativeArtifactId !== document.artifactId;

  for (const { field, tier, because } of planned) {
    const available = candidates.get(field) ?? [];
    const decision: FieldSelectionFieldDecision = {
      field,
      tier,
      disposition: "unavailable",
      reasons: [...because],
      available_value_count: available.length,
      new_value_count: 0,
      selected_values: [],
      values_omitted: 0,
    };
    decisions.push(decision);
    if (available.length === 0) {
      decision.reasons.push(`the document declares no ${field}`);
      continue;
    }
    if (nonRepresentative) {
      decision.disposition = "redundant";
      decision.reasons.push(
        `the document is byte-identical to ${duplicate?.representativeArtifactId} (exact duplicate cluster ${duplicate?.clusterId}); its values are surfaced there`,
      );
      continue;
    }
    const fresh = available.filter((candidate) => !seen.has(valueKey(candidate.value)));
    const distinctFresh = fresh.filter(
      (candidate, index) => fresh.findIndex((other) => valueKey(other.value) === valueKey(candidate.value)) === index,
    );
    decision.new_value_count = distinctFresh.length;
    if (distinctFresh.length === 0) {
      decision.disposition = "redundant";
      decision.reasons.push(`every value of ${field} is already in this document's view under an earlier field`);
      continue;
    }
    if (selectedFields >= budget.maxFields) {
      decision.disposition = "omitted_by_budget";
      decision.values_omitted = distinctFresh.length;
      decision.reasons.push(`the view already holds ${budget.maxFields} field(s), the budget's maximum`);
      continue;
    }
    for (const candidate of distinctFresh) {
      if (decision.selected_values.length >= budget.maxValuesPerField) break;
      const value = boundExcerpt(candidate.value);
      if (characters + value.length > budget.maxCharacters) break;
      decision.selected_values.push({ record_id: candidate.record_id, source: candidate.source, value });
      characters += value.length;
      seen.add(valueKey(candidate.value));
    }
    decision.values_omitted = distinctFresh.length - decision.selected_values.length;
    if (decision.selected_values.length === 0) {
      decision.disposition = "omitted_by_budget";
      decision.reasons.push(`the view's ${budget.maxCharacters}-character budget has no room left for a ${field} value`);
      continue;
    }
    decision.disposition = "selected";
    selectedFields += 1;
    decision.reasons.push(
      `selected ${decision.selected_values.length} of ${distinctFresh.length} new value(s)`
      + (decision.values_omitted > 0 ? `; ${decision.values_omitted} left out by the budget (${budget.maxValuesPerField} per field, ${budget.maxCharacters} characters)` : ""),
    );
  }

  const plannedSet = new Set(planned.map((entry) => entry.field));
  for (const field of [...FIELD_SELECTION_FIELDS].sort(compareCodePoints)) {
    if (plannedSet.has(field)) continue;
    const available = candidates.get(field) ?? [];
    if (available.length === 0) continue;
    decisions.push({
      field,
      tier: null,
      disposition: "not_selected_for_intent",
      reasons: [`intent ${intent} does not ask for ${field} and no declared role (${roles.join(", ")}) promotes it`],
      available_value_count: available.length,
      new_value_count: 0,
      selected_values: [],
      values_omitted: 0,
    });
  }

  return {
    view_id: stableId("field_selection", {
      artifact_id: document.artifactId,
      intent,
      policy_id: FIELD_SELECTION_POLICY_ID,
    }),
    artifact_id: document.artifactId,
    rmp_artifact_id: document.rmpArtifactId,
    source_path: document.sourcePath,
    format: document.format,
    intent,
    roles,
    role_evidence_ids: roleEvidenceIds,
    exact_duplicate_cluster_id: duplicate?.clusterId ?? null,
    near_duplicate_candidate_ids: [...document.nearDuplicateCandidateIds].sort(compareCodePoints),
    carrier_disposition: FIELD_SELECTION_CARRIER.disposition,
    fields: decisions,
    selected_field_count: selectedFields,
    selected_character_count: characters,
    epistemic_class: "source-declared",
    authority_verified: false,
    policy_id: FIELD_SELECTION_POLICY_ID,
    policy_version: FIELD_SELECTION_POLICY_VERSION,
  };
}

function tallyFields(records: readonly FieldSelectionRecord[]): FieldSelectionManifest["by_field"] {
  return [...FIELD_SELECTION_FIELDS].sort(compareCodePoints).map((field) => {
    const decisions = records.flatMap((record) => record.fields.filter((decision) => decision.field === field));
    const count = (disposition: FieldDisposition): number =>
      decisions.filter((decision) => decision.disposition === disposition).length;
    return {
      field,
      selected: count("selected"),
      redundant: count("redundant"),
      omitted_by_budget: count("omitted_by_budget"),
      unavailable: count("unavailable"),
      not_selected_for_intent: count("not_selected_for_intent"),
    };
  });
}

export interface BuildFieldSelectionInput {
  corpusSourceSnapshotId: string;
  corpusAnalysisId: string;
  intent: FieldSelectionIntent;
  budget: FieldSelectionBudget;
  documents: readonly FieldSelectionDocumentInput[];
}

/** The complete view and its receipt. A document with no evidence has no record. */
export function buildFieldSelectionExport(input: BuildFieldSelectionInput): FieldSelectionExport {
  const problems = validateFieldSelectionBudget(input.budget);
  if (problems.length > 0) throw new Error(`field-selection: ${problems.join("; ")}`);
  const records = input.documents
    .filter((document) => document.architectureRecords.length > 0 || document.workValues.length > 0)
    .map((document) => selectFieldsForDocument(document, input.intent, input.budget))
    .sort((a, b) => compareCodePoints(a.artifact_id, b.artifact_id));
  const payloadJsonl = records.map((record) => `${canonicalCorpusJson(record, 0)}\n`).join("");
  const manifest: FieldSelectionManifest = {
    schema: FIELD_SELECTION_MANIFEST_SCHEMA,
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    policy_id: FIELD_SELECTION_POLICY_ID,
    policy_version: FIELD_SELECTION_POLICY_VERSION,
    policy_hash: fieldSelectionPolicyHash(),
    profile_hash: fieldSelectionProfileHash(input.intent, input.budget),
    intent: input.intent,
    budget: {
      max_fields: input.budget.maxFields,
      max_values_per_field: input.budget.maxValuesPerField,
      max_characters: input.budget.maxCharacters,
    },
    carrier: FIELD_SELECTION_CARRIER,
    payload_file: FIELD_SELECTION_PAYLOAD_FILE,
    record_count: records.length,
    selected_field_count: records.reduce((sum, record) => sum + record.selected_field_count, 0),
    by_field: tallyFields(records),
    payload_byte_length: Buffer.byteLength(payloadJsonl, "utf8"),
    payload_artifact_hash: sha256TextPrefixed(payloadJsonl),
    payload_semantic_hash: sha256TextPrefixed(canonicalCorpusJson({ schema: FIELD_SELECTION_SCHEMA, records }, 0)),
    epistemic_class: "source-declared",
    statement: FIELD_SELECTION_STATEMENT,
  };
  return { records, manifest, payloadJsonl, manifestJson: `${canonicalCorpusJson(manifest)}\n` };
}

export function fieldSelectionRef(manifest: FieldSelectionManifest): FieldSelectionRef {
  return {
    schema: FIELD_SELECTION_SCHEMA,
    manifest_ref: FIELD_SELECTION_MANIFEST_FILE,
    payload_ref: manifest.payload_file,
    intent: manifest.intent,
    record_count: manifest.record_count,
    payload_semantic_hash: manifest.payload_semantic_hash,
    payload_artifact_hash: manifest.payload_artifact_hash,
  };
}

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
export function verifyFieldSelectionExport(input: VerifyFieldSelectionInput): string[] {
  const { manifest, payloadJsonl } = input;
  const problems: string[] = [];
  const lines = payloadJsonl.length === 0 ? [] : payloadJsonl.split("\n");
  if (payloadJsonl.length > 0 && lines[lines.length - 1] !== "") problems.push("payload does not end with a newline");
  const records: FieldSelectionRecord[] = [];
  for (const [index, line] of lines.entries()) {
    if (index === lines.length - 1 && line === "") continue;
    try {
      records.push(JSON.parse(line) as FieldSelectionRecord);
    } catch (error) {
      problems.push(`payload line ${index + 1} is not valid JSON: ${(error as Error).message}`);
    }
  }
  if (records.length !== manifest.record_count) problems.push(`manifest says ${manifest.record_count} record(s) and the payload carries ${records.length}`);
  if (Buffer.byteLength(payloadJsonl, "utf8") !== manifest.payload_byte_length) problems.push("payload byte length does not match the manifest");
  if (sha256TextPrefixed(payloadJsonl) !== manifest.payload_artifact_hash) problems.push("payload artifact hash does not match the manifest");
  if (sha256TextPrefixed(canonicalCorpusJson({ schema: FIELD_SELECTION_SCHEMA, records }, 0)) !== manifest.payload_semantic_hash) {
    problems.push("payload semantic hash does not match the manifest");
  }
  if (canonicalCorpusJson(tallyFields(records), 0) !== canonicalCorpusJson(manifest.by_field, 0)) {
    problems.push("manifest by_field does not match the payload records");
  }
  if (manifest.carrier.disposition !== "external_generation" || manifest.carrier.observed_files_mutated !== false) {
    problems.push("the view's carrier must be the external generation, with no observed file mutated");
  }
  for (const record of records) {
    if (!input.knownArtifactIds.has(record.artifact_id)) problems.push(`view ${record.view_id} names artifact ${record.artifact_id}, which this corpus did not observe`);
    if (record.epistemic_class !== "source-declared" || record.authority_verified !== false) {
      problems.push(`view ${record.view_id} is not classed source-declared with authority_verified false`);
    }
    if (record.selected_field_count > manifest.budget.max_fields || record.selected_character_count > manifest.budget.max_characters) {
      problems.push(`view ${record.view_id} exceeds the budget`);
    }
    if (record.intent !== manifest.intent || record.policy_id !== manifest.policy_id || record.policy_version !== manifest.policy_version) {
      problems.push(`view ${record.view_id} was not selected under the manifest's intent and policy`);
    }
    if (record.carrier_disposition !== "external_generation") {
      problems.push(`view ${record.view_id} names carrier '${String(record.carrier_disposition)}', not the external generation`);
    }
    for (const decision of record.fields) {
      if (!(FIELD_SELECTION_FIELDS as readonly string[]).includes(decision.field)) {
        problems.push(`view ${record.view_id} decides '${String(decision.field)}', which is not in the field vocabulary`);
      }
      if (decision.selected_values.length > manifest.budget.max_values_per_field) {
        problems.push(
          `view ${record.view_id} selects ${decision.selected_values.length} value(s) of ${decision.field}, over the budget's ${manifest.budget.max_values_per_field} per field`,
        );
      }
      if (!(FIELD_DISPOSITIONS as readonly string[]).includes(decision.disposition)) {
        problems.push(`view ${record.view_id} gives ${decision.field} the unknown disposition '${decision.disposition}'`);
      }
      if (decision.reasons.length === 0) problems.push(`view ${record.view_id} decides ${decision.field} without a reason`);
      if ((decision.disposition === "selected") !== (decision.selected_values.length > 0)) {
        problems.push(`view ${record.view_id} field ${decision.field} is ${decision.disposition} with ${decision.selected_values.length} value(s)`);
      }
      for (const value of decision.selected_values) {
        if (!input.knownRecordIds.has(value.record_id)) {
          problems.push(`view ${record.view_id} cites ${value.record_id}, which no payload of this generation carries`);
        }
      }
    }
  }
  return problems;
}

/** True when the value names a known intent. */
export function isFieldSelectionIntent(value: string): value is FieldSelectionIntent {
  return (FIELD_SELECTION_INTENTS as readonly string[]).includes(value);
}

/** Every statement class has a field, so a new class cannot silently fall outside the view. */
export const STATEMENT_FIELDS_COVER_CLASSES = ARCHITECTURE_STATEMENT_CLASSES.every((statementClass) =>
  (FIELD_SELECTION_FIELDS as readonly string[]).includes(`statement.${statementClass}`),
);
