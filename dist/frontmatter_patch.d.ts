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
export interface FrontMatterField {
    key: string;
    value: unknown;
    kind: "scalar" | "sequence";
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
export declare function patchManagedFrontMatter(raw: string, managed: Record<string, unknown>): FrontMatterPatchResult;
