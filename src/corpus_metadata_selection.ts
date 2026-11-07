// corpus_metadata_selection.ts — which of the evidence a run already has is
// the most useful to carry for the purpose the run was made for.
//
// A design corpus read with `--architecture-evidence` holds every statement its
// documents declared, with every field the contract gives a record. A consumer
// preparing a development handoff does not want the same fields as one
// reviewing what an archived design decided, and neither wants all of them. This
// module applies one static policy, keyed by the run's declared intent, to
// choose a bounded set of existing fields per record and to say why each was
// chosen or left out.
//
// It is a derived view and nothing more. It reads the architecture-evidence
// export the scan already built, invents no field, scores nothing, and deletes
// nothing: the complete payload stays beside it, every record is listed with
// its verdict, and a record left out of the view is left out with a reason. It
// carries no authority — a selected field is still the document's own
// declaration, source-declared and never verified — and it writes nowhere but
// into the generation the scan is already publishing.
import { canonicalCorpusJson } from "./corpus_analysis";
import type {
  ArchitectureDocumentRole,
  ArchitectureEvidenceExport,
  ArchitectureEvidenceRecord,
} from "./corpus_architecture_evidence";
import { ARCHITECTURE_DOCUMENT_ROLES } from "./corpus_architecture_evidence";
import type { ArchitectureStatementClass } from "./extractors/architecture_statements";
import { ARCHITECTURE_STATEMENT_CLASSES } from "./extractors/architecture_statements";
import { compareCodePoints } from "./ordering";
import { semanticHash, sha256TextPrefixed } from "./repository_model";

export const METADATA_SELECTION_SCHEMA = "l9.metadata-selection/v1";
export const METADATA_SELECTION_MANIFEST_SCHEMA = "l9.metadata-selection-manifest/v1";
export const METADATA_SELECTION_PAYLOAD_FILE = "metadata-selection.jsonl";
export const METADATA_SELECTION_MANIFEST_FILE = "metadata-selection.manifest.json";

/** The one policy this package ships. Its rules are the table below. */
export const METADATA_SELECTION_POLICY_ID = "local-source-metadata-selection/v1";
export const METADATA_SELECTION_POLICY_VERSION = "1.0.0";

/**
 * Where a local-source run's metadata lives: in the generation the scan
 * publishes, beside the evidence it was derived from. The run observes files; it
 * never writes into them, and this view changes nothing about that.
 */
export const METADATA_CARRIER_DISPOSITION = "external-generation";
export const METADATA_CARRIER_STATEMENT =
  "local-source metadata is carried by the generation directory the scan publishes "
  + "atomically; no observed file is opened for writing, annotated, or given a sidecar";

export const METADATA_SELECTION_STATEMENT =
  "a derived view over the architecture-evidence payload: each record lists which of its "
  + "existing fields the intent policy selected and why; nothing is scored, inferred, "
  + "resolved or deleted, and every statement remains source-declared and unverified";

/**
 * What the run is for. Each intent is a static row in the table below; the
 * vocabulary is closed, and an intent this package does not know is refused at
 * the CLI rather than mapped to the nearest one.
 */
export const METADATA_SELECTION_INTENTS = [
  "accepted_declaration",
  "development_handoff",
  "historical_review",
  "wip_design",
] as const;
export type MetadataSelectionIntent = (typeof METADATA_SELECTION_INTENTS)[number];

export function isMetadataSelectionIntent(value: string): value is MetadataSelectionIntent {
  return (METADATA_SELECTION_INTENTS as readonly string[]).includes(value);
}

/**
 * The existing record fields the policy may select, by the path a reader would
 * use on an `ArchitectureEvidenceRecord`. Nothing outside this catalog is ever
 * carried, and the catalog names no field the evidence contract does not have.
 */
