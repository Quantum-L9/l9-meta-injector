// semantic_mapping.ts — governed meanings of native header predicates (ADR-084).
//
// The one place that says what a native `L9_META` field means. The meaning is not
// this package's to invent: it is `l9.artifact-header-model/global@1` in the
// Semantic Foundation (Quantum-L9/.github, v3.27.0, ADR-024), which this
// repository cites by exact digest in `.l9/meta-authority.yaml`. This table
// transcribes that ledger into the shape a producer needs — predicate, cardinality,
// projection — and nothing more. It adds no meaning the ledger does not state.
//
// Three consequences, all from the ledger:
//
// - Every field is a source declaration about the file that carries it
//   (evidence class `declared`, authority `source`). Nothing here observes it.
// - No field projects anything: `projection` is `none` for all thirty, because
//   the ledger's `projection_boundary.canonical_relations` is `none`. `owner` is no
//   OWNED_BY, `ssot_for` no GOVERNED_BY, `references` no DEPENDS_ON.
// - A field the ledger does not define has no entry. It stays preserved as an
//   unsupported or unresolved field and is never given a local meaning.
//
// The extractor reads its field vocabulary from here, so there is one table, and
// the table's hash is part of the interpretation profile: changing a meaning
// changes the identity of every packet produced under it.
// Imports nothing but ordering: the extractors read this table at module load,
// and repository_model imports the extractors, so a dependency on
// repository_model here would be a load-time cycle. The interpretation profile
// hashes `semanticMappingIdentity()` itself.
import { compareCodePoints } from "./ordering";

export const SEMANTIC_MAPPING_ID = "meta-injector-native-header-semantics";
export const SEMANTIC_MAPPING_VERSION = "1.0.0";

/** The ledger every entry transcribes, cited by the digest this repository binds. */
export const ARTIFACT_HEADER_LEDGER = {
  artifact_id: "l9.artifact-header-model/global@1",
  digest: "sha256:0f9e32651b71ebfe19b57735567e06666a91b9c3b3936f149f6cac309d6d6bf1",
  release: "v3.27.0",
  decision: "ADR-024",
} as const;

export type HeaderFieldCategory = "identity" | "classification" | "governance" | "retrieval";

/** The ledger's `value_kinds`. */
export type HeaderValueKind = "label" | "label_list" | "path" | "reference_list" | "url" | "count" | "text";

/**
 * How many objects one subject may hold at once. A list-valued field declares
 * several values that are all claimed together; a scalar declares one, so two
 * different declarations of it about one file are a conflict to preserve.
 */
export type HeaderFieldCardinality = "single" | "set";

export interface HeaderFieldMapping {
  /** The field key as written in the header. */
  field: string;
  category: HeaderFieldCategory;
  value_kind: HeaderValueKind;
  cardinality: HeaderFieldCardinality;
  /** Coordinate of the governing definition. */
  ledger_ref: string;
  /** Values the ledger declares a meaning for; absent when the value set is open. */
  declared_values?: readonly string[];
}

/** The declared schemas a field meaning applies under, and the predicate namespace of each. */
export const RECOGNIZED_DECLARED_SCHEMAS: Readonly<Record<string, string>> = {
  "l9_schema:1": "l9v1",
  "l9_schema:2": "l9v2",
};

/** Policy applying to every entry; stated once so no entry can drift from it. */
export const HEADER_DECLARATION_POLICY = {
  subject_scope: "artifact",
  evidence_class: "declared",
  authority: "source",
  object_normalization: "verbatim",
  projection: "none",
  conflict: { single: "preserve-all-and-conflict", set: "aggregate-distinct" },
  unknown: "unresolved-or-empty-value-preserved-as-unresolved-field",
  outside_vocabulary: "preserved-as-unsupported-field-without-meaning",
  unrecognized_schema: "key-preserved-without-meaning",
  authority_requirements:
    "none to hold the claim; any projection requires a separate admitted decision naming the relation owner",
} as const;

const CARDINALITY: Readonly<Record<HeaderValueKind, HeaderFieldCardinality>> = {
  label: "single",
  path: "single",
  url: "single",
  count: "single",
  text: "single",
  label_list: "set",
  reference_list: "set",
};

