// extractors/static_imports.ts — static import statements as observations (ADR-082).
//
// Reads the import forms a compiler or interpreter resolves without running the
// program, and nothing else:
//
//   Python      import a.b [as c], d        from .x import y        from a.b import (c, d)
//   TS / JS     import … from "s"           import "s"              export … from "s"
//               import x = require("s")     require("s")  (literal argument only)
//
// Each specifier is classified by its syntax:
//
//   source.import.local             <repository-relative path the specifier resolves to>
//   source.import.local_unresolved  <specifier as written>  (relative, but no observed target)
//   source.import.absolute          <package or module name as written>
//   source.import.builtin           <node:… specifier>
//   source.import.url               <URL specifier>
//
// `absolute` is deliberately unclassified: `os`, `requests` and a first-party
// package all read the same, and which one a name is depends on an environment
// this observer does not have. No name is equated with a repository or service,
// and no import becomes a dependency claim — the consumer does not project these
// predicates. Dynamic imports (`import(x)`, `require(variable)`) are counted and
// reported, never interpreted.
//
// A relative specifier resolves only to an observed file, in the documented
// precedence of the importer's own resolver; a specifier that escapes the root,
// or whose candidates were not observed, stays unresolved rather than invented.
import * as posix from "node:path/posix";
import { AssertionDraft, Extractor, ExtractorFileInput } from "../interpretation";
import { observed, spanRange, toLines } from "./common";

const PYTHON = /\.pyi?$/;
const SCRIPT = /\.(?:[cm]?[jt]sx?)$/;

// ───────────────────────────── classification ─────────────────────────────

/** TypeScript importers: TS first, then the JS they may also reach. */
const TS_EXTENSIONLESS = [".ts", ".tsx", ".d.ts", ".js", ".jsx"];
const TS_INDEX = ["/index.ts", "/index.tsx", "/index.d.ts", "/index.js", "/index.jsx"];
/** Node CommonJS precedence for a `.js`/`.cjs`/`.jsx` importer. */
const NODE_EXTENSIONLESS = [".js", ".json", ".cjs"];
const NODE_INDEX = ["/index.js", "/index.json"];
/** TS ESM convention: a `.js` specifier names the `.ts` source beside it. */
const TS_ESM_MAP: Readonly<Record<string, string[]>> = {
  ".js": [".ts", ".tsx", ".d.ts"],
  ".jsx": [".tsx"],
  ".mjs": [".mts", ".d.mts"],
  ".cjs": [".cts", ".d.cts"],
};

function isTypeScriptImporter(sourcePath: string): boolean {
  return /\.(?:[cm]?tsx?)$/.test(sourcePath);
}

/** Candidate files for a relative specifier, in the importer's resolution order. */
function scriptCandidates(importer: string, target: string, specifier: string): string[] {
  const extension = posix.extname(specifier);
  if (isTypeScriptImporter(importer)) {
    const mapped = TS_ESM_MAP[extension];
    if (mapped) {
      const stem = target.slice(0, -extension.length);
      return [...mapped.map((ext) => stem + ext), target];
    }
    if (/\.(?:[cm]?tsx?|json)$/.test(specifier)) return [target];
    return [...TS_EXTENSIONLESS.map((ext) => target + ext), ...TS_INDEX.map((ext) => target + ext)];
  }
  if (importer.endsWith(".mjs")) return [target];
  if (extension !== "") return [target];
  return [target, ...NODE_EXTENSIONLESS.map((ext) => target + ext), ...NODE_INDEX.map((ext) => target + ext)];
}

/** A relative target inside the root, or null when it escapes it. */
function joinInside(importer: string, relative: string): string | null {
  const joined = posix.normalize(posix.join(posix.dirname(importer), relative)).replace(/\/+$/, "");
  if (joined === "." || joined === ".." || joined.startsWith("../") || joined.startsWith("/")) return null;
  return joined;
}

