"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NATIVE_HEADER_FIELDS = exports.HEADER_DECLARATION_POLICY = exports.RECOGNIZED_DECLARED_SCHEMAS = exports.ARTIFACT_HEADER_LEDGER = exports.SEMANTIC_MAPPING_VERSION = exports.SEMANTIC_MAPPING_ID = void 0;
exports.headerFieldMapping = headerFieldMapping;
exports.headerFieldPredicate = headerFieldPredicate;
exports.governedHeaderPredicates = governedHeaderPredicates;
exports.governedMeaningOf = governedMeaningOf;
exports.readLedgerFields = readLedgerFields;
exports.readProjectionBoundary = readProjectionBoundary;
exports.compareMappingToLedger = compareMappingToLedger;
exports.semanticMappingIdentity = semanticMappingIdentity;
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
const ordering_1 = require("./ordering");
exports.SEMANTIC_MAPPING_ID = "meta-injector-native-header-semantics";
exports.SEMANTIC_MAPPING_VERSION = "1.0.0";
/** The ledger every entry transcribes, cited by the digest this repository binds. */
exports.ARTIFACT_HEADER_LEDGER = {
    artifact_id: "l9.artifact-header-model/global@1",
    digest: "sha256:0f9e32651b71ebfe19b57735567e06666a91b9c3b3936f149f6cac309d6d6bf1",
    release: "v3.27.0",
    decision: "ADR-024",
};
/** The declared schemas a field meaning applies under, and the predicate namespace of each. */
exports.RECOGNIZED_DECLARED_SCHEMAS = {
    "l9_schema:1": "l9v1",
    "l9_schema:2": "l9v2",
};
/** Policy applying to every entry; stated once so no entry can drift from it. */
exports.HEADER_DECLARATION_POLICY = {
    subject_scope: "artifact",
    evidence_class: "declared",
    authority: "source",
    object_normalization: "verbatim",
    projection: "none",
    conflict: { single: "preserve-all-and-conflict", set: "aggregate-distinct" },
    unknown: "unresolved-or-empty-value-preserved-as-unresolved-field",
    outside_vocabulary: "preserved-as-unsupported-field-without-meaning",
    unrecognized_schema: "key-preserved-without-meaning",
    authority_requirements: "none to hold the claim; any projection requires a separate admitted decision naming the relation owner",
};
const CARDINALITY = {
    label: "single",
    path: "single",
    url: "single",
    count: "single",
    text: "single",
    label_list: "set",
    reference_list: "set",
};
function entry(field, category, value_kind, declared_values) {
    return {
        field,
        category,
        value_kind,
        cardinality: CARDINALITY[value_kind],
        ledger_ref: `${exports.ARTIFACT_HEADER_LEDGER.artifact_id}#fields.${field}`,
        ...(declared_values ? { declared_values } : {}),
    };
}
/** The ledger's `fields`, in its order. Thirty entries: 11 identity, 6 classification, 5 governance, 8 retrieval. */
exports.NATIVE_HEADER_FIELDS = [
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
const BY_FIELD = new Map(exports.NATIVE_HEADER_FIELDS.map((mapping) => [mapping.field, mapping]));
/** The governing mapping for a field key, or undefined when the ledger defines none. */
function headerFieldMapping(field) {
    return BY_FIELD.get(field);
}
/** The predicate a field is emitted under, for one recognized declared schema. */
function headerFieldPredicate(namespace, mapping) {
    return `meta.${namespace}.${mapping.category}.${mapping.field}`;
}
/**
 * Every predicate that carries a governed meaning, one per field per recognized
 * schema, in code-point order. Anything else the extractor emits under `meta.` is
 * structural (carrier, schema) or deliberately meaningless (unresolved,
 * unsupported and unversioned fields).
 */
function governedHeaderPredicates() {
    const out = [];
    for (const [declared_schema, namespace] of Object.entries(exports.RECOGNIZED_DECLARED_SCHEMAS)) {
        for (const mapping of exports.NATIVE_HEADER_FIELDS) {
            out.push({ predicate: headerFieldPredicate(namespace, mapping), declared_schema, mapping });
        }
    }
    return out.sort((left, right) => (0, ordering_1.compareCodePoints)(left.predicate, right.predicate));
}
/** Resolve an emitted predicate back to its governed meaning, or undefined. */
function governedMeaningOf(predicate) {
    const match = /^meta\.([a-z0-9]+)\.(identity|classification|governance|retrieval)\.([a-z_]+)$/.exec(predicate);
    if (!match)
        return undefined;
    const declared_schema = Object.keys(exports.RECOGNIZED_DECLARED_SCHEMAS).find((schema) => exports.RECOGNIZED_DECLARED_SCHEMAS[schema] === match[1]);
    const mapping = BY_FIELD.get(match[3]);
    if (declared_schema === undefined || mapping?.category !== match[2])
        return undefined;
    return { predicate, declared_schema, mapping };
}
/**
 * Read the `fields:` block of the artifact-header ledger.
 *
 * Deliberately narrow: it accepts exactly the block layout the ledger uses —
 * two-space field keys, four-space `category:` / `value_kind:` scalars, and a
 * six-space `declared_values:` map — and reports anything it cannot place
 * rather than guessing. It reads; it never decides what a field means.
 */
function readLedgerFields(ledgerText) {
    const lines = ledgerText.split(/\r?\n/);
    const start = lines.indexOf("fields:");
    if (start < 0)
        return { fields: [], problems: ["ledger has no top-level `fields:` block"] };
    const state = { fields: [], inDeclaredValues: false };
    for (const line of lines.slice(start + 1)) {
        if (line.length > 0 && !line.startsWith(" "))
            break;
        readLedgerLine(state, line);
    }
    const problems = state.fields
        .filter((record) => !record.category || !record.value_kind)
        .map((record) => `ledger field ${record.field} has no category or value_kind`);
    return { fields: state.fields, problems };
}
/** Apply one line of the `fields:` block to the reader's state. */
function readLedgerLine(state, line) {
    const field = /^ {2}([a-z_]+):\s*$/.exec(line);
    if (field) {
        state.current = { field: field[1], category: "", value_kind: "", declared_values: [] };
        state.fields.push(state.current);
        state.inDeclaredValues = false;
        return;
    }
    const scalar = /^ {4}(category|value_kind):\s*(\S+)\s*$/.exec(line);
    if (scalar && state.current) {
        state.current[scalar[1]] = scalar[2];
        state.inDeclaredValues = false;
        return;
    }
    if (/^ {4}declared_values:\s*$/.test(line)) {
        state.inDeclaredValues = true;
        return;
    }
    const value = /^ {6}([a-z_]+):/.exec(line);
    if (value && state.inDeclaredValues && state.current) {
        state.current.declared_values.push(value[1]);
        return;
    }
    if (/^ {4}\S/.test(line))
        state.inDeclaredValues = false;
}
/**
 * The ledger's `projection_boundary.canonical_relations` scalar, or undefined
 * when the block or the key is absent. Same narrow layout rule as the fields
 * reader: a top-level `projection_boundary:` and a two-space key under it.
 */
function readProjectionBoundary(ledgerText) {
    const lines = ledgerText.split(/\r?\n/);
    const start = lines.indexOf("projection_boundary:");
    if (start < 0)
        return undefined;
    for (const line of lines.slice(start + 1)) {
        if (line.length > 0 && !line.startsWith(" "))
            break;
        const match = /^ {2}canonical_relations:\s*(\S+)\s*$/.exec(line);
        if (match)
            return match[1];
    }
    return undefined;
}
/**
 * Compare this mapping with the ledger text it claims to transcribe.
 *
 * Returns every disagreement: a field missing on either side, a different
 * category or value kind, a different declared value set, or a projection
 * boundary that no longer admits only `none` — the mapping's `projection: none`
 * is transcribed from it, so a ledger that changed it must not verify. Empty
 * means the table is an exact transcription of the ledger it cites.
 */
function compareMappingToLedger(ledgerText) {
    const { fields, problems } = readLedgerFields(ledgerText);
    const out = [...problems];
    const boundary = readProjectionBoundary(ledgerText);
    if (boundary === undefined) {
        out.push("ledger has no projection_boundary.canonical_relations");
    }
    else if (boundary !== exports.HEADER_DECLARATION_POLICY.projection) {
        out.push(`ledger projection_boundary.canonical_relations is ${boundary}, mapping projection is ${exports.HEADER_DECLARATION_POLICY.projection}`);
    }
    const ledger = new Map(fields.map((record) => [record.field, record]));
    for (const mapping of exports.NATIVE_HEADER_FIELDS) {
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
        const mine = [...(mapping.declared_values ?? [])].sort(ordering_1.compareCodePoints).join(",");
        const theirs = [...record.declared_values].sort(ordering_1.compareCodePoints).join(",");
        if (mine !== theirs)
            out.push(`field ${mapping.field}: declared values [${mine}] vs ledger [${theirs}]`);
    }
    for (const record of fields) {
        if (!BY_FIELD.has(record.field))
            out.push(`ledger field ${record.field} has no mapping entry`);
    }
    return out.sort(ordering_1.compareCodePoints);
}
/**
 * Everything the mapping decides, as plain data. The interpretation profile
 * hashes this, so a change to any meaning, cardinality, schema or policy moves
 * the profile hash and with it every packet's semantic identity.
 */
function semanticMappingIdentity() {
    return {
        id: exports.SEMANTIC_MAPPING_ID,
        version: exports.SEMANTIC_MAPPING_VERSION,
        ledger: exports.ARTIFACT_HEADER_LEDGER,
        schemas: exports.RECOGNIZED_DECLARED_SCHEMAS,
        policy: exports.HEADER_DECLARATION_POLICY,
        fields: exports.NATIVE_HEADER_FIELDS,
    };
}
//# sourceMappingURL=semantic_mapping.js.map