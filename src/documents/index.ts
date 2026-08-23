// index.ts — the decoders this release ships, and the formats it refuses.
//
// Two lists matter here and they are both closed. `defaultDecoderRegistry`
// decides what can be read; `UNSUPPORTED_LEGACY_EXTENSIONS` names what cannot,
// so an operator meeting an old `.doc` gets told it is an unsupported legacy
// format rather than finding it silently absent from every count.
//
// The refusal list is deliberate about what it will not do. Converting a `.doc`
// by shelling out to a converter would turn a read-only observer into a process
// launcher, and the guess it produced would carry no provenance worth having.
import { DecoderRegistry } from "./decoder";
import { csvDecoder, textDecoder } from "./text";
import { docxDecoder, pptxDecoder, xlsxDecoder } from "./office";
import { htmlDecoder } from "./html";
import { notebookDecoder } from "./notebook";
import { pdfDecoder } from "./pdf";

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
export const UNSUPPORTED_LEGACY_EXTENSIONS: readonly string[] = [
  ".doc", ".epub", ".key", ".numbers", ".odp", ".ods", ".odt",
  ".pages", ".ppt", ".rtf", ".wpd", ".xls",
];

/** Formats that hold no text layer at all and need OCR to say anything. */
export const OCR_CANDIDATE_EXTENSIONS: readonly string[] = [
  ".bmp", ".gif", ".heic", ".heif", ".jpeg", ".jpg",
  ".png", ".tif", ".tiff", ".webp",
];

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
export const PROSE_DOCUMENT_FORMATS: readonly string[] = [
  "csv", "docx", "html", "ipynb", "pdf", "pptx", "xlsx",
];

/** Whether a decoded document of this format enters lexical analysis. */
export function isProseDocumentFormat(format: string): boolean {
  return PROSE_DOCUMENT_FORMATS.includes(format);
}

/** The registry every corpus run uses unless a caller supplies its own. */
export function defaultDecoderRegistry(): DecoderRegistry {
  const registry = new DecoderRegistry();
  registry.register(textDecoder);
  registry.register(csvDecoder);
  registry.register(notebookDecoder);
  registry.register(htmlDecoder);
  registry.register(pdfDecoder);
  registry.register(docxDecoder);
  registry.register(pptxDecoder);
  registry.register(xlsxDecoder);
  return registry;
}

/** `id@version` for every shipped decoder: the analysis-identity contribution. */
export function decoderProfile(): string[] {
  return defaultDecoderRegistry().profile();
}
