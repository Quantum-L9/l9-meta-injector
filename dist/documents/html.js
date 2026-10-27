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
const text_1 = require("./text");
exports.HTML_DECODER_ID = "l9.html-decoder";
// 1.1.0: a `>` inside a quoted attribute value no longer ends the tag.
// 1.2.0: script/style and the other raw-text elements are read to their end tag
// without recognising markup inside them; text outside a block element becomes
// a paragraph of its enclosing element; `<br>` is a line break; a table cell
// keeps the text of the blocks nested in it; HTML named references decode.
exports.HTML_DECODER_VERSION = "1.2.0";
/** Elements whose contents are never text. */
const OPAQUE = new Set([
    "script", "style", "noscript", "template", "svg", "canvas", "iframe", "object", "embed", "noembed", "noframes",
]);
/**
 * Elements whose contents HTML reads as text up to their own end tag, with no
 * markup recognised inside. A `<` in a script is a less-than sign, not a tag;
 * reading it as one swallowed the rest of the page. `title` and `textarea` are
 * the escapable kind — references are decoded — the rest are literal.
 */
const RAW_TEXT = new Set(["script", "style", "xmp", "iframe", "noembed", "noframes"]);
const ESCAPABLE_RAW_TEXT = new Set(["title", "textarea"]);
/**
 * Elements that begin or end a block of text. Character data between two of
 * these boundaries that no block element claims is still prose the page shows,
 * so it becomes a paragraph of its enclosing element rather than vanishing.
 */
const BLOCK_BOUNDARIES = new Set([
    "address", "article", "aside", "body", "center", "details", "dialog", "dir", "div", "dl", "fieldset",
    "figure", "footer", "form", "header", "hgroup", "hr", "html", "legend", "main", "menu", "nav", "ol",
    "section", "summary", "table", "tbody", "tfoot", "thead", "tr", "ul",
]);
/**
 * The HTML 4.01 named character references (plus `apos`), which is what saved
 * pages overwhelmingly use: `&nbsp;`, `&mdash;`, `&rsquo;`. A fixed table — a
 * reference is looked up, never expanded — so a page cannot define one. Names
 * outside it are left as written, which is honest about what was not decoded.
 * `lang`/`rang` take their current WHATWG code points.
 */
const LATIN1_NAMES = ("nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute "
    + "micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring "
    + "AElig Ccedil Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml "
    + "times Oslash Ugrave Uacute Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil "
    + "egrave eacute ecirc euml igrave iacute icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash "
    + "ugrave uacute ucirc uuml yacute thorn yuml").split(" ");
