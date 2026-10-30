/**
 * Byte-preserving YAML-frontmatter inspection and managed-field patching.
 *
 * The patcher intentionally supports a narrow, deterministic YAML subset:
 * top-level scalar fields and top-level scalar lists. Anything ambiguous or
 * structurally richer fails closed so unrelated user-authored YAML is never
 * normalized, reordered, or silently rewritten.
 */
export declare const FRONTMATTER_PATCH_SCHEMA: "l9.frontmatter-patch/v1";
export type FrontMatterIssueCode = "FRONTMATTER_OPENING_FENCE_NOT_EXACT" | "FRONTMATTER_CLOSING_FENCE_MISSING" | "FRONTMATTER_DUPLICATE_BLOCK" | "FRONTMATTER_MIXED_NEWLINES" | "FRONTMATTER_TAB_CHARACTER" | "FRONTMATTER_DUPLICATE_KEY" | "FRONTMATTER_INVALID_KEY" | "FRONTMATTER_COMPLEX_YAML" | "FRONTMATTER_UNSUPPORTED_VALUE";
export interface FrontMatterIssue {
    code: FrontMatterIssueCode;
    message: string;
    line?: number;
    key?: string;
}
export declare function isPatcherLimitation(code: FrontMatterIssueCode): boolean;
export interface FrontMatterField {
    key: string;
    /** Absent for `opaque` fields: the value's bytes are known, its meaning is not. */
    value: unknown;
    /**
     * `opaque` is a single-line plain scalar whose text the canonical parser cannot
     * represent — an unquoted ISO timestamp, a bare URL, a `10:30` clock value. Its byte
     * range is known exactly, so it can be preserved verbatim when unmanaged and replaced
     * wholesale when managed. It is never interpreted, and never enters `meta`.
     */
    kind: "scalar" | "sequence" | "opaque";
    start: number;
    end: number;
    valueStart?: number;
    valueEnd?: number;
    commentSuffix?: string;
    sequenceIndent?: string;
    sequencePrefix?: string;
    sequenceSuffix?: string;
}
export interface FrontMatterInspection {
    safe: boolean;
    hadFrontMatter: boolean;
    bom: "" | "\uFEFF";
    newline: "\n" | "\r\n";
    body: string;
    meta: Record<string, unknown>;
    fields: FrontMatterField[];
    openingStart: number;
    openingEnd: number;
    closingStart: number;
    closingEnd: number;
    issue?: FrontMatterIssue;
}
export interface FrontMatterPatchResult extends FrontMatterInspection {
    content: string;
    changed: boolean;
    managedKeys: string[];
}
export declare function inspectFrontMatterDocument(raw: string): FrontMatterInspection;
/**
 * The verbatim value text of every `opaque` field, keyed by field name.
 *
 * Opaque values never enter `inspection.meta` (ADR-035): their meaning is not
 * established. Reconciliation still has to *see* them, or a placeholder decided
 * without them is written over a real user value — `created: 2025-10-28T15:30:00Z`
 * would lose to `Unknown` while its quoted spelling survives. This view carries the
 * exact bytes as an uninterpreted string beside `meta`, never inside it.
 */
export declare function opaqueFieldText(raw: string, inspection: FrontMatterInspection): Record<string, string>;
/**
 * The existing header values a reconciler compares against: parsed `meta` plus the
 * verbatim text of opaque fields. The two key sets are disjoint by construction.
 * A fresh object is returned; `inspection.meta` is not modified.
 */
export declare function frontMatterReconciliationView(raw: string, inspection: FrontMatterInspection): Record<string, unknown>;
export declare function patchManagedFrontMatter(raw: string, managed: Record<string, unknown>): FrontMatterPatchResult;
