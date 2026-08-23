import { DocumentDecoder } from "./decoder";
export declare const HTML_DECODER_ID = "l9.html-decoder";
export declare const HTML_DECODER_VERSION = "1.0.0";
interface HtmlToken {
    kind: "open" | "close" | "text";
    name: string;
    attributes: Record<string, string>;
    text: string;
}
/**
 * Tokenize HTML.
 *
 * Deliberately a tokenizer rather than a tree builder: HTML's error recovery
 * rules are a specification of their own, and this layer only needs the text and
 * the enclosing element names. An unbalanced document degrades into slightly
 * coarser blocks rather than into a wrong tree.
 */
export declare function tokenizeHtml(source: string): HtmlToken[];
export declare const htmlDecoder: DocumentDecoder;
export {};