const OTHER_NAMES = [
    ["quot", 34], ["amp", 38], ["apos", 39], ["lt", 60], ["gt", 62],
    ["OElig", 338], ["oelig", 339], ["Scaron", 352], ["scaron", 353], ["Yuml", 376], ["fnof", 402],
    ["circ", 710], ["tilde", 732],
    ["Alpha", 913], ["Beta", 914], ["Gamma", 915], ["Delta", 916], ["Epsilon", 917], ["Zeta", 918], ["Eta", 919],
    ["Theta", 920], ["Iota", 921], ["Kappa", 922], ["Lambda", 923], ["Mu", 924], ["Nu", 925], ["Xi", 926],
    ["Omicron", 927], ["Pi", 928], ["Rho", 929], ["Sigma", 931], ["Tau", 932], ["Upsilon", 933], ["Phi", 934],
    ["Chi", 935], ["Psi", 936], ["Omega", 937],
    ["alpha", 945], ["beta", 946], ["gamma", 947], ["delta", 948], ["epsilon", 949], ["zeta", 950], ["eta", 951],
    ["theta", 952], ["iota", 953], ["kappa", 954], ["lambda", 955], ["mu", 956], ["nu", 957], ["xi", 958],
    ["omicron", 959], ["pi", 960], ["rho", 961], ["sigmaf", 962], ["sigma", 963], ["tau", 964], ["upsilon", 965],
    ["phi", 966], ["chi", 967], ["psi", 968], ["omega", 969], ["thetasym", 977], ["upsih", 978], ["piv", 982],
    ["ensp", 8194], ["emsp", 8195], ["thinsp", 8201], ["zwnj", 8204], ["zwj", 8205], ["lrm", 8206], ["rlm", 8207],
    ["ndash", 8211], ["mdash", 8212], ["lsquo", 8216], ["rsquo", 8217], ["sbquo", 8218], ["ldquo", 8220],
    ["rdquo", 8221], ["bdquo", 8222], ["dagger", 8224], ["Dagger", 8225], ["bull", 8226], ["hellip", 8230],
    ["permil", 8240], ["prime", 8242], ["Prime", 8243], ["lsaquo", 8249], ["rsaquo", 8250], ["oline", 8254],
    ["frasl", 8260], ["euro", 8364], ["image", 8465], ["weierp", 8472], ["real", 8476], ["trade", 8482],
    ["alefsym", 8501], ["larr", 8592], ["uarr", 8593], ["rarr", 8594], ["darr", 8595], ["harr", 8596],
    ["crarr", 8629], ["lArr", 8656], ["uArr", 8657], ["rArr", 8658], ["dArr", 8659], ["hArr", 8660],
    ["forall", 8704], ["part", 8706], ["exist", 8707], ["empty", 8709], ["nabla", 8711], ["isin", 8712],
    ["notin", 8713], ["ni", 8715], ["prod", 8719], ["sum", 8721], ["minus", 8722], ["lowast", 8727],
    ["radic", 8730], ["prop", 8733], ["infin", 8734], ["ang", 8736], ["and", 8743], ["or", 8744], ["cap", 8745],
    ["cup", 8746], ["int", 8747], ["there4", 8756], ["sim", 8764], ["cong", 8773], ["asymp", 8776], ["ne", 8800],
    ["equiv", 8801], ["le", 8804], ["ge", 8805], ["sub", 8834], ["sup", 8835], ["nsub", 8836], ["sube", 8838],
    ["supe", 8839], ["oplus", 8853], ["otimes", 8855], ["perp", 8869], ["sdot", 8901], ["lceil", 8968],
    ["rceil", 8969], ["lfloor", 8970], ["rfloor", 8971], ["lang", 0x27e8], ["rang", 0x27e9], ["loz", 9674],
    ["spades", 9824], ["clubs", 9827], ["hearts", 9829], ["diams", 9830],
];
const NAMED_REFERENCES = new Map([
    ...LATIN1_NAMES.map((name, index) => [name, String.fromCodePoint(160 + index)]),
    ...OTHER_NAMES.map(([name, code]) => [name, String.fromCodePoint(code)]),
]);
/**
 * Decode HTML character references in one pass: named references from the
 * fixed table, decimal and hexadecimal numeric references. What a replacement
 * produces is never scanned again, so `&amp;nbsp;` is `&nbsp;`, not a space.
 */
function decodeHtmlText(raw) {
    if (!raw.includes("&"))
        return raw;
    return raw.replace(/&(#[xX][0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body) => {
        if (body.startsWith("#")) {
            const hex = body[1] === "x" || body[1] === "X";
            const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
        }
        return NAMED_REFERENCES.get(body) ?? match;
    });
}
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
const rawTextEndPatterns = new Map();
/** `</name` followed by whitespace, `/` or `>`, matched case-insensitively. */
function rawTextEnd(name) {
    let pattern = rawTextEndPatterns.get(name);
    if (pattern === undefined) {
        pattern = new RegExp(`</${name}(?=[\\s/>])`, "gi");
        rawTextEndPatterns.set(name, pattern);
    }
    return pattern;
}
/** Attributes, tolerant of unquoted values as real-world HTML uses them. */
function parseHtmlAttributes(raw) {
    const attributes = {};
    const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)(?:\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
    let match = pattern.exec(raw);
    while (match !== null) {
        const value = match[3] ?? match[4] ?? match[5] ?? "";
        attributes[match[1].toLowerCase()] = decodeHtmlText(value);
        match = pattern.exec(raw);
    }
    return attributes;
}
/**
 * The index of the `>` that ends the tag opened at `from`, or -1.
 *
 * An attribute value may hold an unescaped `>` when it is quoted. Following the
 * HTML attribute states, a quote opens a value only where a value may begin —
 * right after `=`, optionally past whitespace — so the apostrophe in an unquoted
 * `title=it's` is an ordinary character and does not swallow the rest of the
 * page. One linear pass.
 */
