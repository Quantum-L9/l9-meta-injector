import { DecoderRegistry } from "./decoder";
export * from "./decoder";
export { readUtf8, splitCsvLine, textDecoder, csvDecoder } from "./text";
export { docxDecoder, pptxDecoder, xlsxDecoder } from "./office";
export { htmlDecoder, tokenizeHtml } from "./html";
export { notebookDecoder } from "./notebook";
export { pdfDecoder, pdfInternals } from "./pdf";
export { isSafePartName, openOoxml, OoxmlError } from "./ooxml";
export { decodeXmlText, localName, parseXml, XmlError } from "./xml";
/**
 * Formats whose containers this release cannot open.
 *
 * The pre-2007 Office formats are OLE compound documents, a different container
 * entirely from the OOXML ZIP that `docxDecoder` and its siblings read. `.pages`
 * is an Apple bundle, `.odt` an OpenDocument ZIP with a different part layout,
 * `.epub` a third ZIP shape again. Each is counted explicitly in coverage: an
 * operator with a shelf of `.doc` files should see how many, not discover the
 * gap by noticing the total does not add up.
 *
 * This list and `defaultDecoderRegistry` are the two halves of one closed
 * statement, and neither may claim an extension the other does; `documentGaps`
 * in `corpus_coverage` asserts exactly that.
 */
export declare const UNSUPPORTED_LEGACY_EXTENSIONS: readonly string[];
/** Formats that hold no text layer at all and need OCR to say anything. */
export declare const OCR_CANDIDATE_EXTENSIONS: readonly string[];
/**
 * Formats whose normalized text is prose in its entirety.
 *
 * This decides which decoded documents enter the corpus's lexical analysis —
 * shingles, term counts, and through them near-duplicate and topic candidates —
 * and it is a statement about the format rather than about the extension.
 *
 * The `text` and `markdown` families are deliberately absent. Their decoder
 * claims `.ts`, `.py` and `.sql` alongside `.md` and `.txt`, and source code is
 * not prose: shingling a repository's TypeScript would report every file that
 * shares an import block as a near-duplicate of every other. Those formats keep
 * the extension gate they already had (`NEAR_DUPLICATE_EXTENSIONS`).
 *
 * Everything here is prose or tabular content by construction — a Word document,
 * a deck, a sheet, a notebook's markdown cells, a saved page, a CSV — so there is
 * no extension left to consult. Without this list a decoded `.docx` would be
 * counted in coverage and reach no candidate at all, which is a decoder that
 * looks wired and is not.
 */
export declare const PROSE_DOCUMENT_FORMATS: readonly string[];
/** Whether a decoded document of this format enters lexical analysis. */
export declare function isProseDocumentFormat(format: string): boolean;
/** The registry every corpus run uses unless a caller supplies its own. */
export declare function defaultDecoderRegistry(): DecoderRegistry;
/** `id@version` for every shipped decoder: the analysis-identity contribution. */
export declare function decoderProfile(): string[];
