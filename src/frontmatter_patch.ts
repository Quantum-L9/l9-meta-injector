/**
 * Byte-preserving YAML-frontmatter inspection and managed-field patching.
 *
 * The patcher intentionally supports a narrow, deterministic YAML subset:
 * top-level scalar fields and top-level scalar lists. Anything ambiguous or
 * structurally richer fails closed so unrelated user-authored YAML is never
 * normalized, reordered, or silently rewritten.
 */

export const FRONTMATTER_PATCH_SCHEMA = "l9.frontmatter-patch/v1" as const;

export type FrontMatterIssueCode =
  | "FRONTMATTER_OPENING_FENCE_NOT_EXACT"
  | "FRONTMATTER_CLOSING_FENCE_MISSING"
  | "FRONTMATTER_DUPLICATE_BLOCK"
  | "FRONTMATTER_MIXED_NEWLINES"
  | "FRONTMATTER_TAB_CHARACTER"
  | "FRONTMATTER_DUPLICATE_KEY"
  | "FRONTMATTER_INVALID_KEY"
  | "FRONTMATTER_COMPLEX_YAML"
  | "FRONTMATTER_UNSUPPORTED_VALUE";

export interface FrontMatterIssue {
  code: FrontMatterIssueCode;
  message: string;
  line?: number;
  key?: string;
}

/**
 * Issue codes that describe a limit of *this patcher*, not a defect in the document.
 *
 * The distinction is load-bearing: a valid document the patcher cannot safely edit is
 * routed to the central manifest and the repository operation continues, whereas a
 * structurally malformed header is only tolerated when nothing authorized inline
 * mutation for that path.
 */
const PATCHER_LIMITATION_CODES: ReadonlySet<FrontMatterIssueCode> = new Set<FrontMatterIssueCode>([
  "FRONTMATTER_COMPLEX_YAML",
  "FRONTMATTER_UNSUPPORTED_VALUE",
]);

export function isPatcherLimitation(code: FrontMatterIssueCode): boolean {
  return PATCHER_LIMITATION_CODES.has(code);
}

export interface FrontMatterField {
  key: string;
  /** Absent for `opaque` fields: the value's bytes are known, its meaning is not. */
  value: unknown;
  /**
   * `opaque` is a single-line plain scalar whose text the canonical parser cannot
   * represent — an unquoted ISO timestamp, a bare URL, a `10:30` clock value. Its byte
   * range is known exactly, so it can be preserved verbatim when unmanaged and replaced
   * wholesale when managed. It is never interpreted, and never enters `meta`.
   */
  kind: "scalar" | "sequence" | "opaque";
  start: number;
  end: number;
  valueStart?: number;
  valueEnd?: number;
  commentSuffix?: string;
  sequenceIndent?: string;
  sequencePrefix?: string;
  sequenceSuffix?: string;
}

export interface FrontMatterInspection {
  safe: boolean;
  hadFrontMatter: boolean;
  bom: "" | "\uFEFF";
  newline: "\n" | "\r\n";
  body: string;
  meta: Record<string, unknown>;
  fields: FrontMatterField[];
  openingStart: number;
  openingEnd: number;
  closingStart: number;
  closingEnd: number;
  issue?: FrontMatterIssue;
}

export interface FrontMatterPatchResult extends FrontMatterInspection {
  content: string;
  changed: boolean;
  managedKeys: string[];
}

interface Line {
  number: number;
  start: number;
  end: number;
  fullEnd: number;
  text: string;
  eol: "" | "\n" | "\r\n";
}

interface ScalarToken {
  valueText: string;
  commentSuffix: string;
  valueOffset: number;
  valueEndOffset: number;
}

function issue(raw: string, code: FrontMatterIssueCode, message: string, extra: Partial<FrontMatterIssue> = {}): FrontMatterInspection {
  const bom = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  return {
    safe: false,
    hadFrontMatter: false,
    bom,
    newline: detectNewline(raw),
    body: raw,
    meta: Object.create(null) as Record<string, unknown>,
    fields: [],
    openingStart: bom.length,
    openingEnd: bom.length,
    closingStart: bom.length,
    closingEnd: bom.length,
    issue: { code, message, ...extra },
  };
}