function htmlTagEnd(source, from) {
    let quote = "";
    let afterEquals = false;
    for (let index = from; index < source.length; index += 1) {
        const char = source[index];
        if (quote.length > 0) {
            if (char === quote)
                quote = "";
            continue;
        }
        if (char === ">")
            return index;
        if (char === "=") {
            afterEquals = true;
        }
        else if (afterEquals && (char === '"' || char === "'")) {
            quote = char;
            afterEquals = false;
        }
        else if (!/\s/.test(char)) {
            afterEquals = false;
        }
    }
    return -1;
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
        const close = htmlTagEnd(source, open + 1);
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
            continue;
        }
        const escapable = ESCAPABLE_RAW_TEXT.has(name);
        if (RAW_TEXT.has(name) || escapable) {
            // One forward search for this element's end tag; the contents are text
            // whatever they look like.
            const end = rawTextEnd(name);
            end.lastIndex = cursor;
            const found = end.exec(source);
            if (found === null) {
                tokens.push({
                    kind: "text", name: "", attributes: {}, text: source.slice(cursor),
                    rawText: { element: name, terminated: false, escapable },
                });
                break;
            }
            if (found.index > cursor) {
                tokens.push({
                    kind: "text", name: "", attributes: {}, text: source.slice(cursor, found.index),
                    rawText: { element: name, terminated: true, escapable },
                });
            }
            tokens.push({ kind: "close", name, attributes: {}, text: "" });
            const tagClose = htmlTagEnd(source, found.index + 2 + name.length);
            cursor = tagClose < 0 ? source.length : tagClose + 1;
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
        // Text no block element claims: a paragraph of the element it sits in.
        let loose = null;
        // The innermost open table cell, which keeps every piece of text beneath it
        // — including text inside blocks nested in the cell — for the table row.
        const cells = [];
        let tableDepth = 0;
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
                builder.add(kind, text, { kind: "html_node", node_path: pending.path, node_index: nodeIndex });
            }
            pending = null;
        };
        const flushLoose = () => {
            if (loose === null)
                return;
            const text = loose.parts.join("");
            if (text.trim().length > 0) {
                nodeIndex += 1;
                builder.add("paragraph", text, { kind: "html_node", node_path: loose.path, node_index: nodeIndex });
            }
            loose = null;
        };
        /** Close the innermost cell into the current row. */
        const finishCell = () => {
            const cell = cells.pop();
            if (cell !== undefined)
                tableRow.push(cell.parts.join("").trim());
        };
        /** Close a cell left open in the current table, as an omitted end tag does. */
        const finishOpenCell = () => {
            const top = cells[cells.length - 1];
            if (top !== undefined && top.tableDepth === tableDepth)
                finishCell();
        };
        /** Where a piece of text goes: the open block, or a loose paragraph. */
        const appendText = (text) => {
            const cell = cells[cells.length - 1];
            if (cell !== undefined)
                cell.parts.push(text);
            if (pending !== null) {
                pending.parts.push(text);
                return;
            }
            if (stack.includes("head"))
                return;
            if (loose === null) {
                if (text.trim().length === 0)
                    return;
                loose = { path: stack.join("/"), parts: [] };
            }
            loose.parts.push(text);
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
                if (token.name === "br") {
                    // A line break, not a fused word. Void: its close token follows.
                    appendText("\n");
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
                    finishOpenCell();
                    tableDepth += 1;
                    tableRows = [];
                }
                if (token.name === "tr") {
                    finishOpenCell();
                    tableRow = [];
                }
                if (token.name === "td" || token.name === "th") {
                    finishOpenCell();
                    cells.push({ parts: [], tableDepth });
                }
                const kind = BLOCK_ELEMENTS[token.name];
                if (kind !== undefined || BLOCK_BOUNDARIES.has(token.name))
                    flushLoose();
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
                if (token.rawText !== undefined && !token.rawText.terminated) {
                    builder.note({
                        code: "decoder.malformed",
                        severity: "warning",
                        message: `<${token.rawText.element}> is never closed, so everything after it is its content`
                            + (OPAQUE.has(token.rawText.element) ? " and was skipped" : ""),
                    });
                }
                if (opaqueDepth > 0)
                    continue;
                // Literal raw text (`xmp`) is shown as written; everything else
                // carries references.
                const text = token.rawText !== undefined && !token.rawText.escapable
                    ? token.text
                    : decodeHtmlText(token.text);
                if (inTitle) {
                    titleParts.push(text);
                    continue;
                }
                if (anchorHref !== null)
                    anchorText.push(text);
                appendText(text);
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
            if (BLOCK_ELEMENTS[token.name] !== undefined || BLOCK_BOUNDARIES.has(token.name))
                flushLoose();
            if (pending !== null && pending.name === token.name)
                flushPending();
            if (token.name === "td" || token.name === "th")
                finishOpenCell();
            if (token.name === "tr") {
                finishOpenCell();
                if (tableRow.length > 0)
                    tableRows.push(tableRow);
                tableRow = [];
            }
            if (token.name === "table") {
                finishOpenCell();
                tableDepth = Math.max(0, tableDepth - 1);
                if (tableRows.length > 0) {
                    nodeIndex += 1;
                    builder.addTable(tableRows, {
                        kind: "html_node",
                        node_path: stack.join("/"),
                        node_index: nodeIndex,
                    });
                    tableRows = [];
                }
            }
            const index = stack.lastIndexOf(token.name);
            if (index >= 0)
                stack.splice(index);
        }
        flushLoose();
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