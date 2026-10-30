"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLines = toLines;
exports.lineRange = lineRange;
exports.spanRange = spanRange;
exports.unquote = unquote;
exports.stripComment = stripComment;
exports.indentOf = indentOf;
exports.keyValue = keyValue;
exports.declared = declared;
exports.observed = observed;
exports.basenameIs = basenameIs;
/**
 * Split preserving 1-based line numbering; no trailing-newline phantom line.
 *
 * CRLF, LF and a lone CR are each one line terminator, so line numbers are the
 * ones an editor shows for classic-Mac and mixed-ending files too. One leading
 * byte-order mark is not content and is dropped, so a first-line heading or
 * marker reads the same with or without it. The caller's content string (and
 * any hash of it) is untouched; only the lines handed to an extractor change.
 */
function toLines(content) {
    const text = content.startsWith("\uFEFF") ? content.slice(1) : content;
    const lines = text.split(/\r\n|\r|\n/);
    if (lines.length > 0 && lines[lines.length - 1] === "")
        lines.pop();
    return lines;
}
/** A single-line span. `index` is 0-based; the emitted range is 1-based. */
function lineRange(index) {
    return { start_line: index + 1, end_line: index + 1 };
}
function spanRange(startIndex, endIndex) {
    return { start_line: startIndex + 1, end_line: endIndex + 1 };
}
/** Strip matching surrounding quotes from a scalar. Leaves unquoted text alone. */
function unquote(value) {
    const trimmed = value.trim();
    if (trimmed.length >= 2) {
        const first = trimmed[0];
        const last = trimmed[trimmed.length - 1];
        if ((first === '"' || first === "'") && first === last)
            return trimmed.slice(1, -1);
    }
    return trimmed;
}
/** Drop a trailing `#` comment that is not inside quotes. */
function stripComment(value) {
    let quote = null;
    for (let index = 0; index < value.length; index++) {
        const character = value[index];
        if (quote) {
            if (character === quote)
                quote = null;
            continue;
        }
        if (character === '"' || character === "'") {
            quote = character;
            continue;
        }
        if (character === "#")
            return value.slice(0, index);
    }
    return value;
}
/** Indentation width in spaces. Tabs count as one, consistently. */
function indentOf(line) {
    let width = 0;
    for (const character of line) {
        if (character === " " || character === "\t")
            width++;
        else
            break;
    }
    return width;
}
/**
 * A `key: value` pair at any indentation, or null when the line is not one.
 *
 * Only the fixed-structure prefix (indent, list marker, key, `:`) is matched; the
 * value is taken by slice. A `\s*(.*)$` tail backtracks quadratically when the
 * line holds a character `.` does not match after a long whitespace run.
 */
function keyValue(line) {
    const withoutComment = stripComment(line);
    const match = /^(\s*)(-\s+)?([A-Za-z0-9_.\-"']+)\s*:/.exec(withoutComment);
    if (!match)
        return null;
    return {
        key: unquote(match[3]),
        value: unquote(withoutComment.slice(match[0].length)),
        indent: indentOf(withoutComment) + (match[2] ? match[2].length : 0),
    };
}
/** Build a `declared` assertion from a source line. */
function declared(predicate, object, index, line, confidence = "high") {
    return {
        predicate,
        object,
        sourceRange: lineRange(index),
        evidenceExcerpt: line,
        evidenceClass: "declared",
        authority: "source",
        confidence,
    };
}
/** Build an `observed` assertion from a source line. */
function observed(predicate, object, range, excerpt, confidence = "high") {
    return {
        predicate,
        object,
        sourceRange: range,
        evidenceExcerpt: excerpt,
        evidenceClass: "observed",
        authority: "source",
        confidence,
    };
}
/** True when the repository-relative path's basename equals `name`. */
function basenameIs(sourcePath, name) {
    return sourcePath === name || sourcePath.endsWith(`/${name}`);
}
//# sourceMappingURL=common.js.map