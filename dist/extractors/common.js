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
/** Split preserving 1-based line numbering; no trailing-newline phantom line. */
function toLines(content) {
    const lines = content.split(/\r?\n/);
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
/** A `key: value` pair at any indentation, or null when the line is not one. */
function keyValue(line) {
    const withoutComment = stripComment(line);
    const match = /^(\s*)(-\s+)?([A-Za-z0-9_.\-"']+)\s*:\s*(.*)$/.exec(withoutComment);
    if (!match)
        return null;
    return {
        key: unquote(match[3]),
        value: unquote(match[4]),
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