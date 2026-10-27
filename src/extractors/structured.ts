// extractors/structured.ts — extractors over machine-readable declarations.
//
// These read manifests, service specs, and contract files. They report the
// fields those files state, and nothing else: no normalization of a package
// name into a service name, no merging of two action lists, no judgement about
// whether a declared dependency is actually used.
import { AssertionDraft, Extractor, ExtractorFileInput } from "../interpretation";
import { basenameIs, declared, keyValue, spanRange, stripComment, toLines, unquote } from "./common";

// ───────────────────────────── manifest/v1 ─────────────────────────────

/** Dependency names worth reporting as a framework or server declaration. */
const FRAMEWORK_DEPENDENCIES = new Set([
  "fastapi",
  "django",
  "flask",
  "starlette",
  "express",
  "next",
  "nestjs",
  "axum",
  "actix-web",
  "rocket",
]);
const SERVER_DEPENDENCIES = new Set(["uvicorn", "gunicorn", "hypercorn", "daphne", "waitress"]);

/** One `package.dependency` claim plus the framework/server reading of its name. */
function dependencyDrafts(
  name: string,
  index: number,
  line: string,
  servers: boolean,
): AssertionDraft[] {
  const drafts = [declared("package.dependency", name, index, line, "medium")];
  if (FRAMEWORK_DEPENDENCIES.has(name)) drafts.push(declared("package.framework", name, index, line));
  // Cargo never read the server vocabulary (it names Python servers).
  if (servers && SERVER_DEPENDENCIES.has(name)) drafts.push(declared("package.server", name, index, line));
  return drafts;
}

/**
 * A TOML table header, or null when the line is not one.
 *
 * `[[name]]` (an array of tables) is a section change like `[name]`, but it never
 * names a dependency or package table: its keys describe one element of a list
 * (a `[[bin]]` target, a `[[tool.poetry.source]]` index), so `array` lets the
 * caller refuse to read them as declarations.
 */
function tomlHeader(bare: string): { name: string; array: boolean } | null {
  const arrayMatch = /^\[\[([^\]]+)\]\]$/.exec(bare);
  if (arrayMatch) return { name: arrayMatch[1].trim(), array: true };
  const tableMatch = /^\[([^\]]+)\]$/.exec(bare);
  if (tableMatch) return { name: tableMatch[1].trim(), array: false };
  return null;
}

/**
 * A `key = value` pair. The pattern matches only the fixed-structure prefix and
 * the value is taken by slice, so the cost is linear in the line length on any
 * input (a quantified tail before `$` backtracks quadratically on characters `.`
 * does not match).
 */
function tomlPair(bare: string): { key: string; rawValue: string } | null {
  const prefix = /^([A-Za-z0-9_.-]+)\s*=/.exec(bare);
  if (!prefix) return null;
  const rawValue = bare.slice(prefix[0].length).trim();
  if (rawValue === "") return null;
  return { key: prefix[1], rawValue };
}

/**
 * Poetry tables whose keys are dependency names.
 *
 * An exact set, not a suffix: `[project.optional-dependencies]` also ends in
 * "dependencies", but its keys are extras group names. Poetry dev groups are
 * kept as they were read before (DEC-RC-093).
 */
function isPoetryDependencyTable(name: string): boolean {
  return (
    name === "tool.poetry.dependencies" ||
    name === "tool.poetry.dev-dependencies" ||
    /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(name)
  );
}

/**
 * Read a TOML array of strings that opens at `lines[startIndex]` offset `start`
 * (the character after `=`), across as many lines as it spans.
 *
 * Returns each string element with the line it appears on, and the index of the
 * line holding the closing `]`. Returns null when the value is not a plain array
 * of strings or is never closed: an array this reader cannot bound is reported as
 * nothing rather than as a guess.
 */