function classifyScript(
  importer: string,
  specifier: string,
  range: AssertionDraft["sourceRange"],
  excerpt: string,
  input: ExtractorFileInput,
): AssertionDraft {
  if (specifier.startsWith("./") || specifier.startsWith("../") || specifier === "." || specifier === "..") {
    const target = joinInside(importer, specifier);
    const found = target === null
      ? undefined
      : scriptCandidates(importer, target, specifier).find((candidate) => input.pathExists(candidate));
    return found !== undefined
      ? observed("source.import.local", found, range, excerpt)
      : observed("source.import.local_unresolved", specifier, range, excerpt);
  }
  if (specifier.startsWith("node:")) return observed("source.import.builtin", specifier, range, excerpt);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(specifier) || specifier.startsWith("data:")) {
    return observed("source.import.url", specifier, range, excerpt);
  }
  const scoped = /^(@[A-Za-z0-9._~-]+\/[A-Za-z0-9._~-]+)(?:\/|$)/.exec(specifier);
  if (scoped) return observed("source.import.absolute", scoped[1], range, excerpt);
  const bare = /^([A-Za-z0-9._~-]+)(?:\/|$)/.exec(specifier);
  if (bare && !bare[1].startsWith(".") && !bare[1].startsWith("_")) {
    return observed("source.import.absolute", bare[1], range, excerpt);
  }
  // `#internal`, `~/x`, `@/x`: aliases resolved through configuration this
  // observer does not read.
  return observed("source.import.local_unresolved", specifier, range, excerpt);
}

// ───────────────────────────── TS / JS scanner ─────────────────────────────

interface Token {
  kind: "word" | "string" | "punct";
  value: string;
  line: number;
  /** Source offset of a punctuation token; adjacency decides `++` / `--`. */
  offset?: number;
}

/** Keywords after which a `/` begins a regular expression rather than a division. */
const REGEX_AFTER_WORD = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield", "await",
]);

/**
 * Tokenize code, skipping comments and the contents of template literals and
 * regular expressions. Returns null when the text cannot be scanned to its end
 * (an unterminated string or comment): a scanner out of step with the source
 * would report imports that are not there.
 */