function detectNewline(raw: string): "\n" | "\r\n" {
  const crlf = raw.indexOf("\r\n");
  const lf = raw.indexOf("\n");
  return crlf !== -1 && crlf === lf - 1 ? "\r\n" : "\n";
}

function splitLines(raw: string, start = 0): Line[] {
  const out: Line[] = [];
  let offset = start;
  let number = 1;
  while (offset < raw.length) {
    const nl = raw.indexOf("\n", offset);
    if (nl === -1) {
      out.push({ number, start: offset, end: raw.length, fullEnd: raw.length, text: raw.slice(offset), eol: "" });
      break;
    }
    const hasCr = nl > offset && raw[nl - 1] === "\r";
    const end = hasCr ? nl - 1 : nl;
    const eol = hasCr ? "\r\n" : "\n";
    out.push({ number, start: offset, end, fullEnd: nl + 1, text: raw.slice(offset, end), eol });
    offset = nl + 1;
    number += 1;
  }
  if (raw.length === start) out.push({ number, start, end: start, fullEnd: start, text: "", eol: "" });
  return out;
}

/** Index where trailing whitespace begins, or -1 if there is none. Linear scan (avoids `/\s+$/` backtracking). */
function trailingWhitespaceStart(text: string): number {
  const end = text.trimEnd().length;
  return end === text.length ? -1 : end;
}

function splitInlineComment(text: string): ScalarToken {
  let single = false;
  let double = false;
  let bracketDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'" && !double) {
      if (single && text[i + 1] === "'") { i += 1; continue; }
      single = !single;
      continue;
    }
    if (char === '"' && !single && (i === 0 || text[i - 1] !== "\\")) {
      double = !double;
      continue;
    }
    if (single || double) continue;
    if (char === "[") bracketDepth += 1;
    if (char === "]") bracketDepth -= 1;
    if (char === "#" && bracketDepth === 0 && (i === 0 || /\s/.test(text[i - 1]))) {
      const before = text.slice(0, i);
      const trailing = trailingWhitespaceStart(before);
      const valueEnd = trailing === -1 ? before.length : trailing;
      return {
        valueText: before.slice(0, valueEnd),
        commentSuffix: before.slice(valueEnd) + text.slice(i),
        valueOffset: before.search(/\S|$/),
        valueEndOffset: valueEnd,
      };
    }
  }
  const valueOffset = text.search(/\S|$/);
  const trimmedEnd = trailingWhitespaceStart(text);
  const valueEndOffset = trimmedEnd === -1 ? text.length : trimmedEnd;
  return {
    valueText: text.slice(valueOffset, valueEndOffset),
    commentSuffix: text.slice(valueEndOffset),
    valueOffset,
    valueEndOffset,
  };
}

function splitInlineList(text: string): string[] | null {
  const inner = text.slice(1, -1);
  if (inner.trim() === "") return [];
  const items: string[] = [];
  let single = false;
  let double = false;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];
    if (char === "'" && !double) {
      if (single && inner[i + 1] === "'") { i += 1; continue; }
      single = !single;
    } else if (char === '"' && !single && (i === 0 || inner[i - 1] !== "\\")) {
      double = !double;
    } else if (char === "," && !single && !double) {
      items.push(inner.slice(start, i).trim());
      start = i + 1;
    } else if (!single && !double && (char === "[" || char === "]" || char === "{" || char === "}")) {
      return null;
    }
  }
  if (single || double) return null;
  items.push(inner.slice(start).trim());
  return items;
}

type ScalarParse = { ok: true; value: unknown } | { ok: false };

/** Parse a double- or single-quoted scalar; null when `value` is not quoted. */
function parseQuotedScalar(value: string): ScalarParse | null {
  if (value.startsWith('"')) {
    if (!value.endsWith('"')) return { ok: false };
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? { ok: true, value: parsed } : { ok: false };
    } catch { return { ok: false }; }
  }
  if (value.startsWith("'")) {
    if (!value.endsWith("'")) return { ok: false };
    return { ok: true, value: value.slice(1, -1).replace(/''/g, "'") };
  }
  return null;
}