function tomlStringArray(
  lines: string[],
  startIndex: number,
  start: number,
): { elements: { value: string; index: number }[]; endIndex: number } | null {
  const elements: { value: string; index: number }[] = [];
  let opened = false;
  for (let index = startIndex; index < lines.length; index++) {
    const line = lines[index];
    let position = index === startIndex ? start : 0;
    while (position < line.length) {
      const character = line[position];
      if (character === " " || character === "\t" || character === ",") {
        position++;
        continue;
      }
      if (character === "#") break;
      if (!opened) {
        if (character !== "[") return null;
        opened = true;
        position++;
        continue;
      }
      if (character === "]") return { elements, endIndex: index };
      if (character === '"' || character === "'") {
        // Triple-quoted strings are not requirement strings; refuse them.
        if (line.startsWith(character.repeat(3), position)) return null;
        let value = "";
        let cursor = position + 1;
        let closed = false;
        while (cursor < line.length) {
          const next = line[cursor];
          if (character === '"' && next === "\\" && cursor + 1 < line.length) {
            value += line[cursor + 1];
            cursor += 2;
            continue;
          }
          if (next === character) {
            closed = true;
            break;
          }
          value += next;
          cursor++;
        }
        // Single-line strings cannot continue onto the next line.
        if (!closed) return null;
        elements.push({ value, index });
        position = cursor + 1;
        continue;
      }
      // Anything else (a nested array, an inline table, a bare word) is not a
      // requirement list this reader understands.
      return null;
    }
  }
  return null;
}

/** The distribution name a PEP 508 requirement starts with, lower-cased; null when none. */
function requirementName(requirement: string): string | null {
  const match = /^\s*[A-Za-z0-9][A-Za-z0-9._-]*/.exec(requirement);
  if (!match) return null;
  // PEP 508 names end in a letter or digit; trailing separators are not part of
  // the name. Trimmed by index, not by an unanchored pattern, to stay linear.
  let name = match[0].trim();
  let end = name.length;
  while (end > 0 && ".-_".includes(name[end - 1])) end--;
  name = name.slice(0, end);
  return name === "" ? null : name.toLowerCase();
}

function pyprojectAssertions(lines: string[]): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];
  let section = "";
  let arraySection = false;
  let sawPoetry = false;
  let sawBuildBackend = false;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const bare = stripComment(line).trim();
    const header = tomlHeader(bare);
    if (header) {
      section = header.name;
      arraySection = header.array;
      if (!arraySection && section === "tool.poetry") sawPoetry = true;
      continue;
    }
    // Keys of an array-of-tables element are never package or dependency fields.
    if (arraySection) continue;
    const pair = tomlPair(bare);
    if (!pair) continue;
    const { key, rawValue } = pair;
    const value = unquote(rawValue);

    if ((section === "tool.poetry" || section === "project") && key === "name") {
      drafts.push(declared("package.name", value, index, line));
      continue;
    }
    if (section === "project" && key === "dependencies" && rawValue.startsWith("[")) {
      // PEP 621: an array of PEP 508 requirement strings, possibly multi-line.
      const equals = line.indexOf("=");
      const array = equals < 0 ? null : tomlStringArray(lines, index, equals + 1);
      if (!array) continue;
      for (const element of array.elements) {
        const name = requirementName(element.value);
        if (name) drafts.push(...dependencyDrafts(name, element.index, lines[element.index], true));
      }
      index = array.endIndex;
      continue;
    }
    if (section === "build-system" && key === "build-backend") {
      sawBuildBackend = true;
      // `poetry.core.masonry.api` names the packaging system in use.
      const system = value.split(".")[0];
      drafts.push(declared("package.build_backend", value, index, line));
      if (system) drafts.push(declared("package.packaging_system", system, index, line));
      continue;
    }
    if (isPoetryDependencyTable(section)) {
      if (key === "python") {
        drafts.push(declared("package.python_constraint", value, index, line));
        continue;
      }
      drafts.push(...dependencyDrafts(key.toLowerCase(), index, line, true));
    }
  }

  // `[tool.poetry]` alone is a packaging declaration even without a build-system.
  if (sawPoetry && !sawBuildBackend) {
    const index = lines.findIndex((line) => stripComment(line).trim() === "[tool.poetry]");
    if (index >= 0) drafts.push(declared("package.packaging_system", "poetry", index, lines[index]));
  }
  return drafts;
}

/** A JSON string token's value, decoded; the raw text when it does not decode. */
function decodeJsonString(raw: string): string {
  try {
    const decoded: unknown = JSON.parse(`"${raw}"`);
    return typeof decoded === "string" ? decoded : raw;
  } catch {
    return raw;
  }
}

interface JsonFrame {
  kind: "object" | "array";
  /** True for the top-level `dependencies` object. */
  dependencies: boolean;
  /** Object frames: the pending key and the line it was read on. */
  key: string | null;
  keyIndex: number;
  /** Object frames: true between a key and its `:`. */
  awaitingColon: boolean;
}

