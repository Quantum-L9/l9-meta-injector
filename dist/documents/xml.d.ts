export interface XmlAttributes {
    [name: string]: string;
}
export type XmlEvent = {
    type: "open";
    name: string;
    attributes: XmlAttributes;
    selfClosing: boolean;
    depth: number;
} | {
    type: "close";
    name: string;
    depth: number;
} | {
    type: "text";
    text: string;
    depth: number;
};
export declare class XmlError extends Error {
    constructor(message: string);
}
/**
 * Resolve the entity vocabulary XML defines and nothing else.
 *
 * An unknown entity is left as written rather than resolved. A document that
 * declared its own entity is not something this parser will expand — that is the
 * expansion attack — and silently deleting the reference would misrepresent the
 * text.
 */
export declare function decodeXmlText(raw: string): string;
/** The local name of a possibly-namespaced tag: `w:p` is `p`. */
export declare function localName(name: string): string;
/**
 * Walk an XML document, handing each event to `visit`.
 *
 * Returning `false` from `visit` stops the walk, which is how a caller that has
 * filled its budget stops paying for the rest of a part.
 */
export declare function parseXml(source: string, maxDepth: number, visit: (event: XmlEvent) => boolean | void): void;
