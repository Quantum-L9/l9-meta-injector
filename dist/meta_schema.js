"use strict";
// meta_schema.ts — Customizable meta structure driven by a canonical YAML schema.
// Lets the operator define, per task/source/consumer, exactly which meta fields to
// emit, which are required, their defaults, and where each value comes from. Keeps
// the package dependency-free: a small deterministic parser reads a CONSTRAINED YAML
// subset (documented below) — not arbitrary YAML.
//
// Canonical schema shape (depth <= 2):
//   schema_id: my_schema
//   version: 1.0.0
//   description: ...
//   target: [file_header, sidecar, manifest]      # inline scalar list
//   fields:
//     - name: id
//       source: artifact_id        # pull from the inventory record field of that name
//       required: true
//     - name: owner
//       default: "Unknown"         # literal fallback when source is empty/absent
//       required: true
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseCanonicalYaml = parseCanonicalYaml;
exports.toMetaSchema = toMetaSchema;
exports.applySchema = applySchema;
exports.targetIncludes = targetIncludes;
const SCALAR = (raw) => {
    const s = raw.trim();
    if (s === "")
        return "";
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        // Double-quoted: unescape the standard YAML escape sequences so values like
        // Windows paths ("C:\\tmp") or embedded \n/\" round-trip correctly.
        return s.slice(1, -1).replace(/\\(["\\/nrt])/g, (_m, c) => c === "n" ? "\n" : c === "r" ? "\r" : c === "t" ? "\t" : c);
    }
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
        // Single-quoted: the only escape is a doubled quote ('').
        return s.slice(1, -1).replace(/''/g, "'");
    }
    if (s === "true")
        return true;
    if (s === "false")
        return false;
    if (s === "null" || s === "~")
        return null;
    if (s === "[]")
        return [];
    if (s === "{}")
        return {};
    if (/^-?\d+$/.test(s))
        return parseInt(s, 10);
    if (/^-?\d*\.\d+$/.test(s))
        return parseFloat(s);
    if (s.startsWith("[") && s.endsWith("]")) {
        return s.slice(1, -1).split(",").map((x) => x.trim()).filter((x) => x !== "").map(SCALAR);
    }
    return s;
};
const indentOf = (line) => line.length - line.replace(/^ +/, "").length;
// Drop a trailing `# comment` and surrounding space, but only when the `#` is
// whitespace-preceded AND not inside a single/double-quoted string — so a value
// like `description: "hello # world"` is preserved intact.
const strip = (line) => {
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === "'" && !inDouble)
            inSingle = !inSingle;
        else if (c === '"' && !inSingle)
            inDouble = !inDouble;
        else if (c === "#" && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
            return line.slice(0, i).replace(/\s+$/, "");
        }
    }
    return line.replace(/\s+$/, "");
};
/**
 * Parse the constrained canonical YAML subset into a plain object.
 * Supports: top-level `key: scalar`, `key: [inline,list]`, and `key:` followed by a
 * list of scalars or a list of maps (2-space indented). Not a general YAML parser.
 */