export const METADATA_FIELD_CATALOG = [
  { field: "evidence_id", carries: "the record's identity, stable across runs and locations" },
  { field: "artifact_id", carries: "the corpus identity of the document" },
  { field: "source_path", carries: "the document's root-relative path" },
  { field: "statement_class", carries: "which of the five classes the statement is" },
  { field: "declared_text", carries: "the statement as written" },
  { field: "structured_locator", carries: "the exact coordinate in the format's own terms" },
  { field: "bounded_excerpt", carries: "the surrounding text, when it says more than the statement" },
  { field: "recognition", carries: "the written form and label the statement was read from" },
  { field: "raw_content_hash", carries: "the bytes the declaration was read from" },
  { field: "work_context.kinds", carries: "what kind of document it declares itself to be" },
  { field: "work_context.statuses", carries: "what stage the document declares it is at" },
  { field: "work_context.applicability", carries: "whether the document says it still applies" },
  { field: "work_context.handoff", carries: "the tasks, blockers and dependencies it carries, counted" },
  { field: "selection.roles", carries: "the roles the selection policy filed the document under" },
  { field: "selection.role_evidence", carries: "the declarations that established those roles" },
  { field: "authority_verified", carries: "that no statement in the view is verified (always false)" },
] as const;
export type MetadataField = (typeof METADATA_FIELD_CATALOG)[number]["field"];

/** Carried on every included record whatever the intent: identity, class, text, coordinate. */
export const METADATA_ALWAYS_FIELDS: readonly MetadataField[] = [
  "evidence_id", "artifact_id", "source_path", "statement_class", "declared_text", "structured_locator",
];

export interface MetadataIntentRule {
  intent: MetadataSelectionIntent;
  statement: string;
  /** Documents filed under any of these roles are in the view. */
  roles: readonly ArchitectureDocumentRole[];
  /**
   * Documents that declared any of these `work.status` values are in the view too.
   * A declared lifecycle status is a separate axis from a role (a specification
   * that says it is archived is still a specification), so an intent about
   * accepted or superseded documents reads the status the document declared.
   */
  statuses: readonly string[];
  /** Whether a document with no declared role is kept for recall. */
  retains_unknown_role: boolean;
  /** The classes the intent wants, most useful first; the order bounds the view. */
  classes: readonly ArchitectureStatementClass[];
  /** Fields beyond the always-set this intent carries. */
  fields: readonly MetadataField[];
  /** At most this many included records per document, taken in class order. */
  max_per_document: number;
}

const INTENT_RULES: readonly MetadataIntentRule[] = [
  {
    intent: "wip_design",
    statement: "a design still in progress: what it is trying to do, what it assumes, what it has not settled, and where it stands",
    roles: ["wip_proposal", "research_notes"],
    statuses: [],
    retains_unknown_role: true,
    classes: ["open_question", "assumption", "intent", "decision_statement", "constraint"],
    fields: ["bounded_excerpt", "work_context.statuses", "work_context.handoff", "selection.roles"],
    max_per_document: 8,
  },
  {
    intent: "accepted_declaration",
    statement: "what a document that declares itself accepted says it is bound by and has decided, with the bytes it was read from",
    roles: ["specification"],
    statuses: ["active", "complete", "done"],
    retains_unknown_role: false,
    classes: ["constraint", "decision_statement", "intent"],
    fields: ["raw_content_hash", "work_context.statuses", "selection.roles", "selection.role_evidence", "authority_verified"],
    max_per_document: 12,
  },
  {
    intent: "development_handoff",
    statement: "what the next engineer may not change, what nobody has resolved, and what the document says is blocked or pending",
    roles: ["development_handoff", "wip_proposal"],
    statuses: [],
    retains_unknown_role: true,
    classes: ["open_question", "constraint", "decision_statement"],
    fields: ["bounded_excerpt", "work_context.handoff", "work_context.applicability", "selection.roles", "selection.role_evidence"],
    max_per_document: 8,
  },
  {
    intent: "historical_review",
    statement: "what a document that declares itself superseded or archived had decided and assumed, and what it says replaced it",
    roles: [],
    statuses: ["archived", "cancelled", "superseded"],
    retains_unknown_role: false,
    classes: ["decision_statement", "constraint", "assumption"],
    fields: ["raw_content_hash", "work_context.applicability", "work_context.statuses", "selection.roles", "selection.role_evidence"],
    max_per_document: 6,
  },
];

export function metadataIntentRule(intent: MetadataSelectionIntent): MetadataIntentRule {
  const rule = INTENT_RULES.find((candidate) => candidate.intent === intent);
  if (rule === undefined) throw new Error(`metadata selection: unknown intent '${intent}'`);
  return rule;
}

