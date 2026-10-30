import { AssertionDraft, InterpretedSourceRange } from "../interpretation";
/**
 * Split preserving 1-based line numbering; no trailing-newline phantom line.
 *
 * CRLF, LF and a lone CR are each one line terminator, so line numbers are the
 * ones an editor shows for classic-Mac and mixed-ending files too. One leading
 * byte-order mark is not content and is dropped, so a first-line heading or
 * marker reads the same with or without it. The caller's content string (and
 * any hash of it) is untouched; only the lines handed to an extractor change.
 */
export declare function toLines(content: string): string[];
/** A single-line span. `index` is 0-based; the emitted range is 1-based. */
export declare function lineRange(index: number): InterpretedSourceRange;
export declare function spanRange(startIndex: number, endIndex: number): InterpretedSourceRange;
/** Strip matching surrounding quotes from a scalar. Leaves unquoted text alone. */
export declare function unquote(value: string): string;
/** Drop a trailing `#` comment that is not inside quotes. */
export declare function stripComment(value: string): string;
/** Indentation width in spaces. Tabs count as one, consistently. */
export declare function indentOf(line: string): number;
/**
 * A `key: value` pair at any indentation, or null when the line is not one.
 *
 * Only the fixed-structure prefix (indent, list marker, key, `:`) is matched; the
 * value is taken by slice. A `\s*(.*)$` tail backtracks quadratically when the
 * line holds a character `.` does not match after a long whitespace run.
 */
export declare function keyValue(line: string): {
    key: string;
    value: string;
    indent: number;
} | null;
/** Build a `declared` assertion from a source line. */
export declare function declared(predicate: string, object: string, index: number, line: string, confidence?: AssertionDraft["confidence"]): AssertionDraft;
/** Build an `observed` assertion from a source line. */
export declare function observed(predicate: string, object: string, range: InterpretedSourceRange, excerpt: string, confidence?: AssertionDraft["confidence"]): AssertionDraft;
/** True when the repository-relative path's basename equals `name`. */
export declare function basenameIs(sourcePath: string, name: string): boolean;