/** Parse a `[a, b]` inline list of scalars; null when `value` is not a list. */
function parseInlineListScalar(value: string): ScalarParse | null {
  if (!(value.startsWith("[") && value.endsWith("]"))) return null;
  const parts = splitInlineList(value);
  if (!parts) return { ok: false };
  const parsed: unknown[] = [];
  for (const part of parts) {
    const item = parseSafeScalar(part);
    if (!item.ok || Array.isArray(item.value)) return { ok: false };
    parsed.push(item.value);
  }
  return { ok: true, value: parsed };
}

function parseSafeScalar(text: string): ScalarParse {
  const value = text.trim();
  if (value === "") return { ok: false };
  if (value.startsWith("{") || value.endsWith("}") || /^[|>&*!?]/.test(value) || value === "---" || value === "...") return { ok: false };
  if (/^<<\s*:/.test(value) || /(^|\s)[&*][A-Za-z0-9_-]+/.test(value)) return { ok: false };
  const quoted = parseQuotedScalar(value);
  if (quoted) return quoted;
  if (value === "true") return { ok: true, value: true };
  if (value === "false") return { ok: true, value: false };
  if (value === "null" || value === "~") return { ok: true, value: null };
  if (/^-?(?:0|[1-9]\d*)$/.test(value)) return { ok: true, value: Number(value) };
  if (/^-?(?:0|[1-9]\d*)\.\d+$/.test(value)) return { ok: true, value: Number(value) };
  const list = parseInlineListScalar(value);
  if (list) return list;
  if (/[:\[\]{}]/.test(value)) return { ok: false };
  return { ok: true, value };
}

/**
 * Is `text` a single-line plain YAML scalar that the canonical parser declines to
 * interpret, but whose bytes can be carried unchanged?
 *
 * This is deliberately narrow. Anything that could be a flow collection, an anchor, an
 * alias, a merge key, a block scalar, a directive, or a partially quoted string stays
 * unsupported: the point is to preserve values like `created: 2025-10-28T15:30:00Z`
 * without pretending to understand them, not to widen the grammar.
 */
