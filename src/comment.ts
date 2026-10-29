// comment.ts — Filetype-aware injection strategy.
// The injector must annotate ANY text filetype without corrupting it. Markdown
// takes YAML frontmatter; source/config take a comment-wrapped block (line or block
// comment) placed at the carrier position — the first byte after every mandatory
// prologue (BOM, shebang, encoding cookie, XML declaration, bare `<?php` line,
// `@charset` line, Dockerfile parser directives); a file whose language leaves no
// inert position, comment-less formats (JSON), .txt/.text, and unknown text get a
// sidecar file; binary/media files are skipped. Body is preserved verbatim — the
// injected block is delimited by sentinels and recognised only at the carrier
// position (or the legacy byte-0 position), so it can be detected and replaced (ADR-057).

import * as path from "node:path";
import { ARCHIVE_EXTENSIONS } from "./archive_formats";

export type InjectionStrategy =
  | "yaml-frontmatter"
  | "line-comment"
  | "block-comment"
  | "sidecar"
  | "skip-binary";

/**
 * A construct that must stay first in its file, so the carrier is placed after it
 * (ADR-057). A shebang line is honoured for every comment strategy without one.
 */
export type CarrierPrologue =
  | "xml-declaration"       // `<?xml ...?>` at byte 0, ending its line
  | "php-open-tag"          // a bare `<?php` line (anything else routes to a sidecar)
  | "encoding-cookie"       // PEP 263 / Ruby magic comment on line 1, or line 2
  | "css-charset"           // `@charset "...";` at byte 0, ending its line
  | "dockerfile-directives"; // leading `# syntax=` / `# escape=` / `# check=` lines

export interface StrategySpec {
  strategy: InjectionStrategy;
  linePrefix?: string;   // line-comment: e.g. "//", "#", "--"
  blockOpen?: string;    // block-comment open, e.g. "<!--", "/*"
  blockClose?: string;   // block-comment close, e.g. "-->", "*/"
  /** Mandatory prologue the carrier follows (ADR-057). */
  prologue?: CarrierPrologue;
  /**
   * Delimiters an earlier version wrote for this file type. A head block in that
   * form is still recognised, so the next write replaces it instead of stacking a
   * second block (ADR-057).
   */
  legacyCarrier?: StrategySpec;
}

// Sentinels used to locate a previously-injected block for idempotent re-injection.
const START = ">>> l9:meta >>>";
const END = "<<< l9:meta <<<";
const BLOCK_START = "l9:meta:start";
const BLOCK_END = "l9:meta:end";

export const PROSE_EXTS = new Set([".md", ".markdown", ".mdx", ".txt", ".text", ".rst"]);
export const FRONTMATTER_EXTS = new Set([".md", ".markdown"]);

const LINE_COMMENT: Record<string, string> = {
  ".ts": "//", ".tsx": "//", ".js": "//", ".jsx": "//", ".mjs": "//", ".cjs": "//",
  ".java": "//", ".c": "//", ".h": "//", ".cpp": "//", ".hpp": "//", ".cc": "//", ".hh": "//",
  ".cs": "//", ".go": "//", ".rs": "//", ".swift": "//", ".kt": "//", ".kts": "//",
  ".scala": "//", ".php": "//", ".dart": "//", ".groovy": "//", ".proto": "//",
  ".sol": "//", ".zig": "//", ".v": "//", ".d": "//",
  ".py": "#", ".rb": "#", ".sh": "#", ".bash": "#", ".zsh": "#", ".fish": "#",
  ".pl": "#", ".pm": "#", ".r": "#", ".jl": "#", ".yaml": "#", ".yml": "#",
  ".toml": "#", ".ini": "#", ".cfg": "#", ".conf": "#", ".properties": "#",
  ".tf": "#", ".tfvars": "#", ".env": "#", ".mk": "#", ".ps1": "#", ".psm1": "#",
  ".nim": "#", ".ex": "#", ".exs": "#", ".gd": "#", ".coffee": "#", ".dockerfile": "#",
  // CodeQL: .ql is QL source ('//' comments); .qls is a query suite (YAML).
  ".ql": "//", ".qls": "#",
  // Sass indented syntax: '/*' comments are indentation-scoped, '//' lines are silent.
  ".sass": "//",
  ".sql": "--", ".lua": "--", ".hs": "--", ".elm": "--", ".adb": "--", ".ads": "--",
  ".lisp": ";", ".clj": ";", ".cljs": ";", ".cljc": ";", ".el": ";", ".scm": ";",
  ".asm": ";", ".s": ";",
  ".tex": "%", ".erl": "%", ".m": "%",
};