function parseCanonicalYaml(text) {
    const lines = text.split("\n")
        .map(strip)
        .filter((l) => l.trim() !== "" && !/^\s*#/.test(l));
    // Object.create(null): parsed keys come from operator-supplied YAML, so a
    // `__proto__:`/`constructor:` key must not reach Object.prototype (SEC-001 /
    // CWE-1321). A null-prototype bag makes such keys ordinary own properties.
    const root = Object.create(null);
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (indentOf(line) !== 0) {
            i++;
            continue;
        }
        const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (!m) {
            i++;
            continue;
        }
        const key = m[1];
        const rest = m[2];
        if (rest !== "") {
            root[key] = SCALAR(rest);
            i++;
            continue;
        }
        // Block value: gather indented lines
        i++;
        const block = [];
        while (i < lines.length && indentOf(lines[i]) > 0) {
            block.push(lines[i]);
            i++;
        }
        root[key] = parseBlock(block);
    }
    return root;
}
function parseBlock(block) {
    if (block.length === 0)
        return null;
    const base = Math.min(...block.map(indentOf));
    const isList = block.some((l) => l.slice(base).startsWith("- "));
    if (!isList) {
        // Single-level map only. Fail fast on deeper nesting instead of silently
        // flattening it — the canonical subset does not support nested maps, and a
        // silent garble is dangerous for callers that read+rewrite existing files.
        const map = Object.create(null); // null proto — see SEC-001 note above
        for (const l of block) {
            if (indentOf(l) > base) {
                throw new Error("canonical YAML: nested maps (depth > 2) are not supported");
            }
            const mm = l.trim().match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
            if (mm) {
                if (mm[2] === "")
                    throw new Error(`canonical YAML: nested map under '${mm[1]}' is not supported`);
                map[mm[1]] = SCALAR(mm[2]);
            }
        }
        return map;
    }
    // list: split into items at each `- ` at base indent
    const items = [];
    let cur = null;
    for (const l of block) {
        if (indentOf(l) === base && l.slice(base).startsWith("- ")) {
            if (cur)
                items.push(parseItem(cur));
            cur = [l.slice(base + 2)]; // first inline segment of the item
        }
        else if (cur) {
            cur.push(l.trim()); // continuation lines of the current map item
        }
    }
    if (cur)
        items.push(parseItem(cur));
    return items;
}
function parseItem(seg) {
    // seg[0] is the text after "- "; if it looks like `key: val`, it's a map, else scalar
    const first = seg[0];
    const mm = first.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!mm)
        return SCALAR(first);
    const map = {};
    map[mm[1]] = SCALAR(mm[2]);
    for (let k = 1; k < seg.length; k++) {
        const m2 = seg[k].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
        if (m2)
            map[m2[1]] = SCALAR(m2[2]);
    }
    return map;
}
/** Validate parsed object into a MetaSchema; throws on structural error. */
function toMetaSchema(obj) {
    if (!obj.schema_id || typeof obj.schema_id !== "string")
        throw new Error("meta-schema: missing string 'schema_id'");
    if (!Array.isArray(obj.fields) || obj.fields.length === 0)
        throw new Error("meta-schema: 'fields' must be a non-empty list");
    const fields = obj.fields.map((f, idx) => {
        if (typeof f !== "object" || f === null)
            throw new Error(`meta-schema: fields[${idx}] must be a map`);
        const fd = f;
        if (!fd.name || typeof fd.name !== "string")
            throw new Error(`meta-schema: fields[${idx}] missing 'name'`);
        return {
            name: fd.name,
            source: typeof fd.source === "string" ? fd.source : undefined,
            default: "default" in fd ? fd.default : undefined,
            required: fd.required === true,
        };
    });
    const target = Array.isArray(obj.target) ? obj.target.map(String) : ["file_header", "sidecar", "manifest"];
    return {
        schema_id: obj.schema_id,
        version: typeof obj.version === "string" ? obj.version : "0.0.0",
        description: typeof obj.description === "string" ? obj.description : undefined,
        target,
        fields,
    };
}
/** Resolve a schema against one source record into the concrete meta fields. */
function applySchema(record, schema) {
    const fields = {};
    const missingRequired = [];
    for (const f of schema.fields) {
        let val = undefined;
        if (f.source !== undefined)
            val = record[f.source];
        const empty = val === undefined || val === null || val === "";
        if (empty && f.default !== undefined)
            val = f.default;
        const stillEmpty = val === undefined || val === null || val === "";
        if (stillEmpty && f.required)
            missingRequired.push(f.name);
        fields[f.name] = val === undefined ? (f.default !== undefined ? f.default : null) : val;
    }
    return { fields, missingRequired };
}
function targetIncludes(schema, t) {
    return !schema || schema.target.includes(t);
}
//# sourceMappingURL=meta_schema.js.map