/**
 * package.json read with a string-aware depth scan.
 *
 * `name` and `version` are read only at depth 1 (the top-level object), and
 * dependency entries only at depth 2 inside the top-level `dependencies` object,
 * however the file is laid out: one key per line, inline objects, or minified on
 * a single line. Each claim cites the line its key is on. A malformed file stops
 * the scan where it stops being attributable — an unterminated string or an
 * unbalanced closer ends the read, keeping only claims already made at a known
 * depth.
 */
function packageJsonAssertions(lines: string[]): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];
  const stack: JsonFrame[] = [];
  let started = false;

  const valueString = (frame: JsonFrame, value: string) => {
    if (frame.kind !== "object" || frame.key === null) return;
    const key = frame.key;
    const index = frame.keyIndex;
    if (stack.length === 1) {
      if (key === "name") drafts.push(declared("package.name", value, index, lines[index]));
      if (key === "version") drafts.push(declared("package.version", value, index, lines[index]));
    } else if (stack.length === 2 && frame.dependencies) {
      drafts.push(...dependencyDrafts(key.toLowerCase(), index, lines[index], true));
    }
  };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    let position = 0;
    while (position < line.length) {
      const character = line[position];
      const top = stack[stack.length - 1];
      if (character === '"') {
        let cursor = position + 1;
        while (cursor < line.length && line[cursor] !== '"') {
          cursor += line[cursor] === "\\" ? 2 : 1;
        }
        // JSON strings never span lines: an unterminated one ends the read.
        if (cursor >= line.length) return drafts;
        const text = decodeJsonString(line.slice(position + 1, cursor));
        position = cursor + 1;
        if (!top) continue;
        if (top.kind === "object" && top.key === null) {
          top.key = text;
          top.keyIndex = index;
          top.awaitingColon = true;
        } else if (top.kind === "object" && !top.awaitingColon) {
          valueString(top, text);
          top.key = null;
        }
        continue;
      }
      if (character === ":") {
        if (top && top.kind === "object") top.awaitingColon = false;
        position++;
        continue;
      }
      if (character === "{" || character === "[") {
        if (stack.length === 0 && started) return drafts;
        started = true;
        const opensDependencies =
          character === "{" &&
          stack.length === 1 &&
          top !== undefined &&
          top.kind === "object" &&
          top.key === "dependencies" &&
          !top.awaitingColon;
        stack.push({
          kind: character === "{" ? "object" : "array",
          dependencies: opensDependencies,
          key: null,
          keyIndex: -1,
          awaitingColon: false,
        });
        position++;
        continue;
      }
      if (character === "}" || character === "]") {
        const closing = stack.pop();
        if (!closing || closing.kind !== (character === "}" ? "object" : "array")) return drafts;
        const parent = stack[stack.length - 1];
        if (parent && parent.kind === "object") parent.key = null;
        position++;
        continue;
      }
      if (character === ",") {
        if (top && top.kind === "object") top.key = null;
        position++;
        continue;
      }
      // Whitespace and scalar literals (numbers, true/false/null): a scalar
      // value ends its key's pair at the next `,` or closer.
      position++;
    }
  }
  return drafts;
}

function cargoAssertions(lines: string[]): AssertionDraft[] {
  const drafts: AssertionDraft[] = [];
  let section = "";
  let arraySection = false;
  lines.forEach((line, index) => {
    const bare = stripComment(line).trim();
    const header = tomlHeader(bare);
    if (header) {
      section = header.name;
      arraySection = header.array;
      return;
    }
    // `[[bin]]`, `[[example]]`, ... describe targets, not the package.
    if (arraySection) return;
    const pair = tomlPair(bare);
    if (!pair) return;
    const value = unquote(pair.rawValue);
    if (section === "package" && pair.key === "name") {
      drafts.push(
        declared("package.name", value, index, line),
        declared("package.packaging_system", "cargo", index, line),
      );
    }
    if (section === "dependencies") {
      drafts.push(...dependencyDrafts(pair.key.toLowerCase(), index, line, false));
    }
  });
  return drafts;
}

export const manifestExtractor: Extractor = {
  id: "manifest/v1",
  // 1.1.0: array-of-tables headers end a section, extras groups are not
  // dependency tables, PEP 621 dependency arrays are read, and package.json is
  // read by depth rather than by line shape (RC-093).
  version: "1.1.0",
  matches(sourcePath) {
    return (
      basenameIs(sourcePath, "pyproject.toml") ||
      basenameIs(sourcePath, "package.json") ||
      basenameIs(sourcePath, "Cargo.toml")
    );
  },
  extract(input: ExtractorFileInput) {
    const lines = toLines(input.content);
    if (basenameIs(input.sourcePath, "pyproject.toml")) return pyprojectAssertions(lines);
    if (basenameIs(input.sourcePath, "package.json")) return packageJsonAssertions(lines);
    return cargoAssertions(lines);
  },
};