function scanScript(content: string): Token[] | null {
  const tokens: Token[] = [];
  let line = 1;
  let index = content.startsWith("﻿") ? 1 : 0;
  if (content.startsWith("#!", index)) {
    while (index < content.length && content[index] !== "\n" && content[index] !== "\r") index++;
  }
  const stack: ("brace" | "template")[] = [];
  const newline = (at: number): boolean => {
    const character = content[at];
    if (character === "\n") return true;
    return character === "\r" && content[at + 1] !== "\n";
  };
  /** True when `token` ends an expression, so a following `/` divides. */
  const endsExpression = (token: Token | undefined): boolean => {
    if (!token) return false;
    if (token.kind === "word") return !REGEX_AFTER_WORD.has(token.value);
    if (token.kind === "string") return true;
    return token.value === ")" || token.value === "]" || token.value === "}";
  };
  const regexAllowed = (): boolean => {
    const previous = tokens[tokens.length - 1];
    if (!previous) return true;
    // A postfix `++` / `--` (two adjacent signs after an operand) ends an
    // expression: `x++ / y` divides. Read as a regex start, the slash would run
    // to the end of the line and the whole file would be refused.
    if (previous.kind === "punct" && (previous.value === "+" || previous.value === "-")) {
      const sign = tokens[tokens.length - 2];
      if (
        sign?.kind === "punct" && sign.value === previous.value
        && sign.offset !== undefined && previous.offset === sign.offset + 1
        && endsExpression(tokens[tokens.length - 3])
      ) {
        return false;
      }
    }
    if (previous.kind === "word") return REGEX_AFTER_WORD.has(previous.value);
    if (previous.kind === "string") return false;
    return !(previous.value === ")" || previous.value === "]" || previous.value === "}");
  };
  /** Scan a template body from `index` (after a backtick or `}`); returns false if unterminated. */
  const scanTemplate = (): boolean => {
    while (index < content.length) {
      const character = content[index];
      if (newline(index)) line++;
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === "`") {
        index++;
        tokens.push({ kind: "string", value: "`template`", line });
        return true;
      }
      if (character === "$" && content[index + 1] === "{") {
        index += 2;
        stack.push("template");
        tokens.push({ kind: "punct", value: "${", line });
        return true;
      }
      index++;
    }
    return false;
  };

  while (index < content.length) {
    const character = content[index];
    if (newline(index)) {
      line++;
      index++;
      continue;
    }
    if (character === " " || character === "\t" || character === "\r" || character === "\f" || character === "\v") {
      index++;
      continue;
    }
    if (character === "/" && content[index + 1] === "/") {
      while (index < content.length && content[index] !== "\n" && content[index] !== "\r") index++;
      continue;
    }
    if (character === "/" && content[index + 1] === "*") {
      const close = content.indexOf("*/", index + 2);
      if (close < 0) return null;
      for (let cursor = index; cursor < close; cursor++) if (newline(cursor)) line++;
      index = close + 2;
      continue;
    }
    if (character === '"' || character === "'") {
      const startLine = line;
      let value = "";
      let cursor = index + 1;
      let closed = false;
      while (cursor < content.length) {
        const next = content[cursor];
        if (next === "\\") {
          value += content[cursor + 1] ?? "";
          cursor += 2;
          continue;
        }
        if (next === "\n" || next === "\r") return null;
        if (next === character) {
          closed = true;
          break;
        }
        value += next;
        cursor++;
      }
      if (!closed) return null;
      tokens.push({ kind: "string", value, line: startLine });
      index = cursor + 1;
      continue;
    }
    if (character === "`") {
      index++;
      if (!scanTemplate()) return null;
      continue;
    }
    if (character === "/" && regexAllowed()) {
      let cursor = index + 1;
      let inClass = false;
      let closed = false;
      while (cursor < content.length) {
        const next = content[cursor];
        if (next === "\n" || next === "\r") return null;
        if (next === "\\") {
          cursor += 2;
          continue;
        }
        if (next === "[") inClass = true;
        else if (next === "]") inClass = false;
        else if (next === "/" && !inClass) {
          closed = true;
          break;
        }
        cursor++;
      }
      if (!closed) return null;
      index = cursor + 1;
      while (index < content.length && /[A-Za-z]/.test(content[index])) index++;
      tokens.push({ kind: "string", value: "/regex/", line });
      continue;
    }
    if (/[A-Za-z_$]/.test(character)) {
      let cursor = index + 1;
      while (cursor < content.length && /[\w$]/.test(content[cursor])) cursor++;
      tokens.push({ kind: "word", value: content.slice(index, cursor), line });
      index = cursor;
      continue;
    }
    if (/[0-9]/.test(character)) {
      let cursor = index + 1;
      while (cursor < content.length && /[\w.]/.test(content[cursor])) cursor++;
      tokens.push({ kind: "word", value: "0", line });
      index = cursor;
      continue;
    }
    if (character === "{") stack.push("brace");
    if (character === "}") {
      const top = stack.pop();
      if (top === "template") {
        index++;
        if (!scanTemplate()) return null;
        continue;
      }
    }
    tokens.push({ kind: "punct", value: character, line, offset: index });
    index++;
  }
  return tokens;
}

interface ScriptImport {
  specifier: string;
  startLine: number;
  endLine: number;
}

/** Skip a balanced `{ … }` starting at `at`; returns the index after `}` or -1. */
function skipBraces(tokens: Token[], at: number): number {
  let depth = 0;
  for (let cursor = at; cursor < tokens.length && cursor < at + 2000; cursor++) {
    if (tokens[cursor].kind !== "punct") continue;
    if (tokens[cursor].value === "{") depth++;
    if (tokens[cursor].value === "}") {
      depth--;
      if (depth === 0) return cursor + 1;
    }
  }
  return -1;
}

function isWord(token: Token | undefined, value?: string): boolean {
  return token !== undefined && token.kind === "word" && (value === undefined || token.value === value);
}

