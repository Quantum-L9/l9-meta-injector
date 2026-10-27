import { DocumentDecoder } from "./decoder";
export declare const PDF_DECODER_ID = "l9.pdf-decoder";
export declare const PDF_DECODER_VERSION = "1.1.0";
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
/** Code-to-text lookup, as a ToUnicode map or a merge of several answers it. */
interface CodeLookup {
    get(code: number): string | undefined;
}
/** One `bfrange` row: codes `low..high` map to `dest` plus the code's offset. */
interface CodeRange {
    low: number;
    high: number;
    dest: string;
}
/**
 * A parsed ToUnicode CMap.
 *
 * `bfchar` rows are kept as entries and `bfrange` rows as ranges looked up on
 * demand. A range row overrides a `bfchar` row for the same code, and a later
 * range row overrides an earlier one, as they always have.
 */
declare class ToUnicodeMap implements CodeLookup {
    private readonly chars;
    private readonly segments;
    constructor(chars: Map<number, string>, ranges: CodeRange[]);
    /** Number of rows that map something; zero means the CMap mapped nothing. */
    get size(): number;
    get(code: number): string | undefined;
}
/**
 * A font's ToUnicode CMap: the byte codes it uses and what they mean.
 *
 * Without one, a composite font's codes are indices into a glyph table and mean
 * nothing outside the file. This is what makes text from a modern PDF readable
 * rather than mojibake.
 */
declare function parseToUnicode(cmap: string): ToUnicodeMap;
/** Text-showing operators, turned into the strings they show. */
declare function extractContentText(content: string, toUnicode: CodeLookup | null): string[];
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