/** Why a record is in the view or not. Closed vocabulary; the manifest tallies it. */
export const METADATA_RECORD_REASONS = [
  "role_matches_intent",
  "status_matches_intent",
  "role_unknown_retained",
  "role_outside_intent",
  "class_outside_intent",
  "bounded_out",
] as const;
export type MetadataRecordReason = (typeof METADATA_RECORD_REASONS)[number];

/** Why a field is carried or not. */
export const METADATA_FIELD_DISPOSITIONS = [
  "always",
  "intent_selects",
  "not_in_intent",
  "empty",
  "redundant",
] as const;
export type MetadataFieldDisposition = (typeof METADATA_FIELD_DISPOSITIONS)[number];

export interface MetadataSelectionPolicy {
  policy_id: string;
  policy_version: string;
  always_fields: MetadataField[];
  field_catalog: { field: MetadataField; carries: string }[];
  intents: {
    intent: MetadataSelectionIntent;
    statement: string;
    roles: ArchitectureDocumentRole[];
    statuses: string[];
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

const REDUNDANCY_RULES: readonly string[] = [
  "bounded_excerpt is redundant when it equals declared_text",
  "work_context.applicability is redundant when it carries no predicate beyond work.status (already in work_context.statuses)",
];

/** The whole policy, as the manifest carries it so a reason can be checked against its row. */
export function metadataSelectionPolicy(): MetadataSelectionPolicy {
  return {
    policy_id: METADATA_SELECTION_POLICY_ID,
    policy_version: METADATA_SELECTION_POLICY_VERSION,
    always_fields: [...METADATA_ALWAYS_FIELDS],
    field_catalog: METADATA_FIELD_CATALOG.map((entry) => ({ field: entry.field, carries: entry.carries })),
    intents: INTENT_RULES.map((rule) => ({
      intent: rule.intent,
      statement: rule.statement,
      roles: [...rule.roles],
      statuses: [...rule.statuses],
      retains_unknown_role: rule.retains_unknown_role,
      classes: [...rule.classes],
      fields: [...rule.fields],
      max_per_document: rule.max_per_document,
    })),
    record_reasons: [...METADATA_RECORD_REASONS],
    field_dispositions: [...METADATA_FIELD_DISPOSITIONS],
    redundancy_rules: [...REDUNDANCY_RULES],
  };
}

/**
 * Hash of the policy: every row, the catalog and the rules. Independent of the
 * intent, which is a run parameter; the two are bound together into the analysis
 * identity by `metadataSelectionProfileHash`.
 */
export function metadataSelectionPolicyHash(): string {
  return semanticHash({
    schema: METADATA_SELECTION_SCHEMA,
    policy: metadataSelectionPolicy(),
    carrier: METADATA_CARRIER_DISPOSITION,
    role_vocabulary: [...ARCHITECTURE_DOCUMENT_ROLES],
    class_vocabulary: [...ARCHITECTURE_STATEMENT_CLASSES],
    ordering: "evidence payload order; per-document bound taken in class order",
  });
}

/**
 * What enters `corpus_analysis_id` when the view is selected: the policy and the
 * intent it was applied with. A run for a handoff and a run for a review conclude
 * different things from the same evidence, so they are different analyses of the
 * same source snapshot.
 */
export function metadataSelectionProfileHash(intent: MetadataSelectionIntent): string {
  return semanticHash({ policy_hash: metadataSelectionPolicyHash(), intent });
}

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
  by_reason: { reason: MetadataRecordReason; record_count: number }[];
  by_class: { statement_class: string; included_count: number; excluded_count: number }[];
  by_field: { field: MetadataField; carried_count: number; omitted_count: number }[];
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

function readField(record: ArchitectureEvidenceRecord, field: MetadataField): unknown {
  switch (field) {
    case "evidence_id": return record.evidence_id;
    case "artifact_id": return record.artifact_id;
    case "source_path": return record.source_path;
    case "statement_class": return record.statement_class;
    case "declared_text": return record.declared_text;
    case "structured_locator": return record.structured_locator;
    case "bounded_excerpt": return record.bounded_excerpt;
    case "recognition": return record.recognition;
    case "raw_content_hash": return record.raw_content_hash;
    case "work_context.kinds": return record.work_context.kinds;
    case "work_context.statuses": return record.work_context.statuses;
    case "work_context.applicability": return record.work_context.applicability;
    case "work_context.handoff": return record.work_context.handoff;
    case "selection.roles": return record.selection.roles;
    case "selection.role_evidence": return record.selection.role_evidence;
    case "authority_verified": return record.authority_verified;
    default: {
      const exhaustive: never = field;
      throw new Error(`metadata selection: field '${String(exhaustive)}' is not in the catalog`);
    }
  }
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (Array.isArray(value) && value.length === 0);
}

/**
 * Decide each catalog field for one included record, in catalog order. The
 * always-set is carried unconditionally; an intent field is carried unless it is
 * empty (no utility) or says nothing another carried field does not (redundant).
 */
function selectFields(
  record: ArchitectureEvidenceRecord,
  rule: MetadataIntentRule,
): { fields: Record<string, unknown>; reasons: MetadataFieldReason[] } {
  const fields: Record<string, unknown> = {};
  const reasons: MetadataFieldReason[] = [];
  for (const entry of METADATA_FIELD_CATALOG) {
    const field = entry.field;
    const value = readField(record, field);
    if (METADATA_ALWAYS_FIELDS.includes(field)) {
      fields[field] = value;
      reasons.push({ field, disposition: "always", reason: "carried on every included record" });
      continue;
    }
    if (!rule.fields.includes(field)) {
      reasons.push({ field, disposition: "not_in_intent", reason: `${rule.intent} does not select it` });
      continue;
    }
    if (isEmpty(value)) {
      reasons.push({ field, disposition: "empty", reason: "the record carries nothing under it" });
      continue;
    }
    if (field === "bounded_excerpt" && value === record.declared_text) {
      reasons.push({ field, disposition: "redundant", reason: "equals declared_text" });
      continue;
    }
    if (
      field === "work_context.applicability"
      && record.work_context.applicability.every((ref) => ref.predicate === "work.status")
    ) {
      reasons.push({ field, disposition: "redundant", reason: "carries no predicate beyond work.status, already in work_context.statuses" });
      continue;
    }
    fields[field] = value;
    reasons.push({ field, disposition: "intent_selects", reason: `${rule.intent} selects it: ${entry.carries}` });
  }
  return { fields, reasons };
}

interface Verdict {
  included: boolean;
  reason: MetadataRecordReason;
  explanation: string;
}

/** Role and class gates, before the per-document bound. */
function gate(record: ArchitectureEvidenceRecord, rule: MetadataIntentRule): Verdict {
  const roles = record.selection.roles;
  const matched = roles.filter((role) => rule.roles.includes(role));
  const declared = record.work_context.statuses.filter((ref) => rule.statuses.includes(ref.object));
  let roleReason: MetadataRecordReason;
  let roleExplanation: string;
  if (matched.length > 0) {
    roleReason = "role_matches_intent";
    roleExplanation = `document role ${matched.join(", ")} is in ${rule.intent}'s roles`;
  } else if (declared.length > 0) {
    roleReason = "status_matches_intent";
    roleExplanation = `document declares work.status=${declared.map((ref) => ref.object).join(", ")}, which ${rule.intent} reads`
      + " (a source declaration, not a verified lifecycle)";
  } else if (roles.length === 1 && roles[0] === "unknown" && rule.retains_unknown_role) {
    roleReason = "role_unknown_retained";
    roleExplanation = `document declares no role and ${rule.intent} retains unknown-role documents for recall`;
  } else {
    return {
      included: false,
      reason: "role_outside_intent",
      explanation: `document role ${roles.join(", ")} is not in ${rule.intent}'s roles (${rule.roles.join(", ")}`
        + `${rule.retains_unknown_role ? ", unknown" : ""})`
        + (rule.statuses.length > 0 ? ` and it declares none of the statuses ${rule.statuses.join(", ")}` : ""),
    };
  }
  if (!rule.classes.includes(record.statement_class)) {
    return {
      included: false,
      reason: "class_outside_intent",
      explanation: `${record.statement_class} is not in ${rule.intent}'s classes (${rule.classes.join(", ")})`,
    };
  }
  return { included: true, reason: roleReason, explanation: roleExplanation };
}

function tallyReasons(records: readonly MetadataSelectionRecord[]): MetadataSelectionManifest["by_reason"] {
  return METADATA_RECORD_REASONS
    .map((reason) => ({ reason, record_count: records.filter((record) => record.reason === reason).length }))
    .filter((entry) => entry.record_count > 0);
}

function tallyClasses(records: readonly MetadataSelectionRecord[]): MetadataSelectionManifest["by_class"] {
  const out = new Map<string, { included_count: number; excluded_count: number }>();
  for (const record of records) {
    const tally = out.get(record.statement_class) ?? { included_count: 0, excluded_count: 0 };
    if (record.included) tally.included_count += 1;
    else tally.excluded_count += 1;
    out.set(record.statement_class, tally);
  }
  return [...out.entries()]
    .sort((a, b) => compareCodePoints(a[0], b[0]))
    .map(([statement_class, tally]) => ({ statement_class, ...tally }));
}

function tallyFields(records: readonly MetadataSelectionRecord[]): MetadataSelectionManifest["by_field"] {
  return METADATA_FIELD_CATALOG.map((entry) => {
    let carried = 0;
    let omitted = 0;
    for (const record of records) {
      for (const reason of record.field_reasons ?? []) {
        if (reason.field !== entry.field) continue;
        if (reason.disposition === "always" || reason.disposition === "intent_selects") carried += 1;
        else omitted += 1;
      }
    }
    return { field: entry.field, carried_count: carried, omitted_count: omitted };
  });
}

export function renderMetadataSelectionRecord(record: MetadataSelectionRecord): string {
  return canonicalCorpusJson(record, 0);
}

/**
 * Apply the intent's row to every evidence record. Records keep the evidence
 * payload's order; the per-document bound is taken in the row's class order so
 * that the most useful classes survive it, and a record it drops is listed as
 * `bounded_out` rather than vanishing.
 */
export function buildMetadataSelectionExport(input: BuildMetadataSelectionInput): MetadataSelectionExport {
  const rule = metadataIntentRule(input.intent);
  const evidence = input.evidence;
  const verdicts = new Map<string, Verdict>();
  const perDocument = new Map<string, ArchitectureEvidenceRecord[]>();
  for (const record of evidence.records) {
    const verdict = gate(record, rule);
    verdicts.set(record.evidence_id, verdict);
    if (!verdict.included) continue;
    const list = perDocument.get(record.artifact_id) ?? [];
    list.push(record);
    perDocument.set(record.artifact_id, list);
  }
  for (const candidates of perDocument.values()) {
    // Stable: the class order first, then the evidence payload's own order,
    // which is total (ADR-087) and already the order `candidates` holds.
    const ranked = candidates
      .map((record, position) => ({ record, position }))
      .sort((a, b) => (
        rule.classes.indexOf(a.record.statement_class) - rule.classes.indexOf(b.record.statement_class)
      ) || (a.position - b.position));
    for (const [index, entry] of ranked.entries()) {
      if (index < rule.max_per_document) continue;
      verdicts.set(entry.record.evidence_id, {
        included: false,
        reason: "bounded_out",
        explanation: `${rule.intent} carries at most ${rule.max_per_document} record(s) per document, taken in class order; `
          + `this ${entry.record.statement_class} was the ${index + 1}th`,
      });
    }
  }

  const records: MetadataSelectionRecord[] = evidence.records.map((record) => {
    const verdict = verdicts.get(record.evidence_id);
    if (verdict === undefined) throw new Error(`metadata selection: no verdict for ${record.evidence_id}`);
    const base: MetadataSelectionRecord = {
      evidence_id: record.evidence_id,
      artifact_id: record.artifact_id,
      source_path: record.source_path,
      statement_class: record.statement_class,
      intent: rule.intent,
      roles: [...record.selection.roles],
      included: verdict.included,
      reason: verdict.reason,
      explanation: verdict.explanation,
      policy_id: METADATA_SELECTION_POLICY_ID,
      policy_version: METADATA_SELECTION_POLICY_VERSION,
    };
    if (!verdict.included) return base;
    const { fields, reasons } = selectFields(record, rule);
    return { ...base, fields, field_reasons: reasons };
  });

  const payloadJsonl = records.map((record) => `${renderMetadataSelectionRecord(record)}\n`).join("");
  const included = records.filter((record) => record.included);
  const policyHash = metadataSelectionPolicyHash();
  const manifest: MetadataSelectionManifest = {
    schema: METADATA_SELECTION_MANIFEST_SCHEMA,
    corpus_source_snapshot_id: input.corpusSourceSnapshotId,
    corpus_analysis_id: input.corpusAnalysisId,
    policy_id: METADATA_SELECTION_POLICY_ID,
    policy_version: METADATA_SELECTION_POLICY_VERSION,
    policy_hash: policyHash,
    profile_hash: metadataSelectionProfileHash(rule.intent),
    intent: rule.intent,
    intent_statement: rule.statement,
    derived_from: {
      schema: evidence.manifest.schema,
      payload_file: evidence.manifest.payload_file,
      profile_hash: evidence.manifest.profile_hash,
      payload_semantic_hash: evidence.manifest.payload_semantic_hash,
      record_count: evidence.manifest.record_count,
    },
    carrier: {
      disposition: METADATA_CARRIER_DISPOSITION,
      mutates_observed_files: false,
      statement: METADATA_CARRIER_STATEMENT,
    },
    policy: metadataSelectionPolicy(),
    payload_file: METADATA_SELECTION_PAYLOAD_FILE,
    record_count: records.length,
    included_record_count: included.length,
    document_count: new Set(records.map((record) => record.artifact_id)).size,
    included_document_count: new Set(included.map((record) => record.artifact_id)).size,
    by_reason: tallyReasons(records),
    by_class: tallyClasses(records),
    by_field: tallyFields(records),
    payload_byte_length: Buffer.byteLength(payloadJsonl, "utf8"),
    payload_artifact_hash: sha256TextPrefixed(payloadJsonl),
    payload_semantic_hash: sha256TextPrefixed(
      canonicalCorpusJson({ schema: METADATA_SELECTION_SCHEMA, records }, 0),
    ),
    epistemic_class: evidence.manifest.epistemic_class,
    authority_verified: false,
    statement: METADATA_SELECTION_STATEMENT,
  };
  return { records, manifest, payloadJsonl, manifestJson: canonicalCorpusJson(manifest, 2) };
}

export function metadataSelectionRef(manifest: MetadataSelectionManifest): MetadataSelectionRef {
  return {
    schema: METADATA_SELECTION_SCHEMA,
    manifest_ref: METADATA_SELECTION_MANIFEST_FILE,
    payload_ref: manifest.payload_file,
    intent: manifest.intent,
    record_count: manifest.record_count,
    included_record_count: manifest.included_record_count,
    payload_semantic_hash: manifest.payload_semantic_hash,
    payload_artifact_hash: manifest.payload_artifact_hash,
  };
}

function readPayloadRecords(payloadJsonl: string): { records: MetadataSelectionRecord[]; problems: string[] } {
  const problems: string[] = [];
  const lines = payloadJsonl.length === 0 ? [] : payloadJsonl.split("\n");
  if (payloadJsonl.length > 0 && lines[lines.length - 1] !== "") {
    problems.push("payload does not end with a newline");
  }
  const bodies = lines.filter((line, index) => !(index === lines.length - 1 && line === ""));
  const records: MetadataSelectionRecord[] = [];
  for (const [index, line] of bodies.entries()) {
    if (line.length === 0) {
      problems.push(`payload line ${index + 1} is empty`);
      continue;
    }
    try {
      records.push(JSON.parse(line) as MetadataSelectionRecord);
    } catch (error) {
      problems.push(`payload line ${index + 1} is not valid JSON: ${(error as Error).message}`);
    }
  }
  return { records, problems };
}

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
export function verifyMetadataSelectionExport(input: VerifyMetadataSelectionExportInput): string[] {
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
  if (manifest.derived_from.payload_semantic_hash !== input.evidencePayloadSemanticHash) {
    problems.push("the view derives from evidence other than the payload beside it");
  }
  if (manifest.carrier.disposition !== METADATA_CARRIER_DISPOSITION || manifest.carrier.mutates_observed_files !== false) {
    problems.push("the manifest does not state the external-generation carrier with no observed-file mutation");
  }
  if (!isMetadataSelectionIntent(manifest.intent)) {
    problems.push(`manifest intent '${String(manifest.intent)}' is not in the vocabulary`);
  }
  if (records.length === manifest.record_count) {
    const semantic = sha256TextPrefixed(canonicalCorpusJson({ schema: METADATA_SELECTION_SCHEMA, records }, 0));
    if (semantic !== manifest.payload_semantic_hash) {
      problems.push(`payload semantic hash ${semantic} does not match the manifest's ${manifest.payload_semantic_hash}`);
    }
    const included = records.filter((record) => record.included === true);
    if (included.length !== manifest.included_record_count) {
      problems.push(`manifest included_record_count is ${manifest.included_record_count} and the payload includes ${included.length}`);
    }
    const documents = new Set(records.map((record) => record.artifact_id)).size;
    if (documents !== manifest.document_count) {
      problems.push(`manifest document_count is ${manifest.document_count} and the payload names ${documents}`);
    }
    const includedDocuments = new Set(included.map((record) => record.artifact_id)).size;
    if (includedDocuments !== manifest.included_document_count) {
      problems.push(`manifest included_document_count is ${manifest.included_document_count} and the payload includes ${includedDocuments}`);
    }
    for (const [name, expected, actual] of [
      ["by_reason", canonicalCorpusJson(tallyReasons(records), 0), canonicalCorpusJson(manifest.by_reason, 0)],
      ["by_class", canonicalCorpusJson(tallyClasses(records), 0), canonicalCorpusJson(manifest.by_class, 0)],
      ["by_field", canonicalCorpusJson(tallyFields(records), 0), canonicalCorpusJson(manifest.by_field, 0)],
    ] as const) {
      if (expected !== actual) problems.push(`manifest ${name} does not match the payload records: expected ${expected}`);
    }
    if (input.knownEvidenceIds.size !== records.length) {
      problems.push(`the evidence payload carries ${input.knownEvidenceIds.size} record(s) and the view gives verdicts on ${records.length}`);
    }
  }
  const catalog = new Set<string>(METADATA_FIELD_CATALOG.map((entry) => entry.field));
  const seen = new Set<string>();
  for (const record of records) {
    if (seen.has(record.evidence_id)) problems.push(`duplicate evidence_id ${record.evidence_id}`);
    seen.add(record.evidence_id);
    if (!input.knownEvidenceIds.has(record.evidence_id)) {
      problems.push(`record ${record.evidence_id} is not in the evidence payload the view derives from`);
    }
    if (record.intent !== manifest.intent) {
      problems.push(`record ${record.evidence_id} carries intent '${String(record.intent)}' under a ${manifest.intent} manifest`);
    }
    if (!(METADATA_RECORD_REASONS as readonly string[]).includes(record.reason)) {
      problems.push(`record ${record.evidence_id} carries reason '${String(record.reason)}', which is not in the vocabulary`);
    }
    if (record.included) {
      if (record.fields === undefined || record.field_reasons === undefined) {
        problems.push(`included record ${record.evidence_id} carries no fields`);
        continue;
      }
      for (const field of Object.keys(record.fields)) {
        if (!catalog.has(field)) problems.push(`record ${record.evidence_id} carries '${field}', which is not in the catalog`);
      }
      if (record.field_reasons.length !== METADATA_FIELD_CATALOG.length) {
        problems.push(`record ${record.evidence_id} accounts for ${record.field_reasons.length} field(s), not the catalog's ${METADATA_FIELD_CATALOG.length}`);
      }
      for (const field of METADATA_ALWAYS_FIELDS) {
        if (!(field in record.fields)) problems.push(`included record ${record.evidence_id} lacks always-field ${field}`);
      }
      for (const reason of record.field_reasons) {
        const carried = reason.disposition === "always" || reason.disposition === "intent_selects";
        if (carried !== (reason.field in record.fields)) {
          problems.push(`record ${record.evidence_id} says ${reason.field} is ${reason.disposition} but ${carried ? "does not carry" : "carries"} it`);
        }
      }
    } else if (record.fields !== undefined || record.field_reasons !== undefined) {
      problems.push(`excluded record ${record.evidence_id} carries fields`);
    }
  }
  return problems;
}
