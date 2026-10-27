import { DocumentDecoder } from "./decoder";
export declare const PDF_DECODER_ID = "l9.pdf-decoder";
export declare const PDF_DECODER_VERSION = "1.3.0";
/** A parsed PDF dictionary. Values stay as raw slices until something needs them. */
type PdfDict = Map<string, string>;
declare function isWhitespace(byte: number): boolean;
declare function isDelimiter(byte: number): boolean;
/**
 * Split a dictionary's body into key/value text, balancing nested structures.
 *
 * A regex cannot do this: `/Font << /F1 5 0 R >>` nests, and a naive match would
 * stop at the first `>>`.
 */
export declare function parsePdfDict(body: string): PdfDict;
/** A PDF literal string, with its escape rules. */
declare function decodeLiteral(source: string): string;
/** One `bfrange` row: codes `low..high` map to `dest` plus the code's offset. */
interface CodeRange {
    low: number;
    high: number;
    dest: string;
}
/** A stretch of codes answered by one range row; stretches never overlap. */
interface CodeSegment {
    low: number;
    high: number;
    row: CodeRange;
}
/** The codes of one byte width: `bfchar` entries and flattened `bfrange` rows. */
interface WidthTable {
    chars: Map<number, string>;
    ranges: CodeRange[];
    segments: CodeSegment[];
}
/** One `begincodespacerange` row: the codes of `width` bytes from `low` to `high`. */
interface CodespaceRange {
    width: number;
    low: number;
    high: number;
}
/**
 * A parsed ToUnicode CMap.
 *
 * Codes are keyed by their byte width as well as their value: `<48>` and
 * `<0048>` are different codes, and a CMap that declares both keeps both.
 * `bfchar` rows are kept as entries and `bfrange` rows as ranges looked up on
 * demand. A range row overrides a `bfchar` row for the same code, and a later
 * range row overrides an earlier one, as they always have.
 */
declare class ToUnicodeMap {
    private readonly tables;
    /** The codespace the CMap declares; empty when it declares none. */
    readonly codespace: CodespaceRange[];
    table(width: number): WidthTable;
    /** Flatten every width's range rows once they have all been read. */
    seal(): void;
    /** Number of rows that map something; zero means the CMap mapped nothing. */
    get size(): number;
    /**
     * The text for one code of `width` bytes. Without a width, the narrowest
     * width that maps the code answers.
     */
    get(code: number, width?: number): string | undefined;
    /**
     * Split a shown string's bytes into codes by the codespace, or by
     * `defaultWidth` when the CMap declares none.
     */
    codes(bytes: number[], defaultWidth: number): {
        code: number;
        width: number;
    }[];
}
/**
 * A font's ToUnicode CMap: the byte codes it uses and what they mean.
 *
 * Without one, a composite font's codes are indices into a glyph table and mean
 * nothing outside the file. This is what makes text from a modern PDF readable
 * rather than mojibake.
 */
declare function parseToUnicode(cmap: string): ToUnicodeMap;
/** A font as the text it shows needs it: composite or simple, and its own map. */
interface PdfFont {
    /** The resource name the content stream selects it by, e.g. `/F1`. */
    label: string;
    /** A Type0 font, whose codes are glyph identifiers rather than characters. */
    composite: boolean;
    /** The font's own ToUnicode map, when it has a usable one. */
    map: ToUnicodeMap | null;
}
/**
 * What decoding a content stream learned about its fonts, so the document can
 * say per font what it could and could not read.
 */
interface TextFacts {
    /** Simple fonts without a ToUnicode map, read through their byte encoding. */
    byteEncoded: Set<string>;
    /** Composite fonts without a usable map, whose text was not read. */
    unmapped: Set<string>;
    /** Fonts selected by `Tf` that the page's resources do not define. */
    unknown: Set<string>;
    /** Shown strings dropped because their composite font has no usable map. */
    droppedRuns: number;
}
/**
 * Text-showing operators, turned into the strings they show.
 *
 * The content stream is read as PDF reads it: operands pile onto a stack and
 * each operator consumes them. That is what lets a `TJ` array's adjustments
 * become word gaps, a `Tm` on a new baseline start a new line, and `'` and `"`
 * put their string on the line they begin. Each string is decoded with the font
 * the most recent `Tf` selected, through that font's own ToUnicode map and code
 * width; a composite font with no usable map yields no text rather than its raw
 * glyph identifiers.
 *
 * Every branch advances the cursor, so malformed input — unterminated strings
 * and arrays, stray delimiters, operands with no operator — costs one pass.
 */
declare function extractContentText(content: string, resolveFont?: (name: string) => PdfFont | undefined, facts?: TextFacts): string[];
export declare const pdfDecoder: DocumentDecoder;
/** Exported for the decoder tests, which exercise the tokenizer directly. */
export declare const pdfInternals: {
    parsePdfDict: typeof parsePdfDict;
    extractContentText: typeof extractContentText;
    parseToUnicode: typeof parseToUnicode;
    decodeLiteral: typeof decodeLiteral;
    isWhitespace: typeof isWhitespace;
    isDelimiter: typeof isDelimiter;
};
export {};