function isOpaqueScalar(text: string): boolean {
  const value = text.trim();
  if (value === "" || value === "---" || value === "...") return false;
  if (/^[|>&*!?%@`{}[\]]/.test(value)) return false;
  if (/[{}[\]]/.test(value)) return false;
  if (/^<<\s*:/.test(value) || /(^|\s)[&*][A-Za-z0-9_-]+/.test(value)) return false;
  if (value.includes('"') || value.includes("'")) return false;
  // Control characters would not survive a byte-preserving round trip predictably.
  return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value);
}

function renderSafeScalar(value: unknown): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("managed frontmatter values must be finite numbers");
    return String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\r") || value.includes("\n") || value.includes("\u0000")) throw new Error("managed frontmatter strings must be single-line text");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => {
      if (Array.isArray(item) || (typeof item === "object" && item !== null) || item === undefined) {
        throw new Error("managed frontmatter arrays may contain scalar values only");
      }
      return renderSafeScalar(item);
    }).join(", ")}]`;
  }
  throw new Error(`unsupported managed frontmatter value type: ${typeof value}`);
}

function looksLikeDuplicateBlock(raw: string, start: number): boolean {
  const lines = splitLines(raw, start);
  let i = 0;
  while (i < lines.length && lines[i].text === "") i += 1;
  if (i >= lines.length || lines[i].text !== "---") return false;
  for (let j = i + 1; j < Math.min(lines.length, i + 201); j++) {
    if (lines[j].text === "---") return true;
    if (lines[j].text === "..." || lines[j].text.startsWith("# ")) continue;
  }
  return false;
}

export function inspectFrontMatterDocument(raw: string): FrontMatterInspection {
  const bom: "" | "\uFEFF" = raw.startsWith("\uFEFF") ? "\uFEFF" : "";
  const start = bom.length;
  const lines = splitLines(raw, start);
  const first = lines[0];
  const newline = detectNewline(raw);
  const emptyMeta = Object.create(null) as Record<string, unknown>;

  if (first.text !== "---") {
    if (first.text.trimStart().startsWith("---")) {
      return issue(raw, "FRONTMATTER_OPENING_FENCE_NOT_EXACT", "frontmatter opening fence must be exactly '---' with no indentation or trailing content", { line: 1 });
    }
    return {
      safe: true,
      hadFrontMatter: false,
      bom,
      newline,
      body: raw.slice(start),
      meta: emptyMeta,
      fields: [],
      openingStart: start,
      openingEnd: start,
      closingStart: start,
      closingEnd: start,
    };
  }
  if (first.eol === "") return issue(raw, "FRONTMATTER_CLOSING_FENCE_MISSING", "frontmatter opening fence has no closing fence", { line: 1 });

  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].text === "---") { closeIndex = i; break; }
  }
  if (closeIndex === -1) return issue(raw, "FRONTMATTER_CLOSING_FENCE_MISSING", "frontmatter closing fence must be an exact '---' line");
  const close = lines[closeIndex];
  const headerLines = lines.slice(1, closeIndex);
  const headerNewlines = new Set(headerLines.concat([first, close]).map((line) => line.eol).filter(Boolean));
  if (headerNewlines.size > 1) return issue(raw, "FRONTMATTER_MIXED_NEWLINES", "frontmatter header mixes LF and CRLF line endings");
  if (headerLines.some((line) => line.text.includes("\t"))) return issue(raw, "FRONTMATTER_TAB_CHARACTER", "frontmatter header contains a tab character");
  if (looksLikeDuplicateBlock(raw, close.fullEnd)) return issue(raw, "FRONTMATTER_DUPLICATE_BLOCK", "a second leading frontmatter-like block follows the first");

  const meta = Object.create(null) as Record<string, unknown>;
  const fields: FrontMatterField[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < headerLines.length) {
    const line = headerLines[i];
    if (line.text === "" || /^\s*#/.test(line.text)) { i += 1; continue; }
    if (/^\s/.test(line.text)) return issue(raw, "FRONTMATTER_COMPLEX_YAML", "unexpected indentation outside a supported scalar sequence", { line: line.number });
    if (/^(?:%|\.\.\.|\?|!|&|\*|\{|\}|<<:)/.test(line.text)) return issue(raw, "FRONTMATTER_COMPLEX_YAML", "unsupported YAML directive, tag, anchor, alias, explicit key, or map", { line: line.number });
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(line.text);
    if (!match) return issue(raw, "FRONTMATTER_INVALID_KEY", "frontmatter must contain simple top-level key/value fields", { line: line.number });
    const key = match[1];
    if (seen.has(key)) return issue(raw, "FRONTMATTER_DUPLICATE_KEY", `duplicate frontmatter key '${key}'`, { line: line.number, key });
    seen.add(key);
    const tail = match[2];
    const scalarToken = splitInlineComment(tail);
    if (scalarToken.valueText.trim() !== "") {
      const parsed = parseSafeScalar(scalarToken.valueText);
      // A value the canonical parser declines is not automatically a broken document.
      // A single-line plain scalar keeps its exact bytes and is carried as `opaque`.
      const opaque = !parsed.ok && isOpaqueScalar(scalarToken.valueText);
      if (!parsed.ok && !opaque) return issue(raw, "FRONTMATTER_COMPLEX_YAML", `unsupported value for '${key}'`, { line: line.number, key });
      if (i + 1 < headerLines.length && /^\s+\S/.test(headerLines[i + 1].text) && !/^\s*#/.test(headerLines[i + 1].text)) {
        return issue(raw, "FRONTMATTER_COMPLEX_YAML", `multiline or nested value under '${key}' is not supported`, { line: headerLines[i + 1].number, key });
      }
      const colon = line.text.indexOf(":");
      const tailStart = line.start + colon + 1;
      fields.push({
        key,
        value: parsed.ok ? parsed.value : undefined,
        kind: parsed.ok ? "scalar" : "opaque",
        start: line.start,
        end: line.fullEnd,
        valueStart: tailStart + scalarToken.valueOffset,
        valueEnd: tailStart + scalarToken.valueEndOffset,
        commentSuffix: scalarToken.commentSuffix,
      });
      // An opaque value is never interpreted, so it never enters the parsed metadata.
      if (parsed.ok) meta[key] = parsed.value;
      i += 1;
      continue;
    }

    let j = i + 1;
    const block: Line[] = [];
    while (j < headerLines.length && (/^\s/.test(headerLines[j].text) || headerLines[j].text === "")) {
      block.push(headerLines[j]);
      j += 1;
    }
    const items: unknown[] = [];
    const itemIndexes: number[] = [];
    let indent = "";
    for (let k = 0; k < block.length; k++) {
      const blockLine = block[k];
      if (blockLine.text === "" || /^\s*#/.test(blockLine.text)) continue;
      const itemMatch = blockLine.text.match(/^(\s+)-\s+(.+)$/);
      if (!itemMatch) return issue(raw, "FRONTMATTER_COMPLEX_YAML", `nested map or multiline value under '${key}' is not supported`, { line: blockLine.number, key });
      if (!indent) indent = itemMatch[1];
      if (itemMatch[1] !== indent) return issue(raw, "FRONTMATTER_COMPLEX_YAML", `inconsistent sequence indentation under '${key}'`, { line: blockLine.number, key });
      const itemToken = splitInlineComment(itemMatch[2]);
      if (itemToken.commentSuffix.includes("#")) return issue(raw, "FRONTMATTER_COMPLEX_YAML", `inline comments on sequence items under '${key}' are not safely patchable`, { line: blockLine.number, key });
      const parsed = parseSafeScalar(itemToken.valueText);
      if (!parsed.ok || Array.isArray(parsed.value)) return issue(raw, "FRONTMATTER_COMPLEX_YAML", `unsupported sequence item under '${key}'`, { line: blockLine.number, key });
      items.push(parsed.value);
      itemIndexes.push(k);
    }
    if (items.length === 0) return issue(raw, "FRONTMATTER_COMPLEX_YAML", `empty or nested block under '${key}' is not supported`, { line: line.number, key });
    const firstItem = itemIndexes[0];
    const lastItem = itemIndexes[itemIndexes.length - 1];
    for (let k = firstItem; k <= lastItem; k++) {
      if (block[k].text === "" || /^\s*#/.test(block[k].text)) {
        return issue(raw, "FRONTMATTER_COMPLEX_YAML", `interleaved comments inside sequence '${key}' are not safely patchable`, { line: block[k].number, key });
      }
    }
    const prefix = block.slice(0, firstItem).map((entry) => raw.slice(entry.start, entry.fullEnd)).join("");
    const suffix = block.slice(lastItem + 1).map((entry) => raw.slice(entry.start, entry.fullEnd)).join("");
    const end = block.length ? block[block.length - 1].fullEnd : line.fullEnd;
    fields.push({
      key,
      value: items,
      kind: "sequence",
      start: line.start,
      end,
      sequenceIndent: indent,
      sequencePrefix: prefix,
      sequenceSuffix: suffix,
      commentSuffix: scalarToken.commentSuffix,
    });
    meta[key] = items;
    i = j;
  }

  return {
    safe: true,
    hadFrontMatter: true,
    bom,
    newline: ([...headerNewlines].find((value): value is "\n" | "\r\n" => value === "\n" || value === "\r\n") ?? newline),
    body: raw.slice(close.fullEnd),
    meta,
    fields,
    openingStart: first.start,
    openingEnd: first.fullEnd,
    closingStart: close.start,
    closingEnd: close.fullEnd,
  };
}

function failureFromInspection(raw: string, inspection: FrontMatterInspection, managedKeys: string[]): FrontMatterPatchResult {
  return { ...inspection, content: raw, changed: false, managedKeys };
}

export function patchManagedFrontMatter(raw: string, managed: Record<string, unknown>): FrontMatterPatchResult {
  const managedKeys = Object.keys(managed);
  for (const key of managedKeys) {
    if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) {
      return failureFromInspection(raw, issue(raw, "FRONTMATTER_INVALID_KEY", `managed frontmatter key '${key}' is invalid`, { key }), managedKeys);
    }
    try { renderSafeScalar(managed[key]); }
    catch (error) {
      return failureFromInspection(raw, issue(raw, "FRONTMATTER_UNSUPPORTED_VALUE", error instanceof Error ? error.message : String(error), { key }), managedKeys);
    }
  }

  const inspection = inspectFrontMatterDocument(raw);
  if (!inspection.safe) return failureFromInspection(raw, inspection, managedKeys);
  const newline = inspection.newline;

  if (!inspection.hadFrontMatter) {
    if (managedKeys.length === 0) return { ...inspection, content: raw, changed: false, managedKeys };
    const header = managedKeys.map((key) => `${key}: ${renderSafeScalar(managed[key])}${newline}`).join("");
    const content = `${inspection.bom}---${newline}${header}---${newline}${inspection.body}`;
    const next = inspectFrontMatterDocument(content);
    if (!next.safe) return failureFromInspection(raw, next, managedKeys);
    return { ...next, content, changed: content !== raw, managedKeys };
  }

  const byKey = new Map(inspection.fields.map((field) => [field.key, field]));
  const edits: Array<{ start: number; end: number; text: string }> = [];
  const missing: string[] = [];
  for (const key of managedKeys) {
    const field = byKey.get(key);
    if (!field) { missing.push(key); continue; }
    const rendered = renderSafeScalar(managed[key]);
    // An opaque field patches exactly like a scalar: its value byte range is known, and a
    // managed key's canonical rendering replaces it wholesale. Only *unmanaged* opaque
    // values are preserved verbatim — they are simply never edited.
    if (field.kind === "scalar" || field.kind === "opaque") {
      if (field.valueStart === undefined || field.valueEnd === undefined) {
        return failureFromInspection(raw, issue(raw, "FRONTMATTER_COMPLEX_YAML", `managed field '${key}' lacks a safe scalar range`, { key }), managedKeys);
      }
      edits.push({ start: field.valueStart, end: field.valueEnd, text: rendered });
    } else {
      if (!Array.isArray(managed[key])) {
        return failureFromInspection(raw, issue(raw, "FRONTMATTER_UNSUPPORTED_VALUE", `managed sequence '${key}' must remain an array`, { key }), managedKeys);
      }
      const lineEnd = raw.indexOf(newline, field.start);
      const keyLineEnd = lineEnd === -1 ? field.end : lineEnd + newline.length;
      const keyLine = raw.slice(field.start, keyLineEnd);
      const indent = field.sequenceIndent || "  ";
      const sequence = (managed[key] as unknown[]).map((item) => `${indent}- ${renderSafeScalar(item)}${newline}`).join("");
      edits.push({
        start: field.start,
        end: field.end,
        text: `${keyLine}${field.sequencePrefix ?? ""}${sequence}${field.sequenceSuffix ?? ""}`,
      });
    }
  }
  if (missing.length > 0) {
    const insertion = missing.map((key) => `${key}: ${renderSafeScalar(managed[key])}${newline}`).join("");
    edits.push({ start: inspection.closingStart, end: inspection.closingStart, text: insertion });
  }

  let content = raw;
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (const edit of edits) {
    content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
  }
  const next = inspectFrontMatterDocument(content);
  if (!next.safe) return failureFromInspection(raw, next, managedKeys);
  if (next.body !== inspection.body) {
    return failureFromInspection(raw, issue(raw, "FRONTMATTER_COMPLEX_YAML", "managed patch changed document body bytes"), managedKeys);
  }
  return { ...next, content, changed: content !== raw, managedKeys };
}
