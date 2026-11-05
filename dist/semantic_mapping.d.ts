export declare const SEMANTIC_MAPPING_ID = "meta-injector-native-header-semantics";
export declare const SEMANTIC_MAPPING_VERSION = "1.0.0";
/** The ledger every entry transcribes, cited by the digest this repository binds. */
export declare const ARTIFACT_HEADER_LEDGER: {
    readonly artifact_id: "l9.artifact-header-model/global@1";
    readonly digest: "sha256:0f9e32651b71ebfe19b57735567e06666a91b9c3b3936f149f6cac309d6d6bf1";
    readonly release: "v3.27.0";
    readonly decision: "ADR-024";
};
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
export declare const RECOGNIZED_DECLARED_SCHEMAS: Readonly<Record<string, string>>;
/** Policy applying to every entry; stated once so no entry can drift from it. */
export declare const HEADER_DECLARATION_POLICY: {
    readonly subject_scope: "artifact";
    readonly evidence_class: "declared";
    readonly authority: "source";
    readonly object_normalization: "verbatim";
    readonly projection: "none";
    readonly conflict: {
        readonly single: "preserve-all-and-conflict";
        readonly set: "aggregate-distinct";
    };
    readonly unknown: "unresolved-or-empty-value-preserved-as-unresolved-field";
    readonly outside_vocabulary: "preserved-as-unsupported-field-without-meaning";
    readonly unrecognized_schema: "key-preserved-without-meaning";
    readonly authority_requirements: "none to hold the claim; any projection requires a separate admitted decision naming the relation owner";
};
/** The ledger's `fields`, in its order. Thirty entries: 11 identity, 6 classification, 5 governance, 8 retrieval. */
export declare const NATIVE_HEADER_FIELDS: readonly HeaderFieldMapping[];
/** The governing mapping for a field key, or undefined when the ledger defines none. */
export declare function headerFieldMapping(field: string): HeaderFieldMapping | undefined;
/** The predicate a field is emitted under, for one recognized declared schema. */
export declare function headerFieldPredicate(namespace: string, mapping: HeaderFieldMapping): string;
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
export declare function governedHeaderPredicates(): GovernedPredicate[];
/** Resolve an emitted predicate back to its governed meaning, or undefined. */
export declare function governedMeaningOf(predicate: string): GovernedPredicate | undefined;
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
export declare function readLedgerFields(ledgerText: string): {
    fields: LedgerFieldRecord[];
    problems: string[];
};
/**
 * Compare this mapping with the ledger text it claims to transcribe.
 *
 * Returns every disagreement: a field missing on either side, a different
 * category or value kind, or a different declared value set. Empty means the
 * table is an exact transcription of the ledger's field definitions.
 */
export declare function compareMappingToLedger(ledgerText: string): string[];
/**
 * Everything the mapping decides, as plain data. The interpretation profile
 * hashes this, so a change to any meaning, cardinality, schema or policy moves
 * the profile hash and with it every packet's semantic identity.
 */
export declare function semanticMappingIdentity(): Record<string, unknown>;
