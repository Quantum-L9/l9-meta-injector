"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.htmlDecoder = exports.HTML_DECODER_VERSION = exports.HTML_DECODER_ID = void 0;
exports.tokenizeHtml = tokenizeHtml;
// html.ts — saved web pages, read as text and never as a program.
//
// An archive is full of saved pages: a design doc exported from a wiki, a
// specification someone saved before the site went down. Reading them is worth
// doing and the danger is entirely in what a reader might be tempted to do next.
// This one never executes a script, never resolves a stylesheet, never fetches an
// image, and never follows a link. `<script>` and `<style>` contents are dropped
// rather than treated as text, because a page's JavaScript is not prose and
// indexing it would fill the corpus with minified noise.
//
// A locator here is a node path — `html/body/div/h1` with an ordinal — because
// that is the coordinate HTML has. Line numbers in the source markup would be
// technically available and would point at a place nobody looks.
const decoder_1 = require("./decoder");
const xml_1 = require("./xml");
const text_1 = require("./text");
exports.HTML_DECODER_ID = "l9.html-decoder";
exports.HTML_DECODER_VERSION = "1.0.0";
/** Elements whose contents are never text. */
const OPAQUE = new Set(["script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed"]);
/** Elements that close themselves, so an unclosed one is not a nesting error. */
const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input",
    "link", "meta", "param", "source", "track", "wbr",
]);
/** Which block kind an element produces, when it produces one. */
const BLOCK_ELEMENTS = {
    h1: "heading",
    h2: "heading",
    h3: "heading",
    h4: "heading",
    h5: "heading",
    h6: "heading",
    p: "paragraph",
    li: "list_item",
    pre: "code",
    code: "code",
    blockquote: "paragraph",
    dd: "paragraph",
    dt: "list_item",
    figcaption: "note",
    caption: "note",
    td: "cell",
    th: "cell",
};
/** Attributes, tolerant of unquoted values as real-world HTML uses them. */
function parseHtmlAttributes(raw) {
    const attributes = {};
    const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let match = pattern.exec(raw);
    while (match !== null) {
        const value = match[3] ?? match[4] ?? match[5] ?? "";
        attributes[match[1].toLowerCase()] = (0, xml_1.decodeXmlText)(value);
        match = pattern.exec(raw);
    }
    return attributes;
}
/**
 * Tokenize HTML.
 *
 * Deliberately a tokenizer rather than a tree builder: HTML's error recovery
 * rules are a specification of their own, and this layer only needs the text and
 * the enclosing element names. An unbalanced document degrades into slightly
 * coarser blocks rather than into a wrong tree.
 */