function isPunct(token: Token | undefined, value: string): boolean {
  return token !== undefined && token.kind === "punct" && token.value === value;
}

/** `from "s"` at `at`, or null. */
function fromClause(tokens: Token[], at: number): Token | null {
  return isWord(tokens[at], "from") && tokens[at + 1]?.kind === "string" ? tokens[at + 1] : null;
}

function scriptImports(tokens: Token[]): { imports: ScriptImport[]; dynamic: number } {
  const imports: ScriptImport[] = [];
  let dynamic = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    if (token.kind !== "word" || isPunct(previous, ".")) continue;

    if (token.value === "import") {
      let cursor = index + 1;
      if (isPunct(tokens[cursor], "(")) {
        dynamic++;
        continue;
      }
      if (isPunct(tokens[cursor], ".")) continue; // import.meta
      if (tokens[cursor]?.kind === "string") {
        imports.push({ specifier: tokens[cursor].value, startLine: token.line, endLine: tokens[cursor].line });
        continue;
      }
      if (isWord(tokens[cursor], "type") && !isWord(tokens[cursor + 1], "from") && !isPunct(tokens[cursor + 1], ",")) cursor++;
      if (isWord(tokens[cursor]) && !isWord(tokens[cursor], "from")) {
        cursor++;
        if (isPunct(tokens[cursor], "=")) continue; // import x = require("s"): the require rule reads it
        if (isPunct(tokens[cursor], ",")) cursor++;
      }
      if (isPunct(tokens[cursor], "{")) cursor = skipBraces(tokens, cursor);
      else if (isPunct(tokens[cursor], "*") && isWord(tokens[cursor + 1], "as") && isWord(tokens[cursor + 2])) cursor += 3;
      if (cursor < 0) continue;
      const source = fromClause(tokens, cursor);
      if (source) imports.push({ specifier: source.value, startLine: token.line, endLine: source.line });
      continue;
    }

    if (token.value === "export") {
      let cursor = index + 1;
      if (isWord(tokens[cursor], "type")) cursor++;
      if (isPunct(tokens[cursor], "{")) cursor = skipBraces(tokens, cursor);
      else if (isPunct(tokens[cursor], "*")) {
        cursor++;
        if (isWord(tokens[cursor], "as") && isWord(tokens[cursor + 1])) cursor += 2;
      } else continue;
      if (cursor < 0) continue;
      const source = fromClause(tokens, cursor);
      if (source) imports.push({ specifier: source.value, startLine: token.line, endLine: source.line });
      continue;
    }

    if (token.value === "require" && isPunct(tokens[index + 1], "(")) {
      if (isWord(previous, "function")) continue;
      const argument = tokens[index + 2];
      if (argument?.kind === "string" && isPunct(tokens[index + 3], ")") && !argument.value.startsWith("`")) {
        imports.push({ specifier: argument.value, startLine: token.line, endLine: tokens[index + 3].line });
      } else {
        dynamic++;
      }
    }
  }
  return { imports, dynamic };
}

// ───────────────────────────── Python ─────────────────────────────

interface PythonImport {
  level: number;
  module: string;
  line: number;
  endLine: number;
}