// ───────────────────────────── service-spec/v1 ─────────────────────────────

export const serviceSpecExtractor: Extractor = {
  id: "service-spec/v1",
  version: "1.0.0",
  matches(sourcePath) {
    return basenameIs(sourcePath, "spec.yaml") || basenameIs(sourcePath, "spec.yml");
  },
  extract(input: ExtractorFileInput) {
    const drafts: AssertionDraft[] = [];
    const lines = toLines(input.content);
    let block: "service" | "actions" | null = null;

    lines.forEach((line, index) => {
      const pair = keyValue(line);
      if (!pair) return;
      if (pair.indent === 0) {
        if (pair.key === "service") block = "service";
        else if (pair.key === "actions") block = "actions";
        else block = null;
        return;
      }
      if (block === "service") {
        if (pair.key === "name" && pair.value) {
          drafts.push(declared("service.name", pair.value, index, line));
        }
        if (pair.key === "version" && pair.value) {
          drafts.push(declared("service.version", pair.value, index, line));
        }
        return;
      }
      if (block === "actions" && pair.key === "name" && pair.value) {
        // A list item under `actions:` names one action the spec declares.
        if (/^\s*-\s+/.test(stripComment(line))) {
          drafts.push(declared("service.action", pair.value, index, line));
        }
      }
    });
    return drafts;
  },
};

// ─────────────────────── contract-invariants/v1 ───────────────────────

/**
 * Invariant vocabulary this profile recognizes.
 *
 * Each entry names a canonical predicate object and the phrases that evidence
 * it. The extractor reports only that the contract file states the invariant —
 * never that the repository upholds it.
 */
const INVARIANT_RULES: { object: string; patterns: RegExp[] }[] = [
  {
    object: "gate-compatible-ingress",
    patterns: [
      /\bgate[- ]compatible\b/i,
      /\bthrough\s+(?:the\s+)?gate\b/i,
      /\bgate\s+ingress\b/i,
      /\benters?\s+through\s+gate\b/i,
    ],
  },
  {
    object: "tenant-context-immutable",
    patterns: [/\btenant[_ ]context\b[^.\n]*\bimmutable\b/i, /\bimmutable\b[^.\n]*\btenant\b/i],
  },
  {
    object: "packets-derived-not-mutated",
    patterns: [
      /\bderivation\b[^.\n]*\b(?:not|never)\b[^.\n]*\bmutat/i,
      /\bderived?\b[^.\n]*\brather\s+than\b[^.\n]*\bmutat/i,
      /\bderived?,?\s+(?:not|never)\s+mutat/i,
      /\bnever\s+mutat/i,
    ],
  },
  {
    object: "replay-is-explicit",
    patterns: [/\breplay\b[^.\n]*\bexplicit\b/i, /\bexplicit\b[^.\n]*\breplay\b/i],
  },
  {
    object: "lineage-is-reconstructable",
    patterns: [
      /\blineage\b[^.\n]*\breconstruct/i,
      /\breconstruct\w*\b[^.\n]*\blineage\b/i,
      /\blineage\b[^.\n]*\btraceable\b/i,
    ],
  },
];

export const contractInvariantsExtractor: Extractor = {
  id: "contract-invariants/v1",
  version: "1.0.0",
  matches(sourcePath) {
    return /^contracts\/.+\.(ya?ml|md)$/.test(sourcePath);
  },
  extract(input: ExtractorFileInput) {
    const drafts: AssertionDraft[] = [];
    const lines = toLines(input.content);
    // One assertion per invariant per file: the first line that evidences it.
    const claimed = new Set<string>();
    lines.forEach((line, index) => {
      for (const rule of INVARIANT_RULES) {
        if (claimed.has(rule.object)) continue;
        if (rule.patterns.some((pattern) => pattern.test(line))) {
          claimed.add(rule.object);
          drafts.push(declared("contract.invariant", rule.object, index, line));
        }
      }
    });
    if (drafts.length > 0) {
      drafts.push({
        predicate: "contract.declares_invariants",
        object: input.sourcePath,
        sourceRange: spanRange(0, Math.max(0, lines.length - 1)),
        evidenceExcerpt: `contract file stating ${drafts.length} recognized invariant(s)`,
        evidenceClass: "declared",
        authority: "source",
        confidence: "high",
      });
    }
    return drafts;
  },
};
