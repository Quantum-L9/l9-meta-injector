// omit.ts — gitignore-style path omit for inventory/pipeline (and related CLIs).
// Built-in defaults always protect Cursor SKILL.md from mutating modes and skip
// bytecode/log noise. Operators add patterns via `.l9metaignore`, `--omit`, or
// `--omit-file`. Skills mode deliberately does NOT apply the SKILL.md protect so
// it can material-improve Cursor descriptions (see skills_pipeline.ts / ADR-017).

import * as fs from "fs";
import * as path from "path";

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
 * Matched case-insensitively on basename (in addition to these glob patterns).
 */
export const BUILTIN_SKILL_PROTECT_PATTERNS: readonly string[] = [
  "**/SKILL.md",
  "**/skill.md",
];

export interface OmitOptions {
  /** Scan root (used to load `.l9metaignore` when present). */
  root: string;
  /** Extra gitignore-style patterns (CLI `--omit`). */
  patterns?: string[];
  /** Optional extra omit-file path (CLI `--omit-file`). */
  omitFile?: string;
  /**
   * When true (default), built-in SKILL.md protect patterns apply.
   * Skills mode sets this false so it can mutate skill entrypoints.
   */
  protectSkillMd?: boolean;
  /** Extra directory basenames to treat as ignored (inventory `--ignore` compat). */
  ignoreDirNames?: string[];
}

export interface OmitMatcher {
  /** True if this relative path (posix, no leading `./`) should be skipped. */
  shouldOmit(relPath: string): boolean;
  /** Patterns actually loaded (for diagnostics). */
  patterns: string[];
}

/** True when basename is SKILL.md under any casing. */
export function isSkillMdBasename(filePath: string): boolean {
  return path.basename(filePath).toLowerCase() === "skill.md";
}

/** True when path looks like a skill artifact skills mode may touch. */
export function isSkillArtifactPath(filePath: string): boolean {
  const norm = filePath.replace(/\\/g, "/").toLowerCase();
  const base = path.basename(filePath).toLowerCase();
  if (base === "skill.md") return true;
  if (base.includes(".skill.")) return true;
  if (/\/skills?\//.test(`/${norm}/`) || /(^|\/)skills?\//.test(norm)) return true;
  return false;
}

function parseOmitFile(contents: string): string[] {
  const out: string[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    out.push(t);
  }
  return out;
}

/**
 * Convert a single gitignore-style pattern into a RegExp that matches a
 * posix relative path. Supports `**`, `*`, trailing `/` (directory), and
 * leading `/` (root-anchored). Negation (`!`) is handled by the matcher, not here.
 */
function patternToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, "/");
  const dirOnly = p.endsWith("/");
  if (dirOnly) p = p.slice(0, -1);
  const anchored = p.startsWith("/");
  if (anchored) p = p.slice(1);

  let re = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "*" && p[i + 1] === "*") {
      // `/**/` or leading/trailing `**`
      if (p[i + 2] === "/") {
        re += "(?:.*/)?";
        i += 2;
      } else {
        re += ".*";
        i += 1;
      }
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "?") {
      re += "[^/]";
    } else if ("+|(){}^$.".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }

  if (dirOnly) {
    // Match the directory itself or anything under it.
    re = `(?:${re}|${re}/.*)`;
  }
  if (anchored) return new RegExp(`^${re}$`, "i");
  // Unanchored: match at any path segment boundary.
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
    let p = raw.trim();
    if (!p || p.startsWith("#")) continue;
    let negate = false;
    if (p.startsWith("!")) {
      negate = true;
      p = p.slice(1);
    }
    // Directory-name shorthand from inventory --ignore: "node_modules" → "node_modules/"
    if (!/[*/?]/.test(p) && !p.includes("/")) {
      p = `${p}/`;
    }
    rules.push({ negate, re: patternToRegExp(p), raw });
  }
  return rules;
}

/**
 * Build an omit matcher from built-ins + `.l9metaignore` + optional CLI patterns.
 * Last matching rule wins (gitignore semantics), including `!` negation.
 */
export function buildOmitMatcher(opts: OmitOptions): OmitMatcher {
  const patterns: string[] = [...BUILTIN_NOISE_PATTERNS];
  if (opts.protectSkillMd !== false) {
    patterns.push(...BUILTIN_SKILL_PROTECT_PATTERNS);
  }
  for (const d of opts.ignoreDirNames ?? []) {
    if (d) patterns.push(`${d}/`);
  }

  const metaIgnorePath = path.join(opts.root, L9_METAIGNORE_FILENAME);
  if (fs.existsSync(metaIgnorePath) && fs.statSync(metaIgnorePath).isFile()) {
    try {
      patterns.push(...parseOmitFile(fs.readFileSync(metaIgnorePath, "utf8")));
    } catch {
      // Unreadable omit file: continue with built-ins; caller still fail-closed on mutation.
    }
  }

  if (opts.omitFile) {
    const abs = path.resolve(opts.omitFile);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      patterns.push(...parseOmitFile(fs.readFileSync(abs, "utf8")));
    }
  }

  if (opts.patterns?.length) patterns.push(...opts.patterns);

  const rules = compileRules(patterns);
  const protectSkill = opts.protectSkillMd !== false;

  return {
    patterns: [...patterns],
    shouldOmit(relPath: string): boolean {
      const rel = relPath.replace(/\\/g, "/").replace(/^\.\//, "");
      if (!rel || rel === ".") return false;

      // Hard basename protect (case-insensitive) — belt-and-suspenders for SKILL.md.
      if (protectSkill && isSkillMdBasename(rel)) return true;

      let omitted = false;
      for (const rule of rules) {
        if (rule.re.test(rel)) omitted = !rule.negate;
      }
      return omitted;
    },
  };
}