function tokenizeHtml(source) {
    const tokens = [];
    let cursor = 0;
    while (cursor < source.length) {
        const open = source.indexOf("<", cursor);
        if (open < 0) {
            tokens.push({ kind: "text", name: "", attributes: {}, text: source.slice(cursor) });
            break;
        }
        if (open > cursor) {
            tokens.push({ kind: "text", name: "", attributes: {}, text: source.slice(cursor, open) });
        }
        if (source.startsWith("<!--", open)) {
            const end = source.indexOf("-->", open + 4);
            cursor = end < 0 ? source.length : end + 3;
            continue;
        }
        if (source.startsWith("<!", open) || source.startsWith("<?", open)) {
            const end = source.indexOf(">", open + 2);
            cursor = end < 0 ? source.length : end + 1;
            continue;
        }
        const close = source.indexOf(">", open);
        if (close < 0) {
            tokens.push({ kind: "text", name: "", attributes: {}, text: source.slice(open) });
            break;
        }
        const body = source.slice(open + 1, close);
        cursor = close + 1;
        if (body.startsWith("/")) {
            tokens.push({ kind: "close", name: body.slice(1).trim().toLowerCase(), attributes: {}, text: "" });
            continue;
        }
        const selfClosing = body.endsWith("/");
        const inner = selfClosing ? body.slice(0, -1) : body;
        const space = inner.search(/\s/);
        const name = (space < 0 ? inner : inner.slice(0, space)).trim().toLowerCase();
        if (name.length === 0)
            continue;
        const attributes = space < 0 ? {} : parseHtmlAttributes(inner.slice(space));
        tokens.push({ kind: "open", name, attributes, text: "" });
        if (selfClosing || VOID_ELEMENTS.has(name)) {
            tokens.push({ kind: "close", name, attributes: {}, text: "" });
        }
    }
    return tokens;
}
exports.htmlDecoder = {
    id: exports.HTML_DECODER_ID,
    version: exports.HTML_DECODER_VERSION,
    format: "html",
    extensions: [".html", ".htm", ".xhtml"],
    decode(input) {
        const read = (0, text_1.readUtf8)(input);
        if ("reason" in read) {
            return {
                decoded: false,
                reason: "decoder.malformed",
                message: read.reason,
                diagnostics: [{ code: "decoder.malformed", severity: "warning", message: read.reason }],
            };
        }
        const documentId = (0, decoder_1.normalizedDocumentId)({
            contentHash: input.contentHash,
            decoderId: exports.HTML_DECODER_ID,
            decoderVersion: exports.HTML_DECODER_VERSION,
        });
        const builder = new decoder_1.BlockBuilder(documentId, input.budget);
        const metadata = {};
        const stack = [];
        let opaqueDepth = 0;
        let nodeIndex = 0;
        let pending = null;
        let inTitle = false;
        let titleParts = [];
        let tableRows = [];
        let tableRow = [];
        let sawTitleBlock = false;
        let anchorHref = null;
        let anchorText = [];
        let sawScript = false;
        const flushPending = () => {
            if (pending === null)
                return;
            const text = pending.parts.join("");
            if (text.trim().length > 0) {
                nodeIndex += 1;
                // The first <h1> is the document's title when no <title> supplied one.
                const kind = pending.kind === "heading" && pending.name === "h1" && !sawTitleBlock
                    ? "title"
                    : pending.kind;
                if (kind === "title")
                    sawTitleBlock = true;
                if (pending.kind === "cell") {
                    tableRow.push(text.trim());
                }
                builder.add(kind, text, { kind: "html_node", node_path: pending.path, node_index: nodeIndex });
            }
            else if (pending.kind === "cell") {
                tableRow.push("");
            }
            pending = null;
        };
        for (const token of tokenizeHtml(read.text)) {
            if (builder.isFull)
                break;
            if (token.kind === "open") {
                if (OPAQUE.has(token.name)) {
                    if (token.name === "script" || token.name === "noscript")
                        sawScript = true;
                    opaqueDepth += 1;
                    stack.push(token.name);
                    continue;
                }
                if (opaqueDepth > 0) {
                    stack.push(token.name);
                    continue;
                }
                if (token.name === "title") {
                    inTitle = true;
                    titleParts = [];
                }
                if (token.name === "meta") {
                    const name = (token.attributes.name ?? "").toLowerCase();
                    const content = token.attributes.content ?? "";
                    if (["description", "keywords", "subject"].includes(name) && content.length > 0) {
                        metadata[name] = content;
                    }
                }
                if (token.name === "a") {
                    anchorHref = token.attributes.href ?? null;
                    anchorText = [];
                }
                if (token.name === "table") {
                    tableRows = [];
                }
                if (token.name === "tr") {
                    tableRow = [];
                }
                const kind = BLOCK_ELEMENTS[token.name];
                if (kind !== undefined) {
                    flushPending();
                    stack.push(token.name);
                    pending = { kind, name: token.name, path: stack.join("/"), parts: [] };
                    continue;
                }
                stack.push(token.name);
                continue;
            }
            if (token.kind === "text") {
                if (opaqueDepth > 0)
                    continue;
                const text = (0, xml_1.decodeXmlText)(token.text);
                if (inTitle)
                    titleParts.push(text);
                if (anchorHref !== null)
                    anchorText.push(text);
                if (pending !== null)
                    pending.parts.push(text);
                continue;
            }
            // close
            if (OPAQUE.has(token.name)) {
                opaqueDepth = Math.max(0, opaqueDepth - 1);
                const index = stack.lastIndexOf(token.name);
                if (index >= 0)
                    stack.splice(index);
                continue;
            }
            if (opaqueDepth > 0) {
                const index = stack.lastIndexOf(token.name);
                if (index >= 0)
                    stack.splice(index);
                continue;
            }
            if (token.name === "title") {
                inTitle = false;
                const title = titleParts.join("").trim();
                if (title.length > 0) {
                    metadata.title = title;
                    nodeIndex += 1;
                    builder.add("title", title, { kind: "html_node", node_path: "html/head/title", node_index: nodeIndex });
                    sawTitleBlock = true;
                }
            }
            if (token.name === "a" && anchorHref !== null) {
                nodeIndex += 1;
                builder.addLink(anchorHref, anchorText.join(""), {
                    kind: "html_node",
                    node_path: stack.join("/"),
                    node_index: nodeIndex,
                });
                anchorHref = null;
                anchorText = [];
            }
            if (pending !== null && pending.name === token.name)
                flushPending();
            if (token.name === "tr") {
                if (tableRow.length > 0)
                    tableRows.push(tableRow);
                tableRow = [];
            }
            if (token.name === "table" && tableRows.length > 0) {
                nodeIndex += 1;
                builder.addTable(tableRows, {
                    kind: "html_node",
                    node_path: stack.join("/"),
                    node_index: nodeIndex,
                });
                tableRows = [];
            }
            const index = stack.lastIndexOf(token.name);
            if (index >= 0)
                stack.splice(index);
        }
        flushPending();
        if (sawScript) {
            builder.note({
                code: "decoder.unsupported_feature",
                severity: "info",
                message: "script content was skipped and never executed",
            });
        }
        if (builder.finish().links.length > 0) {
            builder.note({
                code: "decoder.external_reference_not_followed",
                severity: "info",
                message: "links were recorded as declared references and none was fetched",
            });
        }
        return {
            decoded: true,
            document: (0, decoder_1.buildNormalizedDocument)({
                decoder: { id: exports.HTML_DECODER_ID, version: exports.HTML_DECODER_VERSION, format: "html" },
                decodeInput: input,
                documentId,
                metadata,
                builder,
            }),
        };
    },
};
//# sourceMappingURL=html.js.map