function entry(
  field: string,
  category: HeaderFieldCategory,
  value_kind: HeaderValueKind,
  declared_values?: readonly string[],
): HeaderFieldMapping {
  return {
    field,
    category,
    value_kind,
    cardinality: CARDINALITY[value_kind],
    ledger_ref: `${ARTIFACT_HEADER_LEDGER.artifact_id}#fields.${field}`,
    ...(declared_values ? { declared_values } : {}),
  };
}

/** The ledger's `fields`, in its order. Thirty entries: 11 identity, 6 classification, 5 governance, 8 retrieval. */
export const NATIVE_HEADER_FIELDS: readonly HeaderFieldMapping[] = [
  entry("id", "identity", "label"),
  entry("origin", "identity", "label"),
  entry("engine", "identity", "label"),
  entry("namespace", "identity", "label"),
  entry("component", "identity", "label"),
  entry("canonical_path", "identity", "path"),
  entry("version", "identity", "label"),
  entry("title", "identity", "text"),
  entry("source_repo", "identity", "text"),
  entry("source_file", "identity", "text"),
  entry("source_adr", "identity", "label"),
  entry("layer", "classification", "label_list"),
  entry("tags", "classification", "label_list"),
  entry("artifact_type", "classification", "label"),
  entry("status", "classification", "label", ["active", "deprecated", "candidate", "stub"]),
  entry("ring", "classification", "label"),
  entry("category", "classification", "label"),
  entry("owner", "governance", "label"),
  entry("ssot_for", "governance", "label_list"),
  entry("canonical", "governance", "label"),
  entry("canonical_source", "governance", "url"),
  entry("single_source_rule", "governance", "text"),
  entry("retrieval", "retrieval", "label"),
  entry("load_when", "retrieval", "label_list"),
  entry("load_condition", "retrieval", "text"),
  entry("references", "retrieval", "reference_list"),
  entry("requires", "retrieval", "reference_list"),
  entry("amplifies", "retrieval", "reference_list"),
  entry("retrieval_keys", "retrieval", "text"),
  entry("token_estimate", "retrieval", "count"),
];

const BY_FIELD: ReadonlyMap<string, HeaderFieldMapping> = new Map(
  NATIVE_HEADER_FIELDS.map((mapping) => [mapping.field, mapping]),
);

/** The governing mapping for a field key, or undefined when the ledger defines none. */
export function headerFieldMapping(field: string): HeaderFieldMapping | undefined {
  return BY_FIELD.get(field);
}

/** The predicate a field is emitted under, for one recognized declared schema. */
export function headerFieldPredicate(namespace: string, mapping: HeaderFieldMapping): string {
  return `meta.${namespace}.${mapping.category}.${mapping.field}`;
}

export interface GovernedPredicate {
  predicate: string;
  declared_schema: string;
  mapping: HeaderFieldMapping;
}

/**
 * Every predicate that carries a governed meaning, one per field per recognized
 * schema, in code-point order. Anything else the extractor emits under `meta.` is
 * structural (carrier, schema) or deliberately meaningless (unresolved,
 * unsupported and unversioned fields).
 */
export function governedHeaderPredicates(): GovernedPredicate[] {
  const out: GovernedPredicate[] = [];
  for (const [declared_schema, namespace] of Object.entries(RECOGNIZED_DECLARED_SCHEMAS)) {
    for (const mapping of NATIVE_HEADER_FIELDS) {
      out.push({ predicate: headerFieldPredicate(namespace, mapping), declared_schema, mapping });
    }
  }
  return out.sort((left, right) => compareCodePoints(left.predicate, right.predicate));
}

/** Resolve an emitted predicate back to its governed meaning, or undefined. */
export function governedMeaningOf(predicate: string): GovernedPredicate | undefined {
  const match = /^meta\.([a-z0-9]+)\.(identity|classification|governance|retrieval)\.([a-z_]+)$/.exec(predicate);
  if (!match) return undefined;
  const declared_schema = Object.keys(RECOGNIZED_DECLARED_SCHEMAS)
    .find((schema) => RECOGNIZED_DECLARED_SCHEMAS[schema] === match[1]);
  const mapping = BY_FIELD.get(match[3]);
  if (declared_schema === undefined || mapping === undefined || mapping.category !== match[2]) return undefined;
  return { predicate, declared_schema, mapping };
}

