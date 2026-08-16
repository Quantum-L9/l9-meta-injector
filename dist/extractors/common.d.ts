import { AssertionDraft, InterpretedSourceRange } from "../interpretation";
/** Split preserving 1-based line numbering; no trailing-newline phantom line. */
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
/** A `key: value` pair at any indentation, or null when the line is not one. */
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
