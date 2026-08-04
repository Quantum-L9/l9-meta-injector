// omit.ts - gitignore-style path omit for inventory/pipeline and related CLIs.
// Built-in defaults always protect Cursor SKILL.md from mutating modes and skip
// bytecode/log noise. Operators add patterns via `.l9metaignore`, `--omit`, or
// `--omit-file`. Every declared omit source is loaded strictly. A missing,
// unreadable, symlinked, non-file, binary, or invalid-UTF-8 omit file is an error.

import * as fs from "node:fs";
import * as path from "node:path";

export const L9_METAIGNORE_FILENAME = ".l9metaignore";

/** Built-in noise: never inventoriable / never injectable in any mode. */
export const BUILTIN_NOISE_PATTERNS: readonly string[] = [
  "__pycache__/",
  "*.pyc",
  "*.pyo",
  "*.pyd",
  "*.log",
];

/**
 * Built-in protect for inventory + pipeline: Cursor Agent Skill entrypoints.
 * Matched case-insensitively on basename in addition to these glob patterns.
 */
export const BUILTIN_SKILL_PROTECT_PATTERNS: readonly string[] = [
  "**/SKILL.md",
  "**/skill.md",
];

export interface OmitOptions {
  /** Scan root used to load `.l9metaignore` when present. */
  root: string;
  /** Extra gitignore-style patterns from CLI `--omit`. */
  patterns?: string[];
  /** Optional extra omit-file path from CLI `--omit-file`. */
  omitFile?: string;
  /**
   * When true, built-in SKILL.md protect patterns apply.
   * Skills mode sets this false so it can mutate skill entrypoints.
   */
  protectSkillMd?: boolean;
  /** Extra directory basenames to treat as ignored. */
  ignoreDirNames?: string[];
}

export interface OmitMatcher {
  /** True if this relative path should be skipped. */
  shouldOmit(relPath: string): boolean;
  /** Patterns actually loaded, in precedence order. */
  patterns: string[];
  /** Repository-relative or explicit omit sources that were loaded. */
  sources?: string[];
}

/** True when basename is SKILL.md under any casing. */
export function isSkillMdBasename(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === "skill.md";
}

/** True only for the canonical skill entrypoint basename, SKILL.md (case-insensitive). */
export function isSkillArtifactPath(filePath: string): boolean {
  return isSkillMdBasename(filePath);
}

function parseOmitFile(contents: string): string[] {
  const out: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.includes("\u0000")) throw new Error("omit pattern contains a NUL byte");
    out.push(trimmed);
  }
  return out;
}

function decodeUtf8Strict(bytes: Buffer, label: string): string {
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.includes("\u0000")) throw new Error("contains a NUL byte");
    return decoded;
  } catch (error) {
    throw new Error(`${label} is not valid UTF-8 text: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function readOmitFileStrict(filePath: string, label: string, required: boolean): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // An optional ignore file is simply absent when there is no regular file at
    // the path: ENOENT (nothing there) or ENOTDIR (a path component is a file).
    if (!required && (code === "ENOENT" || code === "ENOTDIR")) return [];
    throw new Error(`${label} cannot be inspected: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symbolic link: ${filePath}`);
  if (!stat.isFile()) throw new Error(`${label} must be a regular file: ${filePath}`);
  try {
    return parseOmitFile(decodeUtf8Strict(fs.readFileSync(filePath), label));
  } catch (error) {
    throw new Error(`${label} cannot be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function appendGlobToken(re: string, pattern: string, i: number): { re: string; next: number } {
  const c = pattern[i];
  if (c === "*" && pattern[i + 1] === "*") {
    if (pattern[i + 2] === "/") return { re: re + "(?:.*/)?", next: i + 2 };
    return { re: re + ".*", next: i + 1 };
  }
  if (c === "*") return { re: re + "[^/]*", next: i };
  if (c === "?") return { re: re + "[^/]", next: i };
  if (String.raw`+|(){}^$.[\]`.includes(c)) return { re: re + "\\" + c, next: i };
  return { re: re + c, next: i };
}

/** Convert one gitignore-style pattern into a repository-relative RegExp. */
function patternToRegExp(pattern: string): RegExp {
  let value = pattern.replace(/\\/g, "/");
  const dirOnly = value.endsWith("/");
  if (dirOnly) value = value.slice(0, -1);
  const anchored = value.startsWith("/");
  if (anchored) value = value.slice(1);

  let re = "";
  for (let i = 0; i < value.length; i++) {
    const step = appendGlobToken(re, value, i);
    re = step.re;
    i = step.next;
  }

  if (dirOnly) re = `(?:${re}|${re}/.*)`;
  if (anchored) return new RegExp(`^${re}$`, "i");
  return new RegExp(`(?:^|/)${re}$`, "i");
}

interface CompiledRule {
  negate: boolean;
  re: RegExp;
  raw: string;
}

function compileRules(patterns: string[]): CompiledRule[] {
  const rules: CompiledRule[] = [];
  for (const raw of patterns) {
    let value = raw.trim();
    if (!value || value.startsWith("#")) continue;
    let negate = false;
    if (value.startsWith("!")) {
      negate = true;
      value = value.slice(1);
    }
    if (!value) throw new Error(`invalid empty negation pattern '${raw}'`);
    if (!/[*/?]/.test(value) && !value.includes("/")) value = `${value}/`;
    rules.push({ negate, re: patternToRegExp(value), raw });
  }
  return rules;
}

/**
 * Build an omit matcher from built-ins, `.l9metaignore`, and optional CLI
 * patterns. Last matching rule wins. Declared omit files fail closed.
 */
export function buildOmitMatcher(opts: OmitOptions): OmitMatcher {
  const root = path.resolve(opts.root);
  const patterns: string[] = [...BUILTIN_NOISE_PATTERNS];
  const sources: string[] = ["builtin:noise"];
  if (opts.protectSkillMd !== false) {
    patterns.push(...BUILTIN_SKILL_PROTECT_PATTERNS);
    sources.push("builtin:skill-protect");
  }
  for (const directory of opts.ignoreDirNames ?? []) {
    if (directory) patterns.push(`${directory}/`);
  }

  const metaIgnorePath = path.join(root, L9_METAIGNORE_FILENAME);
  const metaPatterns = readOmitFileStrict(metaIgnorePath, L9_METAIGNORE_FILENAME, false);
  if (metaPatterns.length > 0 || fs.existsSync(metaIgnorePath)) {
    patterns.push(...metaPatterns);
    sources.push(L9_METAIGNORE_FILENAME);
  }

  if (opts.omitFile !== undefined) {
    const supplied = opts.omitFile.trim();
    if (!supplied) throw new Error("--omit-file must not be empty");
    const absolute = path.isAbsolute(supplied) ? path.resolve(supplied) : path.resolve(root, supplied);
    patterns.push(...readOmitFileStrict(absolute, "--omit-file", true));
    sources.push(absolute);
  }

  if (opts.patterns?.length) {
    patterns.push(...opts.patterns);
    sources.push("inline-patterns");
  }

  const rules = compileRules(patterns);
  const protectSkill = opts.protectSkillMd !== false;

  return {
    patterns: [...patterns],
    sources,
    shouldOmit(relPath: string): boolean {
      const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!rel || rel === ".") return false;
      if (protectSkill && isSkillMdBasename(rel)) return true;

      let omitted = false;
      for (const rule of rules) {
        if (rule.re.test(rel)) omitted = !rule.negate;
      }
      return omitted;
    },
  };
}
