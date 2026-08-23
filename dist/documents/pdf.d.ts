import { DocumentDecoder } from "./decoder";
export declare const PDF_DECODER_ID = "l9.pdf-decoder";
export declare const PDF_DECODER_VERSION = "1.0.0";
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
/**
 * A font's ToUnicode CMap: the byte codes it uses and what they mean.
 *
 * Without one, a composite font's codes are indices into a glyph table and mean
 * nothing outside the file. This is what makes text from a modern PDF readable
 * rather than mojibake.
 */
declare function parseToUnicode(cmap: string): Map<number, string>;
/** Text-showing operators, turned into the strings they show. */
declare function extractContentText(content: string, toUnicode: Map<number, string> | null): string[];
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