// Files with no extension (or dotfiles whose whole name is the "extension").
const BASENAME_LINE_COMMENT: Record<string, string> = {
  "dockerfile": "#", "makefile": "#", "gnumakefile": "#", "rakefile": "#",
  "gemfile": "#", "vagrantfile": "#", "brewfile": "#", "procfile": "#",
  ".gitignore": "#", ".npmignore": "#", ".dockerignore": "#", ".gitattributes": "#",
  ".env": "#", ".bashrc": "#", ".zshrc": "#", ".profile": "#", ".editorconfig": "#",
  "codeowners": "#",
};

const BLOCK_COMMENT: Record<string, { open: string; close: string }> = {
  ".html": { open: "<!--", close: "-->" }, ".htm": { open: "<!--", close: "-->" },
  ".xml": { open: "<!--", close: "-->" }, ".xhtml": { open: "<!--", close: "-->" },
  ".svg": { open: "<!--", close: "-->" }, ".vue": { open: "<!--", close: "-->" },
  ".xsl": { open: "<!--", close: "-->" }, ".xslt": { open: "<!--", close: "-->" },
  ".css": { open: "/*", close: "*/" }, ".scss": { open: "/*", close: "*/" },
  ".less": { open: "/*", close: "*/" },
};

// Mandatory prologues per extension / extension-less basename (ADR-057).
const PROLOGUE_BY_EXT: Record<string, CarrierPrologue> = {
  ".xml": "xml-declaration", ".svg": "xml-declaration", ".xsl": "xml-declaration",
  ".xslt": "xml-declaration", ".xhtml": "xml-declaration",
  ".php": "php-open-tag",
  ".py": "encoding-cookie", ".pyw": "encoding-cookie", ".rb": "encoding-cookie",
  ".css": "css-charset", ".scss": "css-charset", ".less": "css-charset",
  ".dockerfile": "dockerfile-directives",
};
const PROLOGUE_BY_BASENAME: Record<string, CarrierPrologue> = { "dockerfile": "dockerfile-directives" };

// Delimiters written before ADR-057 corrected the table; recognised for one repair.
const LEGACY_CARRIER_BY_EXT: Record<string, StrategySpec> = {
  ".ql": { strategy: "line-comment", linePrefix: "#" },
  ".sass": { strategy: "block-comment", blockOpen: "/*", blockClose: "*/" },
};

// Structured formats with no comment syntax → sidecar (file body must stay parseable).
const SIDECAR_EXTS = new Set([".json", ".jsonc", ".json5", ".geojson", ".csv", ".tsv", ".lock"]);

// Known binary / media extensions → skip (never inspected as text).
const BINARY_EXTS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".tif", ".tiff",
  ".pdf", ".mp3", ".mp4", ".wav", ".flac", ".ogg", ".mov", ".avi", ".mkv", ".webm",
  // Every archive extension the package recognizes, expandable or not (one owner).
  ...ARCHIVE_EXTENSIONS,
  ".woff", ".woff2", ".ttf", ".eot", ".otf",
  ".exe", ".dll", ".so", ".dylib", ".class", ".o", ".a", ".lib", ".wasm", ".bin", ".dat",
  // Bytecode / ephemeral noise — skip entirely (no sidecar, no inventory inject).
  ".pyc", ".pyo", ".pyd", ".log",
]);