/** Python import statements outside strings and comments. */
function pythonImports(lines: string[]): PythonImport[] {
  const imports: PythonImport[] = [];
  let triple: string | null = null;
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index];
    if (triple) {
      // Inside a triple-quoted string: look only for its end.
      const close = raw.indexOf(triple);
      if (close >= 0) {
        triple = null;
        // Code may follow the close on the same line; it is not an import statement start.
      }
      continue;
    }
    const stripped = raw.trimStart();
    // Track a triple-quoted string that opens on this line and does not close on it.
    for (const quote of ['"""', "'''"]) {
      const count = raw.split(quote).length - 1;
      if (count % 2 === 1 && !raw.trimStart().startsWith("#")) triple = quote;
    }
    if (triple && !/^(?:import|from)\s/.test(stripped)) continue;
    let statement = stripped.replace(/\s+#.*$/, "");
    const startIndex = index;
    while (statement.endsWith("\\") && index + 1 < lines.length) {
      index++;
      statement = `${statement.slice(0, -1)} ${lines[index].trim().replace(/\s+#.*$/, "")}`;
    }
    const fromMatch = /^from\s+(\.*)([A-Za-z_][\w.]*)?\s+import\b/.exec(statement);
    if (fromMatch) {
      if (fromMatch[1] === "" && !fromMatch[2]) continue;
      imports.push({ level: fromMatch[1].length, module: fromMatch[2] ?? "", line: startIndex + 1, endLine: index + 1 });
      continue;
    }
    const importMatch = /^import\s+(.+)$/.exec(statement);
    if (!importMatch) continue;
    for (const part of importMatch[1].split(",")) {
      const name = /^\s*([A-Za-z_][\w.]*)(?:\s+as\s+[A-Za-z_]\w*)?\s*$/.exec(part);
      if (name) imports.push({ level: 0, module: name[1], line: startIndex + 1, endLine: index + 1 });
    }
  }
  return imports;
}

function classifyPython(sourcePath: string, item: PythonImport, excerpt: string, input: ExtractorFileInput): AssertionDraft {
  const range = spanRange(item.line - 1, item.endLine - 1);
  if (item.level === 0) return observed("source.import.absolute", item.module, range, excerpt);
  const written = `${".".repeat(item.level)}${item.module}`;
  // `.` is the importer's own package; each further dot climbs one package, and
  // climbing past the repository root resolves nothing.
  let base = posix.dirname(sourcePath);
  for (let climb = 1; climb < item.level; climb++) {
    if (base === ".") return observed("source.import.local_unresolved", written, range, excerpt);
    base = posix.dirname(base);
  }
  const modulePath = item.module.split(".").join("/");
  const stem = item.module === "" ? base : base === "." ? modulePath : `${base}/${modulePath}`;
  const at = (name: string): string => (stem === "." ? name : `${stem}/${name}`);
  // A regular package (`__init__.py`) takes precedence over a module of the same name.
  const candidates = item.module === ""
    ? [at("__init__.py")]
    : [at("__init__.py"), `${stem}.py`, `${stem}.pyi`];
  const found = candidates.find((candidate) => input.pathExists(candidate));
  return found !== undefined
    ? observed("source.import.local", found, range, excerpt)
    : observed("source.import.local_unresolved", written, range, excerpt);
}

// ───────────────────────────── extractor ─────────────────────────────

function importAssertions(input: ExtractorFileInput): AssertionDraft[] {
  const lines = toLines(input.content);
  if (PYTHON.test(input.sourcePath)) {
    return pythonImports(lines).map((item) =>
      classifyPython(input.sourcePath, item, lines[item.line - 1] ?? "", input));
  }
  const tokens = scanScript(input.content);
  if (tokens === null) {
    input.report?.({
      code: "source_import.scan_incomplete",
      severity: "warning",
      message: "the file could not be scanned to its end (unterminated string, comment or expression); no imports were observed",
    });
    return [];
  }
  const { imports, dynamic } = scriptImports(tokens);
  if (dynamic > 0) {
    input.report?.({
      code: "source_import.dynamic_not_interpreted",
      severity: "info",
      message: `${dynamic} dynamic import or require call(s) were not interpreted`,
    });
  }
  return imports.map((item) => classifyScript(
    input.sourcePath,
    item.specifier,
    spanRange(item.startLine - 1, item.endLine - 1),
    lines[item.startLine - 1] ?? "",
    input,
  ));
}

export const staticImportExtractor: Extractor = {
  id: "static-imports/v1",
  version: "1.0.0",
  // An import is a statement a file makes about what it loads.
  subjectScope: "artifact",
  matches(sourcePath) {
    return PYTHON.test(sourcePath) || SCRIPT.test(sourcePath);
  },
  extract: importAssertions,
};