export interface LedgerFieldRecord {
  field: string;
  category: string;
  value_kind: string;
  declared_values: string[];
}

/**
 * Read the `fields:` block of the artifact-header ledger.
 *
 * Deliberately narrow: it accepts exactly the block layout the ledger uses —
 * two-space field keys, four-space `category:` / `value_kind:` scalars, and a
 * six-space `declared_values:` map — and reports anything it cannot place
 * rather than guessing. It reads; it never decides what a field means.
 */
export function readLedgerFields(ledgerText: string): { fields: LedgerFieldRecord[]; problems: string[] } {
  const lines = ledgerText.split(/\r?\n/);
  const start = lines.indexOf("fields:");
  if (start < 0) return { fields: [], problems: ["ledger has no top-level `fields:` block"] };
  const fields: LedgerFieldRecord[] = [];
  const problems: string[] = [];
  let current: LedgerFieldRecord | undefined;
  let inDeclaredValues = false;
  for (const line of lines.slice(start + 1)) {
    if (line.length > 0 && !line.startsWith(" ")) break;
    const field = /^ {2}([a-z_]+):\s*$/.exec(line);
    if (field) {
      current = { field: field[1], category: "", value_kind: "", declared_values: [] };
      fields.push(current);
      inDeclaredValues = false;
      continue;
    }
    const scalar = /^ {4}(category|value_kind):\s*(\S+)\s*$/.exec(line);
    if (scalar && current) {
      current[scalar[1] as "category" | "value_kind"] = scalar[2];
      inDeclaredValues = false;
      continue;
    }
    if (/^ {4}declared_values:\s*$/.test(line)) {
      inDeclaredValues = true;
      continue;
    }
    const value = /^ {6}([a-z_]+):/.exec(line);
    if (value && inDeclaredValues && current) {
      current.declared_values.push(value[1]);
      continue;
    }
    if (/^ {4}\S/.test(line)) inDeclaredValues = false;
  }
  for (const record of fields) {
    if (!record.category || !record.value_kind) problems.push(`ledger field ${record.field} has no category or value_kind`);
  }
  return { fields, problems };
}

/**
 * Compare this mapping with the ledger text it claims to transcribe.
 *
 * Returns every disagreement: a field missing on either side, a different
 * category or value kind, or a different declared value set. Empty means the
 * table is an exact transcription of the ledger's field definitions.
 */
export function compareMappingToLedger(ledgerText: string): string[] {
  const { fields, problems } = readLedgerFields(ledgerText);
  const out = [...problems];
  const ledger = new Map(fields.map((record) => [record.field, record]));
  for (const mapping of NATIVE_HEADER_FIELDS) {
    const record = ledger.get(mapping.field);
    if (!record) {
      out.push(`mapping field ${mapping.field} is not defined by the ledger`);
      continue;
    }
    if (record.category !== mapping.category) {
      out.push(`field ${mapping.field}: mapping category ${mapping.category}, ledger ${record.category}`);
    }
    if (record.value_kind !== mapping.value_kind) {
      out.push(`field ${mapping.field}: mapping value_kind ${mapping.value_kind}, ledger ${record.value_kind}`);
    }
    const mine = [...(mapping.declared_values ?? [])].sort(compareCodePoints).join(",");
    const theirs = [...record.declared_values].sort(compareCodePoints).join(",");
    if (mine !== theirs) out.push(`field ${mapping.field}: declared values [${mine}] vs ledger [${theirs}]`);
  }
  for (const record of fields) {
    if (!BY_FIELD.has(record.field)) out.push(`ledger field ${record.field} has no mapping entry`);
  }
  return out.sort(compareCodePoints);
}

/**
 * Everything the mapping decides, as plain data. The interpretation profile
 * hashes this, so a change to any meaning, cardinality, schema or policy moves
 * the profile hash and with it every packet's semantic identity.
 */
export function semanticMappingIdentity(): Record<string, unknown> {
  return {
    id: SEMANTIC_MAPPING_ID,
    version: SEMANTIC_MAPPING_VERSION,
    ledger: ARTIFACT_HEADER_LEDGER,
    schemas: RECOGNIZED_DECLARED_SCHEMAS,
    policy: HEADER_DECLARATION_POLICY,
    fields: NATIVE_HEADER_FIELDS,
  };
}
