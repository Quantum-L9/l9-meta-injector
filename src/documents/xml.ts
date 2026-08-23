// xml.ts — just enough XML to read an Office part, and deliberately no more.
//
// OOXML parts are XML, so reading a `.docx` means parsing XML. This is a pull
// parser rather than a dependency because of what it refuses:
//
//   - no DTD processing and no entity declarations, so there is no XXE and no
//     billion-laughs expansion. The five predefined entities and numeric
//     character references are the whole entity vocabulary;
//   - no external resource resolution of any kind;
//   - a depth ceiling, so a part nested past it is refused rather than recursed
//     into.
//
// A general-purpose XML library would give more features and would need each of
// those properties argued for rather than held by construction.
export interface XmlAttributes {
  [name: string]: string;
}

export type XmlEvent =
  | { type: "open"; name: string; attributes: XmlAttributes; selfClosing: boolean; depth: number }
  | { type: "close"; name: string; depth: number }
  | { type: "text"; text: string; depth: number };

export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XmlError";
  }
}

const PREDEFINED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/**
 * Resolve the entity vocabulary XML defines and nothing else.
 *
 * An unknown entity is left as written rather than resolved. A document that
 * declared its own entity is not something this parser will expand — that is the
 * expansion attack — and silently deleting the reference would misrepresent the
 * text.
 */
export function decodeXmlText(raw: string): string {
  return raw.replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z][A-Za-z0-9]*);/g, (match, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return PREDEFINED_ENTITIES[body] ?? match;
  });
}

/** The local name of a possibly-namespaced tag: `w:p` is `p`. */
export function localName(name: string): string {
  const colon = name.indexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

function parseAttributes(raw: string): XmlAttributes {
  const attributes: XmlAttributes = {};
  const pattern = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let match = pattern.exec(raw);
  while (match !== null) {
    const value = match[3] ?? match[4] ?? "";
    attributes[match[1] as string] = decodeXmlText(value);
    match = pattern.exec(raw);
  }
  return attributes;
}

/**
 * Walk an XML document, handing each event to `visit`.
 *
 * Returning `false` from `visit` stops the walk, which is how a caller that has
 * filled its budget stops paying for the rest of a part.
 */
export function parseXml(
  source: string,
  maxDepth: number,
  visit: (event: XmlEvent) => boolean | void,
): void {
  let cursor = 0;
  let depth = 0;
  const length = source.length;

  while (cursor < length) {
    const open = source.indexOf("<", cursor);
    if (open < 0) {
      const text = decodeXmlText(source.slice(cursor));
      if (text.trim().length > 0 && visit({ type: "text", text, depth }) === false) return;
      return;
    }
    if (open > cursor) {
      const text = decodeXmlText(source.slice(cursor, open));
      if (text.trim().length > 0 && visit({ type: "text", text, depth }) === false) return;
    }

    // Comments, CDATA, processing instructions and doctypes. A doctype is
    // skipped rather than interpreted: entity declarations live there, and this
    // parser does not have an entity table to poison.
    if (source.startsWith("<!--", open)) {
      const end = source.indexOf("-->", open + 4);
      cursor = end < 0 ? length : end + 3;
      continue;
    }
    if (source.startsWith("<![CDATA[", open)) {
      const end = source.indexOf("]]>", open + 9);
      const raw = source.slice(open + 9, end < 0 ? length : end);
      if (raw.trim().length > 0 && visit({ type: "text", text: raw, depth }) === false) return;
      cursor = end < 0 ? length : end + 3;
      continue;
    }
    if (source.startsWith("<?", open)) {
      const end = source.indexOf("?>", open + 2);
      cursor = end < 0 ? length : end + 2;
      continue;
    }
    if (source.startsWith("<!", open)) {
      const end = source.indexOf(">", open + 2);
      cursor = end < 0 ? length : end + 1;
      continue;
    }

    const close = source.indexOf(">", open);
    if (close < 0) throw new XmlError("unterminated tag");
    const body = source.slice(open + 1, close);
    cursor = close + 1;

    if (body.startsWith("/")) {
      depth = Math.max(0, depth - 1);
      if (visit({ type: "close", name: localName(body.slice(1).trim()), depth }) === false) return;
      continue;
    }

    const selfClosing = body.endsWith("/");
    const inner = selfClosing ? body.slice(0, -1) : body;
    const space = inner.search(/\s/);
    const name = localName((space < 0 ? inner : inner.slice(0, space)).trim());
    const attributes = space < 0 ? {} : parseAttributes(inner.slice(space));

    if (!selfClosing) {
      depth += 1;
      if (depth > maxDepth) {
        throw new XmlError(`element nesting exceeded the depth ceiling of ${maxDepth}`);
      }
    }
    if (visit({ type: "open", name, attributes, selfClosing, depth }) === false) return;
    if (selfClosing && visit({ type: "close", name, depth }) === false) return;
  }
}
