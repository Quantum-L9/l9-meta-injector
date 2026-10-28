export type InjectionStrategy = "yaml-frontmatter" | "line-comment" | "block-comment" | "sidecar" | "skip-binary";
/**
 * A construct that must stay first in its file, so the carrier is placed after it
 * (ADR-057). A shebang line is honoured for every comment strategy without one.
 */
export type CarrierPrologue = "xml-declaration" | "php-open-tag" | "encoding-cookie" | "css-charset" | "dockerfile-directives";
export interface StrategySpec {
    strategy: InjectionStrategy;
    linePrefix?: string;
    blockOpen?: string;
    blockClose?: string;
    /** Mandatory prologue the carrier follows (ADR-057). */
    prologue?: CarrierPrologue;
    /**
     * Delimiters an earlier version wrote for this file type. A head block in that
     * form is still recognised, so the next write replaces it instead of stacking a
     * second block (ADR-057).
     */
    legacyCarrier?: StrategySpec;
}
export declare const PROSE_EXTS: Set<string>;
export declare const FRONTMATTER_EXTS: Set<string>;
/** Heuristic: a NUL byte in the first 8 KB means the file is not UTF-8 text. */
export declare function isProbablyBinary(raw: string): boolean;
export declare function resolveStrategy(filePath: string, raw: string): StrategySpec;
export declare function sidecarPathFor(filePath: string): string;
/** Strip the `---` fences from a serialized frontmatter block, leaving inner YAML lines. */
export declare function frontMatterInner(yamlFrontMatter: string): string;
export type NewlineConvention = "\n" | "\r\n";
/**
 * The newline convention a text body already uses: whichever the first line
 * ending is. A file with no line ending yet is treated as LF. The injected block
 * adopts the file's convention so a CRLF source does not come back with LF
 * inside its header and CRLF everywhere else.
 */
export declare function detectNewlineConvention(text: string): NewlineConvention;
/** Wrap inner YAML in the comment style for this spec. Returns the block (no trailing newline). */
export declare function yamlToBlock(yamlInner: string, spec: StrategySpec, newline?: NewlineConvention): string;
/** Remove a previously-injected comment block, returning the clean body verbatim. */
export declare function stripInjectedBlock(raw: string, spec: StrategySpec): string;
/** Detect whether a comment-injected block is present at the carrier position. */
export declare function hasInjectedBlock(raw: string, spec: StrategySpec): boolean;
/** Extract the inner YAML from an existing comment block (comment prefixes removed), or null. */
export declare function extractInjectedYaml(raw: string, spec: StrategySpec): string | null;
/**
 * Assemble the injected file for comment strategies, preserving cleanBody verbatim
 * and placing the block at the carrier position: after a BOM, a shebang and the
 * spec's mandatory prologue. Recoverable via stripInjectedBlock with the same spec.
 * Without a spec only a BOM and a shebang are honoured.
 *
 * A byte-order mark stays at byte 0: the block is inserted after it, never before,
 * because a BOM in the middle of a file is no longer a BOM. Line endings around
 * the block follow `newline`, so a CRLF file keeps a single convention. When the
 * last prologue line has no terminator, one is supplied and no newline follows the
 * block, which is how strip knows to remove it again.
 */
export declare function applyCommentInjection(cleanBody: string, block: string, newline?: NewlineConvention, spec?: StrategySpec): string;
