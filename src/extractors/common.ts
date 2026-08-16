// extractors/common.ts — line utilities shared by every extractor.
//
// Extraction is line-oriented on purpose. Every assertion must cite an exact
// span in the file it came from, and a structural parser that discards position
// cannot produce that. Parsing lines also keeps this package dependency-free.
import { AssertionDraft, InterpretedSourceRange } from "../interpretation";

/** Split preserving 1-based line numbering; no trailing-newline phantom line. */
export function toLines(content: string): string[] {
  const lines = content.split(/\r?\n/);
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

/** A `key: value` pair at any indentation, or null when the line is not one. */
export function keyValue(line: string): { key: string; value: string; indent: number } | null {
  const withoutComment = stripComment(line);
  const match = /^(\s*)(-\s+)?([A-Za-z0-9_.\-"']+)\s*:\s*(.*)$/.exec(withoutComment);
  if (!match) return null;
  return {
    key: unquote(match[3]),
    value: unquote(match[4]),
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