/** Heuristic: a NUL byte in the first 8 KB means the file is not UTF-8 text. */
export function isProbablyBinary(raw: string): boolean {
  const n = Math.min(raw.length, 8192);
  for (let i = 0; i < n; i++) if (raw.codePointAt(i) === 0) return true;
  return false;
}

export function resolveStrategy(filePath: string, raw: string): StrategySpec {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();

  if (BINARY_EXTS.has(ext)) return { strategy: "skip-binary" };
  if (isProbablyBinary(raw)) return { strategy: "skip-binary" };

  // .txt/.text are text but not prose-frontmatter carriers: their metadata rides
  // in a sidecar (matches scanFiles, which reports headerConvention="none" for them).
  if (FRONTMATTER_EXTS.has(ext)) return { strategy: "yaml-frontmatter" };

  const linePrefix = LINE_COMMENT[ext] ?? BASENAME_LINE_COMMENT[base];
  if (linePrefix) return withCarrierPosition({ strategy: "line-comment", linePrefix }, ext, base, raw);

  const block = BLOCK_COMMENT[ext];
  if (block) return withCarrierPosition({ strategy: "block-comment", blockOpen: block.open, blockClose: block.close }, ext, base, raw);

  if (SIDECAR_EXTS.has(ext)) return { strategy: "sidecar" };

  // Unknown text extension: sidecar is the only universally safe option.
  return { strategy: "sidecar" };
}

/**
 * Whether the file's extension (or extension-less basename) belongs to a
 * comment-carrier family — a line- or block-comment language — decided on the
 * name alone. `resolveStrategy` also consults content (a PHP template with no bare
 * `<?php` line routes to a sidecar), so discovery uses this to classify a file as
 * known text independently of what it contains. Internal: not re-exported from
 * the package's public surfaces.
 */
export function hasCommentCarrierFamily(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (BINARY_EXTS.has(ext)) return false;
  return LINE_COMMENT[ext] !== undefined || BASENAME_LINE_COMMENT[base] !== undefined || BLOCK_COMMENT[ext] !== undefined;
}

export function sidecarPathFor(filePath: string): string {
  return filePath + ".l9meta.yaml";
}

/** Strip the `---` fences from a serialized frontmatter block, leaving inner YAML lines. */
export function frontMatterInner(yamlFrontMatter: string): string {
  return yamlFrontMatter.replace(/^---\r?\n/, "").replace(/\r?\n---\s*$/, "");
}

