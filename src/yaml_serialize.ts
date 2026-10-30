// yaml_serialize.ts — the single canonical serializer for the constrained YAML
// subset. Shared by normalize_meta (artifact headers) and inventory (sidecars) so
// the two previously hand-rolled, divergent copies cannot drift (finding ACA-005):
// normalize_meta emitted bare-when-safe scalars while inventory always JSON-quoted.
// Parsing is already single-sourced in meta_schema.parseCanonicalYaml; this is its
// write-side counterpart, and its output is designed to round-trip back through it.

// Serialize one scalar (or a nested value). Strings are emitted BARE when the
// canonical parser (meta_schema.parseCanonicalYaml) would read them back as the same
// string, and double-quoted otherwise — the exact complement of its SCALAR reader
// (ADR-057, RC-005): YAML-significant punctuation, edge whitespace, the bool/null
// tokens (`true`, `false`, `null`, `~`), integer and decimal patterns, and any line
// terminator or tab. Inside double quotes a backslash, a double quote, LF, CR, TAB
// and the LS/PS line separators are escaped. null/undefined → `null`; nested objects
// and arrays-as-values are inlined as JSON (the subset has no deeper nesting).
//
// `forbidden` (carrier value safety, RC-003): sequences the host comment cannot
// contain. A string containing one is double-quoted and the first character of every
// occurrence is written as a standard YAML escape (`\xNN` / `\uXXXX`), which the
// canonical parser reads back exactly. No escape spelling contains a forbidden
// sequence, so the emitted text is free of them. A key, or a JSON-inlined value,
// that contains one cannot be escaped and is refused (CARRIER_UNREPRESENTABLE).
//
// C0 controls other than TAB/LF/CR, and U+007F, are not YAML-printable and make an
// XML/SVG `<!-- -->` carrier ill-formed (audit G07). For every carrier a string
// holding one is double-quoted with each such character written as `\xNN`, which the
// canonical parser reads back exactly; a key or a JSON-inlined value holding one is
// refused (CARRIER_UNREPRESENTABLE).
const ESCAPED_BACKSLASH = String.raw`\\`;
const ESCAPED_QUOTE = String.raw`\"`;
const NEEDS_QUOTES = /[:#{}[\],&*?|<>=!%@`\n\r\t\u2028\u2029'"\\]/;
const READS_AS_NON_STRING = /^(?:true|false|null|~|-?\d+|-?\d*\.\d+)$/;
// TAB, LF and CR have their own escapes; these have none and are always `\xNN`.
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
const isControl = (c: string): boolean => CONTROL.test(c);

function hexEscape(code: number): string {
  const hex = code.toString(16).toUpperCase();
  return code < 0x100 ? `\\x${hex.padStart(2, "0")}` : `\\u${hex.padStart(4, "0")}`;
}

/** Indices of the first character of every (overlapping) occurrence of each sequence. */
function forbiddenStarts(s: string, forbidden: readonly string[]): Set<number> {
  const marks = new Set<number>();
  for (const seq of forbidden) {
    if (seq === "") continue;
    for (let at = s.indexOf(seq); at !== -1; at = s.indexOf(seq, at + 1)) marks.add(at);
  }
  return marks;
}

function quoted(s: string, marks: ReadonlySet<number>): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\") out += ESCAPED_BACKSLASH;
    else if (c === '"') out += ESCAPED_QUOTE;
    else if (c === "\n") out += String.raw`\n`;
    else if (c === "\r") out += String.raw`\r`;
    else if (c === "\t") out += String.raw`\t`;
    // The parser's line pattern (`.`) stops at LS/PS, so they are always escaped.
    else if (c === "\u2028" || c === "\u2029") out += hexEscape(c.charCodeAt(0));
    // `c` is one UTF-16 unit, so its code point is that unit (a lone surrogate
    // half of an astral character included): every control here is below U+0080.
    else if (isControl(c)) out += hexEscape(c.codePointAt(0) ?? 0);
    else if (marks.has(i)) out += hexEscape(c.charCodeAt(0));
    else out += c;
  }
  return `"${out}"`;
}

/** The first forbidden sequence, or the first unescapable control character, in `s`. */
function containsForbidden(s: string, forbidden: readonly string[]): string | undefined {
  return forbidden.find((seq) => seq !== "" && s.includes(seq)) ?? CONTROL.exec(s)?.[0];
}

export function yamlScalar(v: unknown, forbidden: readonly string[] = []): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return String(v);
  if (typeof v === "object") {
    const json = JSON.stringify(v);
    const hit = containsForbidden(json, forbidden);
    if (hit !== undefined) {
      throw new Error(`CARRIER_UNREPRESENTABLE: an inlined value contains ${JSON.stringify(hit)}, which its carrier cannot hold`);
    }
    return json;
  }
  const s = String(v);
  if (s === "") return '""';
  const marks = forbiddenStarts(s, forbidden);
  if (marks.size > 0 || NEEDS_QUOTES.test(s) || CONTROL.test(s) || s.trim() !== s || READS_AS_NON_STRING.test(s)) return quoted(s, marks);
  return s;
}

export interface SerializeYamlOptions {
  /** Wrap the body in `---` fences (default: true). */
  fences?: boolean;
  /** Append a trailing newline after the closing fence (default: false). */
  trailingNewline?: boolean;
  /**
   * Sequences the destination carrier cannot contain (see comment.carrierForbiddenSequences).
   * Values holding one are escaped; a key holding one is refused. Default: none,
   * which leaves the output byte-identical for every other caller.
   */
  forbidden?: readonly string[];
}

// Serialize a flat object into the canonical YAML body:
//   key: scalar | key: [] | key:\n  - item…
// Array values become block lists (empty → inline `[]`); every other value is a
// scalar via yamlScalar. Not a general YAML emitter — matches the parser's subset.
export function serializeYamlObject(obj: Record<string, unknown>, opts: SerializeYamlOptions = {}): string {
  const withFences = opts.fences !== false;
  const forbidden = opts.forbidden ?? [];
  const lines: string[] = [];
  if (withFences) lines.push("---");
  for (const [k, v] of Object.entries(obj)) {
    const hit = containsForbidden(k, forbidden);
    if (hit !== undefined) {
      throw new Error(`CARRIER_UNREPRESENTABLE: key ${JSON.stringify(k)} contains ${JSON.stringify(hit)}, which its carrier cannot hold`);
    }
    if (Array.isArray(v)) {
      if (v.length === 0) lines.push(`${k}: []`);
      else { lines.push(`${k}:`); v.forEach((i) => lines.push(`  - ${yamlScalar(i, forbidden)}`)); }
    } else {
      lines.push(`${k}: ${yamlScalar(v, forbidden)}`);
    }
  }
  if (withFences) lines.push("---");
  return opts.trailingNewline ? lines.join("\n") + "\n" : lines.join("\n");
}
