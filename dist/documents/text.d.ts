import { DecodeInput, DocumentDecoder } from "./decoder";
export declare const TEXT_DECODER_ID = "l9.text-decoder";
export declare const TEXT_DECODER_VERSION = "1.0.0";
export declare const CSV_DECODER_ID = "l9.csv-decoder";
export declare const CSV_DECODER_VERSION = "1.0.0";
/** Read a file as UTF-8, refusing bytes that are not valid UTF-8. */
export declare function readUtf8(input: DecodeInput): {
    text: string;
} | {
    reason: string;
};
export declare const textDecoder: DocumentDecoder;
/**
 * Split one CSV line, honouring RFC 4180 quoting.
 *
 * Written out rather than split on commas because a project tracker's "Blocked
 * by: procurement, legal" cell is exactly the case a naive split corrupts, and a
 * corrupted cell becomes a corrupted work signal.
 */
export declare function splitCsvLine(line: string, delimiter: string): string[];
export declare const csvDecoder: DocumentDecoder;
