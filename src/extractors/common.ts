// extractors/common.ts — line utilities shared by every extractor.
//
// Extraction is line-oriented on purpose. Every assertion must cite an exact
// span in the file it came from, and a structural parser that discards position
// cannot produce that. Parsing lines also keeps this package dependency-free.
import { AssertionDraft, InterpretedSourceRange } from "../interpretation";

/**
 * Split preserving 1-based line numbering; no trailing-newline phantom line.
 *
 * CRLF, LF and a lone CR are each one line terminator, so line numbers are the
 * ones an editor shows for classic-Mac and mixed-ending files too. One leading
 * byte-order mark is not content and is dropped, so a first-line heading or
 * marker reads the same with or without it. The caller's content string (and
 * any hash of it) is untouched; only the lines handed to an extractor change.
 */
export function toLines(content: string): string[] {
  const text = content.startsWith("\uFEFF") ? content.slice(1) : content;
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** A single-line span. `index` is 0-based; the emitted range is 1-based. */
export function lineRange(index: number): InterpretedSourceRange {
  return { start_line: index + 1, end_line: index + 1 };
}

export function spanRange(startIndex: number, endIndex: number): InterpretedSourceRange {
  return { start_line: startIndex + 1, end_line: endIndex + 1 };
}

/** Strip matching surrounding quotes from a scalar. Leaves unquoted text alone. */
export function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Drop a trailing `#` comment that is not inside quotes. */
export function stripComment(value: string): string {
  let quote: string | null = null;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "#") return value.slice(0, index);
  }
  return value;
}

/** Indentation width in spaces. Tabs count as one, consistently. */
export function indentOf(line: string): number {
  let width = 0;
  for (const character of line) {
    if (character === " " || character === "\t") width++;
    else break;
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
export function keyValue(line: string): { key: string; value: string; indent: number } | null {
  const withoutComment = stripComment(line);
  const match = /^(\s*)(-\s+)?([A-Za-z0-9_.\-"']+)\s*:/.exec(withoutComment);
  if (!match) return null;
  return {
    key: unquote(match[3]),
    value: unquote(withoutComment.slice(match[0].length)),
    indent: indentOf(withoutComment) + (match[2] ? match[2].length : 0),
  };
}

/** Build a `declared` assertion from a source line. */
export function declared(
  predicate: string,
  object: string,
  index: number,
  line: string,
  confidence: AssertionDraft["confidence"] = "high",
): AssertionDraft {
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
export function observed(
  predicate: string,
  object: string,
  range: InterpretedSourceRange,
  excerpt: string,
  confidence: AssertionDraft["confidence"] = "high",
): AssertionDraft {
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
export function basenameIs(sourcePath: string, name: string): boolean {
  return sourcePath === name || sourcePath.endsWith(`/${name}`);
}
