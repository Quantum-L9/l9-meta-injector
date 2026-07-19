"use strict";
// yaml_serialize.ts — the single canonical serializer for the constrained YAML
// subset. Shared by normalize_meta (artifact headers) and inventory (sidecars) so
// the two previously hand-rolled, divergent copies cannot drift (finding ACA-005):
// normalize_meta emitted bare-when-safe scalars while inventory always JSON-quoted.
// Parsing is already single-sourced in meta_schema.parseCanonicalYaml; this is its
// write-side counterpart, and its output is designed to round-trip back through it.
Object.defineProperty(exports, "__esModule", { value: true });
exports.yamlScalar = yamlScalar;
exports.serializeYamlObject = serializeYamlObject;
// Serialize one scalar (or a nested value). Strings are emitted BARE when safe and
// double-quoted (with \\ and \" escaped) when they contain YAML-significant
// characters or would otherwise be misread as a bool/null — the inverse of
// parseCanonicalYaml's SCALAR reader. null/undefined → `null`; nested objects and
// arrays-as-values are inlined as JSON (the subset has no deeper nesting).
function yamlScalar(v) {
    if (v === null || v === undefined)
        return "null";
    if (typeof v === "boolean")
        return v ? "true" : "false";
    if (typeof v === "number")
        return String(v);
    if (typeof v === "object")
        return JSON.stringify(v);
    const s = String(v);
    if (s === "")
        return '""';
    if (/[:#{}\[\],&*?|<>=!%@`\n'"\\]/.test(s) || s.trim() !== s || s === "true" || s === "false" || s === "null")
        return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
    return s;
}
// Serialize a flat object into the canonical YAML body:
//   key: scalar | key: [] | key:\n  - item…
// Array values become block lists (empty → inline `[]`); every other value is a
// scalar via yamlScalar. Not a general YAML emitter — matches the parser's subset.
function serializeYamlObject(obj, opts = {}) {
    const withFences = opts.fences !== false;
    const lines = [];
    if (withFences)
        lines.push("---");
    for (const [k, v] of Object.entries(obj)) {
        if (Array.isArray(v)) {
            if (v.length === 0)
                lines.push(`${k}: []`);
            else {
                lines.push(`${k}:`);
                v.forEach((i) => lines.push(`  - ${yamlScalar(i)}`));
            }
        }
        else {
            lines.push(`${k}: ${yamlScalar(v)}`);
        }
    }
    if (withFences)
        lines.push("---");
    return opts.trailingNewline ? lines.join("\n") + "\n" : lines.join("\n");
}
//# sourceMappingURL=yaml_serialize.js.map