function esc(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

export type NewlineConvention = "\n" | "\r\n";

/**
 * The newline convention a text body already uses: whichever the first line
 * ending is. A file with no line ending yet is treated as LF. The injected block
 * adopts the file's convention so a CRLF source does not come back with LF
 * inside its header and CRLF everywhere else.
 */
export function detectNewlineConvention(text: string): NewlineConvention {
  const lf = text.indexOf("\n");
  return lf > 0 && text[lf - 1] === "\r" ? "\r\n" : "\n";
}

/**
 * Character sequences a carrier cannot hold inside its block (ADR-057, RC-003): the
 * block's own END sentinel text for every carrier; `--` inside `<!-- -->` (XML forbids
 * it in comments, and it covers `-->`); `*\/` and Sass interpolation `#{` inside
 * `/* *\/`; and the line terminators a line comment does not survive (CR, NEL, LS, PS —
 * LF is always escaped by the serializer). Callers pass this set to
 * `serializeYamlObject({ forbidden })` before `yamlToBlock`.
 */
export function carrierForbiddenSequences(spec: StrategySpec): string[] {
  if (spec.strategy === "line-comment") return [END, "\r", "\u0085", "\u2028", "\u2029"];
  if (spec.strategy === "block-comment") {
    if (spec.blockOpen === "<!--") return [BLOCK_END, "--"];
    if (spec.blockOpen === "/*") return [BLOCK_END, "*/", "#{"];
    return [BLOCK_END, spec.blockClose ?? ""].filter((seq) => seq !== "");
  }
  return [];
}

/**
 * Wrap inner YAML in the comment style for this spec. Returns the block (no trailing newline).
 * Inner YAML that still holds a carrier-forbidden sequence is refused rather than
 * written as a broken host file (CARRIER_UNREPRESENTABLE).
 */
export function yamlToBlock(yamlInner: string, spec: StrategySpec, newline: NewlineConvention = "\n"): string {
  const lines = yamlInner.split(/\r?\n/);
  const hazard = carrierForbiddenSequences(spec).find((seq) => lines.some((line) => line.includes(seq)));
  if (hazard !== undefined) {
    throw new Error(`CARRIER_UNREPRESENTABLE: the ${spec.strategy} block cannot hold ${JSON.stringify(hazard)}; serialize with carrierForbiddenSequences(spec)`);
  }
  if (spec.strategy === "line-comment") {
    const p = spec.linePrefix!;
    const out = [`${p} ${START}`, ...lines.map((l) => (l === "" ? p : `${p} ${l}`)), `${p} ${END}`];
    return out.join(newline);
  }
  if (spec.strategy === "block-comment") {
    return [`${spec.blockOpen} ${BLOCK_START}`, ...lines, `${BLOCK_END} ${spec.blockClose}`].join(newline);
  }
  throw new Error(`yamlToBlock: unsupported strategy ${spec.strategy}`);
}

interface TextLine {
  /** Line content without its terminator. */
  content: string;
  /** Offset of the next line (after the terminator, or text.length). */
  next: number;
  terminated: boolean;
}

function lineAt(text: string, pos: number): TextLine {
  const nl = text.indexOf("\n", pos);
  if (nl === -1) return { content: text.slice(pos), next: text.length, terminated: false };
  const end = nl > pos && text[nl - 1] === "\r" ? nl - 1 : nl;
  return { content: text.slice(pos, end), next: nl + 1, terminated: true };
}

const BOM = "\uFEFF";
const ENCODING_COOKIE = /^[ \t\f]*#.*?coding[:=][ \t]*[-\w.]+/;
const COMMENT_OR_BLANK = /^[ \t\f]*(?:#.*)?$/;
const DOCKER_DIRECTIVE = /^#[ \t]*(?:syntax|escape|check)[ \t]*=/i;
const BARE_PHP_OPEN = /^<\?php[ \t]*$/i;
const CHARSET_LINE = /^@charset "[^"]*";[ \t]*$/;
const XML_DECL_START = /^<\?xml[ \t\r\n]/;
const REST_OF_LINE_BLANK = /^[ \t]*$/;

/**
 * The carrier position: where the managed block starts. The routine is shared by
 * insertion and by detection/strip, so placement and removal cannot diverge
 * (ADR-057). It consumes an optional BOM, a shebang line, then the spec's prologue
 * lines. `null` means the language leaves no inert position (a PHP file whose first
 * line is not a bare `<?php`, or an XML declaration / `@charset` rule that does not
 * end its line). `unterminated` means the last prologue line ends the file without a
 * line terminator, so insertion must supply one (and strip removes it again).
 */
interface CarrierPosition { offset: number; unterminated: boolean }

function carrierPosition(text: string, spec?: StrategySpec): CarrierPosition | null {
  const start = text.startsWith(BOM) ? BOM.length : 0;
  let pos = start;
  let lastTerminated = true;
  let consumed = 0;
  const take = (line: TextLine): void => { pos = line.next; lastTerminated = line.terminated; consumed++; };

  if (text.startsWith("#!", pos)) take(lineAt(text, pos));

  switch (spec?.prologue) {
    case "encoding-cookie": {
      // PEP 263: line 1, or line 2 when line 1 is blank or a comment (a shebang is one).
      const line = lineAt(text, pos);
      if (pos < text.length && ENCODING_COOKIE.test(line.content)) take(line);
      else if (consumed === 0 && line.terminated && COMMENT_OR_BLANK.test(line.content)) {
        const second = lineAt(text, line.next);
        if (ENCODING_COOKIE.test(second.content)) { take(line); take(second); }
      }
      break;
    }
    case "php-open-tag": {
      const line = lineAt(text, pos);
      if (!BARE_PHP_OPEN.test(line.content)) return null;
      take(line);
      break;
    }
    case "xml-declaration": {
      if (consumed > 0 || !XML_DECL_START.test(text.slice(pos, pos + 6))) break;
      const close = text.indexOf("?>", pos);
      if (close === -1) return null;
      const rest = lineAt(text, close + 2);
      if (!REST_OF_LINE_BLANK.test(rest.content)) return null;
      take(rest);
      break;
    }
    case "css-charset": {
      if (consumed > 0 || !text.startsWith('@charset "', pos)) break;
      const line = lineAt(text, pos);
      if (!CHARSET_LINE.test(line.content)) return null;
      take(line);
      break;
    }
    case "dockerfile-directives": {
      for (let line = lineAt(text, pos); pos < text.length && DOCKER_DIRECTIVE.test(line.content); line = lineAt(text, pos)) {
        take(line);
      }
      break;
    }
    default:
      break;
  }
  if (consumed > 0 && !lastTerminated) return { offset: text.length, unterminated: true };
  return { offset: pos, unterminated: false };
}

function isCommentStrategy(spec: StrategySpec): boolean {
  return spec.strategy === "line-comment" || spec.strategy === "block-comment";
}

/** Fill the prologue/legacy descriptors; route to a sidecar when no inert position exists. */
function withCarrierPosition(spec: StrategySpec, ext: string, base: string, raw: string): StrategySpec {
  const prologue = PROLOGUE_BY_EXT[ext] ?? PROLOGUE_BY_BASENAME[base];
  const legacy = LEGACY_CARRIER_BY_EXT[ext];
  const resolved: StrategySpec = { ...spec };
  if (prologue) resolved.prologue = prologue;
  if (legacy) resolved.legacyCarrier = { ...legacy };
  // Decide on the file without its managed block (wherever it sits), so the answer
  // is the same before and after injection and for a legacy byte-0 block.
  if (prologue && carrierPosition(stripInjectedBlock(raw, resolved), resolved) === null) {
    return { strategy: "sidecar" };
  }
  return resolved;
}

interface BlockSpan {
  /** Offset of the block's first line. */
  start: number;
  /** End of the block's last line, before its terminator. */
  blockEnd: number;
  /** End of the block including its terminator (if any). */
  end: number;
  delimiters: StrategySpec;
}

/** A managed block starting exactly at `pos`, delimited per `spec`, or null. */
function blockAt(text: string, pos: number, spec: StrategySpec): BlockSpan | null {
  let open: string;
  let close: string;
  if (spec.strategy === "line-comment") {
    open = `${spec.linePrefix!} ${START}`;
    close = `${spec.linePrefix!} ${END}`;
  } else if (spec.strategy === "block-comment") {
    open = `${spec.blockOpen!} ${BLOCK_START}`;
    close = `${BLOCK_END} ${spec.blockClose!}`;
  } else {
    return null;
  }
  const first = lineAt(text, pos);
  if (first.content.trimEnd() !== open || !first.terminated) return null;
  let cursor = first.next;
  while (cursor < text.length) {
    const line = lineAt(text, cursor);
    if (line.content.trimEnd() === close) {
      return { start: pos, blockEnd: cursor + line.content.length, end: line.next, delimiters: spec };
    }
    // Every line of a line-comment block is a comment; anything else is body.
    if (spec.strategy === "line-comment" && !line.content.trimStart().startsWith(spec.linePrefix!)) return null;
    cursor = line.next;
  }
  return null;
}

interface HeadBlock extends BlockSpan {
  /** Where removal starts: `start`, or earlier by the terminator insertion supplied. */
  removeFrom: number;
}

/**
 * The managed block at the head of `text`: at the carrier position, or at the legacy
 * byte-0 position (after a BOM) where the pre-ADR-057 writer put it in front of a
 * prologue. Sentinel text anywhere else is body (ADR-057, RC-002).
 */
function findHeadBlock(text: string, spec: StrategySpec): HeadBlock | null {
  if (!isCommentStrategy(spec)) return null;
  const bomLength = text.startsWith(BOM) ? BOM.length : 0;
  const position = carrierPosition(text, spec);
  const offsets = position && !position.unterminated && position.offset !== bomLength
    ? [position.offset, bomLength]
    : [bomLength];
  const forms = spec.legacyCarrier ? [spec, spec.legacyCarrier] : [spec];
  for (const offset of offsets) {
    for (const form of forms) {
      const span = blockAt(text, offset, form);
      if (!span) continue;
      let removeFrom = span.start;
      // Insertion supplied the prologue's missing terminator and wrote no newline
      // after the block: remove that terminator again so strip(inject(x)) === x.
      if (span.end === text.length && span.end === span.blockEnd && offset > bomLength) {
        const crlf = text.slice(offset - 2, offset) === "\r\n"
          && detectNewlineConvention(text.slice(0, offset - 2)) === "\r\n";
        removeFrom = offset - (crlf ? 2 : 1);
      }
      return { ...span, removeFrom };
    }
  }
  return null;
}

/** Remove a previously-injected comment block, returning the clean body verbatim. */
export function stripInjectedBlock(raw: string, spec: StrategySpec): string {
  const head = findHeadBlock(raw, spec);
  return head ? raw.slice(0, head.removeFrom) + raw.slice(head.end) : raw;
}

/** Detect whether a comment-injected block is present at the carrier position. */
export function hasInjectedBlock(raw: string, spec: StrategySpec): boolean {
  return findHeadBlock(raw, spec) !== null;
}

/** Extract the inner YAML from an existing comment block (comment prefixes removed), or null. */
export function extractInjectedYaml(raw: string, spec: StrategySpec): string | null {
  const head = findHeadBlock(raw, spec);
  if (!head) return null;
  // Split on either convention: a CRLF file's block would otherwise keep a
  // trailing `\r` on every value and fail to round-trip on the next run.
  const inner = raw.slice(head.start, head.blockEnd).split(/\r?\n/).slice(1, -1);
  if (head.delimiters.strategy === "line-comment") {
    const p = head.delimiters.linePrefix!;
    return inner.map((l) => l.replace(new RegExp(String.raw`^\s*${esc(p)} ?`), "")).join("\n").trim();
  }
  return inner.join("\n").trim();
}

/**
 * Assemble the injected file for comment strategies, preserving cleanBody verbatim
 * and placing the block at the carrier position: after a BOM, a shebang and the
 * spec's mandatory prologue. Recoverable via stripInjectedBlock with the same spec.
 * Without a spec only a BOM and a shebang are honoured.
 *
 * A byte-order mark stays at byte 0: the block is inserted after it, never before,
 * because a BOM in the middle of a file is no longer a BOM. Line endings around
 * the block follow `newline`, so a CRLF file keeps a single convention. When the
 * last prologue line has no terminator, one is supplied and no newline follows the
 * block, which is how strip knows to remove it again.
 */
export function applyCommentInjection(
  cleanBody: string,
  block: string,
  newline: NewlineConvention = "\n",
  spec?: StrategySpec,
): string {
  const position = carrierPosition(cleanBody, spec);
  if (!position) {
    throw new Error(`applyCommentInjection: no inert carrier position for prologue '${spec?.prologue ?? "none"}'; resolveStrategy routes such a file to a sidecar`);
  }
  if (position.unterminated) return `${cleanBody}${newline}${block}`;
  return `${cleanBody.slice(0, position.offset)}${block}${newline}${cleanBody.slice(position.offset)}`;
}
