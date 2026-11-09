import type { ArchitectureEvidenceRecord } from "./corpus_architecture_evidence";
import type { CorpusVerification } from "./corpus_snapshot";
/** Schema of the one response this module renders. */
export declare const CORPUS_EVIDENCE_QUERY_SCHEMA = "l9.corpus-evidence-query/v1";
/** Result ceiling a caller may ask for; a larger answer needs a narrower question. */
export declare const MAX_QUERY_LIMIT = 500;
export declare const DEFAULT_QUERY_LIMIT = 50;
/** Longest excerpt returned, in UTF-8 bytes. The source bound is characters; this is the wire bound. */
export declare const DEFAULT_MAX_EXCERPT_BYTES = 1024;
/**
 * Where a result came from inside the generation.
 *
 * `repository_model_packet` is the per-root packet's artifact-scoped assertions:
 * the line-cited work signals of text documents, which the scan files in the
 * packet rather than in the JSONL payload (ADR-043). A query that read only the
 * JSONL would answer "which documents say they are WIP" with every Word document
 * and no Markdown one.
 */
export declare const EVIDENCE_SOURCES: readonly ["architecture_evidence", "document_work_signals", "repository_model_packet"];
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];
export declare const QUERY_OUTCOMES: readonly ["ok", "empty", "incomplete", "unavailable", "unsupported", "invalid"];
export type QueryOutcome = (typeof QUERY_OUTCOMES)[number];
/** The evidence-age statement every response carries. A recorded verification is history. */
export declare const EVIDENCE_AGE_STATEMENT: string;
export declare const TRUNCATION_STATEMENT: string;
export interface EvidenceQueryInput {
    /** The corpus output root holding `CURRENT.json` and `generations/`. */
    outDir: string;
    /** A root key or root id in the pinned snapshot. */
    root?: string;
    /** A corpus artifact id (`vsrc:`), a packet artifact id (`artifact:`) or a corpus path (`Root::path`). */
    artifact?: string;
    /** Exact predicate, e.g. `work.status`. Architecture-evidence records carry none. */
    predicate?: string;
    /** Exact architecture statement class. Only `architecture_evidence` records carry one. */
    statementClass?: string;
    /** Literal, case-sensitive substring over the recorded value and excerpt. */
    text?: string;
    /** A `work.kind` value the document must have declared (any of its declarations). */
    kind?: string;
    /** A `work.status` value the document must have declared (any of its declarations). */
    status?: string;
    /** Restrict to one source. */
    source?: EvidenceSource;
    limit?: number;
    maxExcerptBytes?: number;
}
/** A declaration the document made about itself, by the assertion that made it. */
export interface DeclarationRef {
    object: string;
    assertion_id: string;
}
/**
 * One evidence record, as the generation wrote it, with the identities a reader
 * needs to resolve it. Fields are carried under the names their source uses:
 * `structured_locator` and `block_id` from the JSONL payloads, `source_range`
 * from a packet assertion. Neither is translated into the other.
 */
export interface EvidenceQueryResult {
    source: EvidenceSource;
    /** `evidence_id`, `signal_id` or `assertion_id`, as the source names it. */
    record_id: string;
    root_id: string;
    root_key: string;
    artifact_id: string;
    rmp_artifact_id: string;
    corpus_path: string;
    source_path: string;
    format: string | null;
    normalized_document_id: string | null;
    raw_content_hash: string | null;
    predicate: string | null;
    statement_class: string | null;
    /** The recorded object or declared text. */
    value: string;
    value_truncated_at_source: boolean;
    structured_locator: Record<string, unknown> | null;
    source_range: {
        start_line: number;
        end_line: number;
    } | null;
    block_id: string | null;
    block_kind: string | null;
    decoder_id: string | null;
    bounded_excerpt: string;
    /** True when the generation itself cut the excerpt at its bound. */
    excerpt_truncated_at_source: boolean;
    /** True when this query cut the excerpt at `max_excerpt_bytes`. */
    excerpt_cut_by_query: boolean;
    evidence_class: string;
    authority: string;
    confidence: string | null;
    extractor_id: string;
    epistemic_class: string;
    authority_verified: false;
    /** Every `work.kind` and `work.status` the document declared, contradictions included. */
    document_declarations: {
        kinds: DeclarationRef[];
        statuses: DeclarationRef[];
    };
    /** Carried verbatim for architecture-evidence records; null otherwise. */
    selection: ArchitectureEvidenceRecord["selection"] | null;
    recognition: ArchitectureEvidenceRecord["recognition"] | null;
}
export interface EvidenceSourceStatus {
    source: EvidenceSource;
    schema: string;
    status: "verified" | "not_run" | "refused";
    record_count: number | null;
    problems: string[];
}
export interface EvidenceQueryResponse {
    schema: string;
    query: {
        root: string | null;
        artifact: string | null;
        predicate: string | null;
        statement_class: string | null;
        text: string | null;
        kind: string | null;
        status: string | null;
        source: EvidenceSource | null;
        limit: number;
        max_excerpt_bytes: number;
    };
    generation: {
        generation_id: string;
        /** Output-relative. No absolute path ever appears in a response. */
        generation_ref: string;
        corpus_id: string;
        corpus_source_snapshot_id: string;
        corpus_analysis_id: string;
        corpus_status: string;
        missing_root_ids: string[];
        verification: CorpusVerification;
        evidence_age_statement: string;
    } | null;
    sources: EvidenceSourceStatus[];
    outcome: QueryOutcome;
    /** Records matching the query across every verified source. Null when nothing could be trusted. */
    match_count: number | null;
    returned_count: number;
    truncated: boolean;
    truncation_statement: string | null;
    results: EvidenceQueryResult[];
    diagnostics: {
        code: string;
        severity: "info" | "warning" | "error";
        message: string;
    }[];
}
/**
 * Ask one question of one generation.
 *
 * Never throws for a generation that is absent, corrupt or inconsistent: those
 * are `invalid` outcomes with the refusal named, because a caller who cannot
 * distinguish "nothing matched" from "nothing could be trusted" has been handed
 * a wrong answer with a confident shape.
 */
export declare function queryCorpusEvidence(input: EvidenceQueryInput): EvidenceQueryResponse;
/** Canonical bytes of a response: code-point key order, no clock, no absolute path. */
export declare function renderEvidenceQueryResponse(response: EvidenceQueryResponse): string;
