"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MANAGED_DECLARED_SCHEMA = void 0;
exports.parseNativeMetadata = parseNativeMetadata;
// native_metadata.ts — read native metadata declarations without writing them (ADR-082).
//
// Repositories in the constellation already carry metadata in their own headers:
// the legacy `L9_META` blocks (hash-comment, HTML-comment, Python-docstring and
// pipe-delimited forms), L9 YAML frontmatter, and the managed `l9:meta` block this
// package writes. This module is the one reader of those carriers. It is a pure
// function of a path and its text: it never writes, never normalizes a value into a
// different spelling, and never upgrades a declaration into a fact.
//
// What it guarantees:
//   - Exact provenance. Every declaration and every field cites 1-based line numbers
//     computed the way the interpreter numbers lines (`toLines`), so an assertion
//     built from a field points at the bytes that stated it.
//   - Header position only. A carrier is recognised at the head of a file, after a
//     BOM, a shebang, an encoding cookie, a language-server directive or a non-L9
//     frontmatter block, and stacked with other carriers. The same marker anywhere
//     else — a doctrine document quoting a template, a fenced example — is body.
//   - Versions are not equated. `l9_schema: 1`, `l9_schema: 2`, the managed header
//     and an unversioned block keep distinct identities; a version this reader does
//     not know is preserved without being assigned known semantics.
//   - Ambiguity is refused. A duplicate key or a line that is not a `key: value`
//     pair rejects the whole declaration with a diagnostic rather than a guess;
//     syntax outside the narrow grammar (nested maps, block scalars, flow maps)
//     makes that one field unsupported.
const frontmatter_patch_1 = require("./frontmatter_patch");
const comment_1 = require("./comment");
const common_1 = require("./extractors/common");
const schema_1 = require("./schema");
const ordering_1 = require("./ordering");
const semantic_mapping_1 = require("./semantic_mapping");
/** Declared schema of every declaration the managed writer produced. */
exports.MANAGED_DECLARED_SCHEMA = "managed:l9-meta-injector";
const MARKERS = {
    hashOpen: "# --- L9_META ---",
    hashClose: "# --- /L9_META ---",
    bareOpen: "# L9_META",
    bareClose: "# /L9_META",
    htmlOpen: "<!-- L9_META",
    htmlClose: "/L9_META -->",
    docOpen: "--- L9_META ---",
    docClose: "--- /L9_META ---",
};
/** Any L9 metadata marker, used only to report one outside the header region. */
const ANY_MARKER = /L9_META|>>> l9:meta >>>|l9:meta:start/;
/** Keys the managed writer emits in frontmatter; all three together identify it. */
const MANAGED_FRONTMATTER_KEYS = ["artifact_type", "mcp_primitive", "sharing_scope"];
const KEY_VALUE = /^([A-Za-z_][A-Za-z0-9_.-]*)[ \t]*:(?:[ \t]+(.*)|[ \t]*)$/;
/** Drop a ` #…` comment that is outside quotes and preceded by whitespace. */
function stripTrailingComment(value) {
    let quote = null;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === "\\" && quote === '"')
                index++;
            else if (character === quote)
                quote = null;
            continue;
        }
        if ((character === '"' || character === "'") && (index === 0 || /[\s[,]/.test(value[index - 1]))) {
            quote = character;
            continue;
        }
        if (character === "#" && index > 0 && /\s/.test(value[index - 1]))
            return value.slice(0, index).trimEnd();
    }
    return value.trimEnd();
}
/** Split a legacy line into ` | `-separated segments, outside quotes. */
function splitPipes(text) {
    const segments = [];
    let quote = null;
    let current = "";
    for (let index = 0; index < text.length; index++) {
        const character = text[index];
        if (quote) {
            current += character;
            if (character === quote)
                quote = null;
            continue;
        }
        if (character === '"' || character === "'")
            quote = character;
        if (character === " " && text.startsWith(" | ", index)) {
            segments.push(current);
            current = "";
            index += 2;
            continue;
        }
        current += character;
    }
    segments.push(current);
    return segments;
}
function readScalar(raw) {
    const value = raw.trim();
    if (value.startsWith('"')) {
        if (value.length < 2 || !value.endsWith('"'))
            return { ok: false, reason: "unterminated double-quoted scalar" };
        try {
            const parsed = JSON.parse(value);
            return typeof parsed === "string" ? { ok: true, text: parsed } : { ok: false, reason: "invalid double-quoted scalar" };
        }
        catch {
            return { ok: false, reason: "invalid double-quoted scalar" };
        }
    }
    if (value.startsWith("'")) {
        if (value.length < 2 || !value.endsWith("'"))
            return { ok: false, reason: "unterminated single-quoted scalar" };
        return { ok: true, text: value.slice(1, -1).replace(/''/g, "'") };
    }
    if (/^[{&*!|>%@`]/.test(value))
        return { ok: false, reason: "YAML syntax outside the supported grammar" };
    return { ok: true, text: value };
}
/** A flat inline list `[a, 'b', "c"]`; nested collections are refused. */
function readInlineList(raw) {
    const value = raw.trim();
    if (!value.endsWith("]"))
        return { ok: false, reason: "unterminated inline list" };
    const body = value.slice(1, -1);
    if (body.trim() === "")
        return { ok: true, items: [] };
    const items = [];
    let quote = null;
    let current = "";
    for (let index = 0; index < body.length; index++) {
        const character = body[index];
        if (quote) {
            current += character;
            if (character === "\\" && quote === '"' && index + 1 < body.length) {
                current += body[index + 1];
                index++;
            }
            else if (character === quote) {
                quote = null;
            }
            continue;
        }
        if ((character === '"' || character === "'") && current.trim() === "") {
            quote = character;
            current += character;
            continue;
        }
        if (character === "[" || character === "]" || character === "{" || character === "}") {
            return { ok: false, reason: "nested collection in an inline list" };
        }
        if (character === ",") {
            items.push(current);
            current = "";
            continue;
        }
        current += character;
    }
    if (quote)
        return { ok: false, reason: "unterminated quote in an inline list" };
    items.push(current);
    const out = [];
    for (const item of items) {
        if (item.trim() === "")
            return { ok: false, reason: "empty inline list item" };
        const scalar = readScalar(item);
        if (!scalar.ok)
            return { ok: false, reason: scalar.reason };
        out.push(scalar.text);
    }
    return { ok: true, items: out };
}
function isUnresolvedText(text) {
    const value = text.trim();
    return value === "" || value === schema_1.UNKNOWN || value === "~" || /^null$/i.test(value);
}
/**
 * Parse carrier body lines into fields.
 *
 * `pipes` admits the legacy ` | `-separated form, which only the hash carriers use.
 */
function parseBody(lines, pipes) {
    const fields = [];
    const seen = new Set();
    let open = null;
    let pendingList = false;
    const finishPending = () => {
        if (open && pendingList && open.values.length === 0 && open.state === "declared")
            open.state = "unresolved";
        pendingList = false;
    };
    for (const entry of lines) {
        const text = entry.text;
        if (text.trim() === "" || text.trimStart().startsWith("#"))
            continue;
        const indent = text.length - text.trimStart().length;
        const trimmed = text.trim();
        const isItem = trimmed === "-" || trimmed.startsWith("- ");
        if (open && (indent > 0 || isItem)) {
            open.end_line = entry.line;
            if (open.state === "unsupported")
                continue;
            if (pendingList && isItem) {
                const item = trimmed.slice(1).trim();
                if (KEY_VALUE.test(item) || item.startsWith("{") || item.startsWith("[")) {
                    open.state = "unsupported";
                    open.values = [];
                    open.reason = "block list of mappings or collections";
                    continue;
                }
                const scalar = readScalar(stripTrailingComment(item));
                if (!scalar.ok) {
                    open.state = "unsupported";
                    open.values = [];
                    open.reason = scalar.reason;
                    continue;
                }
                if (!isUnresolvedText(scalar.text))
                    open.values.push({ text: scalar.text, line: entry.line });
                continue;
            }
            open.state = "unsupported";
            open.values = [];
            open.reason = "nested mapping or multi-line value";
            continue;
        }
        if (indent > 0 || isItem) {
            return { fields: [], rejected: { code: "native_metadata.malformed", message: "indented or list content with no key to belong to", line: entry.line } };
        }
        finishPending();
        open = null;
        const segments = pipes ? splitPipes(text) : [text];
        for (const segment of segments) {
            const match = KEY_VALUE.exec(segment.trim());
            if (!match) {
                return { fields: [], rejected: { code: "native_metadata.malformed", message: "a header line is not a key: value pair", line: entry.line } };
            }
            const key = match[1];
            if (seen.has(key)) {
                return { fields: [], rejected: { code: "native_metadata.duplicate_field", message: `field '${key}' is declared twice in one header`, line: entry.line } };
            }
            seen.add(key);
            const field = {
                key,
                state: "declared",
                values: [],
                start_line: entry.line,
                end_line: entry.line,
                excerpt: text,
            };
            fields.push(field);
            const raw = stripTrailingComment(match[2] ?? "").trim();
            if (raw === "") {
                // `key:` alone is either a block list that follows or a null; which one is
                // decided by the next lines, never by the key.
                open = field;
                pendingList = segments.length === 1;
                if (!pendingList)
                    field.state = "unresolved";
                continue;
            }
            if (raw.startsWith("[")) {
                const list = readInlineList(raw);
                if (!list.ok) {
                    field.state = "unsupported";
                    field.reason = list.reason;
                }
                else {
                    field.values = list.items.filter((item) => !isUnresolvedText(item)).map((item) => ({ text: item, line: entry.line }));
                    if (field.values.length === 0)
                        field.state = "unresolved";
                }
            }
            else {
                const scalar = readScalar(raw);
                if (!scalar.ok) {
                    field.state = "unsupported";
                    field.reason = scalar.reason;
                }
                else if (isUnresolvedText(scalar.text)) {
                    field.state = "unresolved";
                }
                else {
                    field.values = [{ text: scalar.text, line: entry.line }];
                }
            }
            // Continuation lines after a scalar belong to it; they make it unsupported.
            open = segments.length === 1 ? field : null;
        }
    }
    finishPending();
    return { fields };
}
/** Line number (1-based, `toLines` numbering) of a character offset in `content`. */
function lineOfOffset(content, offset) {
    const start = content.startsWith("﻿") ? 1 : 0;
    const prefix = content.slice(start, Math.max(start, offset));
    const matches = prefix.match(/\r\n|\r|\n/g);
    return (matches ? matches.length : 0) + 1;
}
function declaredSchemaOf(fields) {
    const schema = fields.find((field) => field.key === "l9_schema");
    if (!schema)
        return "none";
    if (schema.state !== "declared" || schema.values.length !== 1)
        return "l9_schema:unreadable";
    return `l9_schema:${schema.values[0].text}`;
}
function declaration(carrier, declaredSchema, sourcePath, span, excerpt, fields) {
    // `l9_schema` is the declaration's identity, not one of its fields.
    const body = fields.filter((field) => field.key !== "l9_schema");
    return {
        carrier,
        declared_schema: declaredSchema,
        source_path: sourcePath,
        source_span: span,
        excerpt,
        fields: body,
        unsupported_fields: body.filter((field) => field.state === "unsupported").map((field) => field.key),
        conflicts: [],
    };
}
const HASH_BODY = (line) => {
    if (!line.startsWith("#"))
        return null;
    return line.slice(line.startsWith("# ") ? 2 : 1);
};
const DELIMITED = [
    { carrier: "legacy-hash", open: MARKERS.hashOpen, close: MARKERS.hashClose, body: HASH_BODY, pipes: true },
    { carrier: "legacy-hash-bare", open: MARKERS.bareOpen, close: MARKERS.bareClose, body: HASH_BODY, pipes: true },
    { carrier: "legacy-html", open: MARKERS.htmlOpen, close: MARKERS.htmlClose, body: (line) => line, pipes: false },
];
function readDelimited(lines, index, sourcePath) {
    const first = lines[index].trimEnd();
    for (const form of DELIMITED) {
        if (first !== form.open)
            continue;
        const body = [];
        for (let cursor = index + 1; cursor < lines.length; cursor++) {
            if (lines[cursor].trimEnd() === form.close) {
                const parsed = parseBody(body, form.pipes);
                if (parsed.rejected) {
                    return {
                        kind: "rejected",
                        next: cursor + 1,
                        region: { carrier: form.carrier, start_line: index + 1, end_line: cursor + 1 },
                        diagnostic: { code: parsed.rejected.code, severity: "warning", message: `${form.carrier} header rejected: ${parsed.rejected.message}`, line: parsed.rejected.line },
                    };
                }
                return {
                    kind: "declaration",
                    next: cursor + 1,
                    value: declaration(form.carrier, declaredSchemaOf(parsed.fields), sourcePath, { start_line: index + 1, end_line: cursor + 1 }, lines[index], parsed.fields),
                };
            }
            const text = form.body(lines[cursor]);
            if (text === null) {
                return {
                    kind: "rejected",
                    next: lines.length,
                    stop: true,
                    // The carrier ends where its comment lines end; the line that broke it is body.
                    region: { carrier: form.carrier, start_line: index + 1, end_line: cursor },
                    diagnostic: { code: "native_metadata.malformed", severity: "warning", message: `${form.carrier} header rejected: a body line is not a comment`, line: cursor + 1 },
                };
            }
            body.push({ text, line: cursor + 1 });
        }
        return {
            kind: "rejected",
            next: lines.length,
            stop: true,
            // Without a close the extent is unknown; only the opening marker is claimed.
            region: { carrier: form.carrier, start_line: index + 1, end_line: index + 1 },
            diagnostic: { code: "native_metadata.unterminated", severity: "warning", message: `${form.carrier} header has no closing '${form.close}'`, line: index + 1 },
        };
    }
    return { kind: "none" };
}
/** The CEG/EIE Python form: `"""` then `--- L9_META ---` … `--- /L9_META ---`. */
function readDocstring(lines, index, sourcePath) {
    if (lines[index].trim() !== '"""' || index + 1 >= lines.length || lines[index + 1].trim() !== MARKERS.docOpen) {
        return { kind: "none" };
    }
    const body = [];
    for (let cursor = index + 2; cursor < lines.length; cursor++) {
        const text = lines[cursor];
        if (text.trim() === MARKERS.docClose) {
            const parsed = parseBody(body, false);
            // The docstring continues after the block; nothing after it is header.
            if (parsed.rejected) {
                return {
                    kind: "rejected",
                    next: lines.length,
                    stop: true,
                    region: { carrier: "legacy-docstring", start_line: index + 2, end_line: cursor + 1 },
                    diagnostic: { code: parsed.rejected.code, severity: "warning", message: `legacy-docstring header rejected: ${parsed.rejected.message}`, line: parsed.rejected.line },
                };
            }
            return {
                kind: "declaration",
                next: lines.length,
                stop: true,
                value: declaration("legacy-docstring", declaredSchemaOf(parsed.fields), sourcePath, { start_line: index + 2, end_line: cursor + 1 }, lines[index + 1], parsed.fields),
            };
        }
        if (text.includes('"""'))
            break;
        body.push({ text, line: cursor + 1 });
    }
    return {
        kind: "rejected",
        next: lines.length,
        stop: true,
        region: { carrier: "legacy-docstring", start_line: index + 2, end_line: index + 2 },
        diagnostic: { code: "native_metadata.unterminated", severity: "warning", message: `legacy-docstring header has no closing '${MARKERS.docClose}' inside its docstring`, line: index + 2 },
    };
}
function readManagedComment(content, lines, index, sourcePath) {
    const spec = (0, comment_1.resolveStrategy)(sourcePath, content);
    if (spec.strategy !== "line-comment" && spec.strategy !== "block-comment")
        return { kind: "none" };
    const span = (0, comment_1.injectedBlockSpan)(content, spec);
    if (!span)
        return { kind: "none" };
    const startLine = lineOfOffset(content, span.start);
    if (startLine !== index + 1)
        return { kind: "none" };
    const endLine = lineOfOffset(content, span.end);
    const body = [];
    for (let cursor = startLine; cursor < endLine - 1; cursor++) {
        const line = lines[cursor];
        if (span.delimiters.strategy === "line-comment") {
            const prefix = span.delimiters.linePrefix ?? "#";
            const trimmed = line.trimStart();
            const text = trimmed.startsWith(`${prefix} `) ? trimmed.slice(prefix.length + 1) : trimmed.slice(prefix.length);
            body.push({ text, line: cursor + 1 });
        }
        else {
            body.push({ text: line, line: cursor + 1 });
        }
    }
    const parsed = parseBody(body, false);
    if (parsed.rejected) {
        return {
            kind: "rejected",
            next: endLine,
            region: { carrier: "managed-comment", start_line: startLine, end_line: endLine },
            diagnostic: { code: parsed.rejected.code, severity: "warning", message: `managed-comment header rejected: ${parsed.rejected.message}`, line: parsed.rejected.line },
        };
    }
    return {
        kind: "declaration",
        next: endLine,
        value: declaration("managed-comment", exports.MANAGED_DECLARED_SCHEMA, sourcePath, { start_line: startLine, end_line: endLine }, lines[index], parsed.fields),
    };
}
/**
 * YAML frontmatter at line 1, through the byte-preserving frontmatter inspector.
 *
 * Only frontmatter that names `l9_schema`, or carries the managed writer's keys,
 * is L9 metadata. Any other frontmatter (a skill's own keys, a site generator's)
 * is a prologue: skipped, never read as a declaration.
 */
function readFrontMatter(content, lines, sourcePath) {
    if (lines.length === 0 || lines[0] !== "---")
        return { kind: "none" };
    let close = -1;
    for (let cursor = 1; cursor < lines.length; cursor++) {
        if (lines[cursor] === "---") {
            close = cursor;
            break;
        }
    }
    if (close < 0)
        return { kind: "none" };
    const region = lines.slice(1, close);
    const native = region.some((line) => /^l9_schema[ \t]*:/.test(line));
    const managed = MANAGED_FRONTMATTER_KEYS.every((key) => region.some((line) => line.startsWith(`${key}:`)));
    if (!native && !managed)
        return { kind: "skip", next: close + 1 };
    const carrier = native ? "frontmatter" : "managed-frontmatter";
    const inspection = (0, frontmatter_patch_1.inspectFrontMatterDocument)(content);
    if (!inspection.safe || !inspection.hadFrontMatter) {
        return {
            kind: "rejected",
            next: close + 1,
            region: { carrier, start_line: 1, end_line: close + 1 },
            diagnostic: {
                code: "native_metadata.frontmatter_unsupported",
                severity: "warning",
                message: `${carrier} header was not read: ${inspection.issue?.code ?? "frontmatter could not be inspected"}`,
                ...(inspection.issue?.line !== undefined ? { line: inspection.issue.line } : {}),
            },
        };
    }
    const fields = [];
    for (const field of inspection.fields) {
        const startLine = lineOfOffset(content, field.start);
        const endLine = Math.max(startLine, lineOfOffset(content, Math.max(field.start, field.end - 1)));
        const excerpt = lines[startLine - 1] ?? "";
        const entry = {
            key: field.key, state: "declared", values: [], start_line: startLine, end_line: endLine, excerpt,
        };
        if (field.kind === "opaque") {
            const text = content.slice(field.valueStart ?? field.start, field.valueEnd ?? field.end);
            if (isUnresolvedText(text))
                entry.state = "unresolved";
            else
                entry.values = [{ text, line: startLine }];
        }
        else {
            const value = inspection.meta[field.key];
            const items = Array.isArray(value) ? value : [value];
            // Sequence items sit one per line after the key; cite each where it is.
            const itemLines = field.kind === "sequence"
                ? lines.slice(startLine, endLine).map((line, offset) => ({ line, number: startLine + 1 + offset }))
                    .filter((item) => /^\s*-(?:\s|$)/.test(item.line)).map((item) => item.number)
                : [];
            items.forEach((item, position) => {
                const text = item === null || item === undefined ? "" : String(item);
                if (isUnresolvedText(text))
                    return;
                entry.values.push({ text, line: itemLines[position] ?? startLine });
            });
            if (entry.values.length === 0)
                entry.state = "unresolved";
        }
        fields.push(entry);
    }
    return {
        kind: "declaration",
        next: close + 1,
        value: declaration(carrier, native ? declaredSchemaOf(fields) : exports.MANAGED_DECLARED_SCHEMA, sourcePath, { start_line: 1, end_line: close + 1 }, lines[0], fields),
    };
}
const PROLOGUE_LINE = [
    /^#!/,
    /^#\s*yaml-language-server:/,
    /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/,
];
/**
 * Read every native metadata declaration at the head of a file.
 *
 * Pure and deterministic: the same path and text always yield the same result,
 * and the text is never modified.
 */
function parseNativeMetadata(sourcePath, content) {
    const lines = (0, common_1.toLines)(content);
    const declarations = [];
    const diagnostics = [];
    const regions = [];
    let index = 0;
    let headerEnd = 0;
    const accept = (step) => {
        if (step.kind === "declaration") {
            declarations.push(step.value);
            regions.push({ carrier: step.value.carrier, ...step.value.source_span, read: true });
        }
        else if (step.kind === "rejected") {
            diagnostics.push(step.diagnostic);
            regions.push({ ...step.region, read: false });
        }
    };
    const front = readFrontMatter(content, lines, sourcePath);
    accept(front);
    if (front.kind !== "none")
        index = front.next;
    while (index < lines.length) {
        const line = lines[index];
        if (line.trim() === "" || PROLOGUE_LINE.some((pattern) => pattern.test(line))) {
            index++;
            continue;
        }
        if (/^#\s*L9_META\s*:/.test(line)) {
            diagnostics.push({
                code: "native_metadata.unsupported_carrier",
                severity: "info",
                message: "single-line L9_META header is outside the supported grammar and was not read",
                line: index + 1,
            });
            index++;
            continue;
        }
        let step = readManagedComment(content, lines, index, sourcePath);
        if (step.kind === "none")
            step = readDelimited(lines, index, sourcePath);
        if (step.kind === "none")
            step = readDocstring(lines, index, sourcePath);
        if (step.kind === "none")
            break;
        accept(step);
        index = step.next;
        if ((step.kind === "declaration" || step.kind === "rejected") && step.stop)
            break;
    }
    headerEnd = index;
    // A marker past the header region is body text — quoted, templated or fenced —
    // and is never read. Say once that it was seen, so its absence from the
    // declarations is not mistaken for absence from the file.
    let outside = 0;
    let firstOutside = 0;
    for (let cursor = headerEnd; cursor < lines.length; cursor++) {
        if (ANY_MARKER.test(lines[cursor])) {
            if (outside === 0)
                firstOutside = cursor + 1;
            outside++;
        }
    }
    if (outside > 0 && !declarations.some((item) => item.carrier === "legacy-docstring")) {
        diagnostics.push({
            code: "native_metadata.marker_outside_header",
            severity: "info",
            message: `${outside} metadata marker line(s) outside the header region were treated as body text`,
            line: firstOutside,
        });
    }
    // Competing declarations: one field declared with incompatible values about
    // this file under one declared schema. Every value stays; the conflict is
    // named, never resolved.
    //
    // Different declared schemas are different predicates (`meta.l9v1.*` vs
    // `meta.managed.*`), so they never compete. A field the governed mapping
    // defines follows its cardinality (ADR-084): a set-valued field aggregates and
    // never competes, and a single-valued field competes as soon as its
    // declarations — or one declaration listing several values — name more than
    // one distinct value. A field the mapping does not govern (the managed header,
    // an unrecognized schema, a key outside the vocabulary) keeps the conservative
    // rule: two declarations whose value lists differ compete.
    const groups = new Map();
    for (const item of declarations) {
        const governed = semantic_mapping_1.RECOGNIZED_DECLARED_SCHEMAS[item.declared_schema] !== undefined;
        for (const field of item.fields) {
            if (field.state !== "declared")
                continue;
            const mapping = governed ? (0, semantic_mapping_1.headerFieldMapping)(field.key) : undefined;
            if (mapping?.cardinality === "set")
                continue;
            const group = `${item.declared_schema}\u0000${field.key}`;
            const entry = groups.get(group) ?? { schema: item.declared_schema, key: field.key, values: new Set() };
            if (mapping?.cardinality === "single") {
                for (const value of field.values)
                    entry.values.add(value.text);
            }
            else {
                entry.values.add(field.values.map((value) => value.text).join("\u0000"));
            }
            groups.set(group, entry);
        }
    }
    const competing = [...groups.values()].filter((entry) => entry.values.size > 1);
    const conflicting = [...new Set(competing.map((entry) => entry.key))].sort(ordering_1.compareCodePoints);
    if (conflicting.length > 0) {
        for (const item of declarations) {
            item.conflicts = conflicting.filter((key) => competing.some((entry) => entry.key === key && entry.schema === item.declared_schema)
                && item.fields.some((field) => field.key === key && field.state === "declared"));
        }
        diagnostics.push({
            code: "native_metadata.competing_declarations",
            severity: "warning",
            message: `declarations in this file disagree on: ${conflicting.join(", ")}`,
        });
    }
    return { declarations, diagnostics, regions };
}
//# sourceMappingURL=native_metadata.js.map