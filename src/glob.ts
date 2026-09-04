/**
 * One glob dialect for every path scope the injector honors.
 *
 * The discovery scope (`--glob`, the `glob` action input, `PipelineConfig.glob`) and the
 * repository authority's `inline_allow` patterns answer the same question — "does this
 * repository-relative path belong to the set the operator named?" — so they compile
 * through one function. Before this module the discovery scope honored only a trailing
 * `*.ext` and silently ignored any path prefix, so `docs/**` followed by `/*.md` planned
 * and mutated `other/b.md`, while the authority matched the same pattern precisely
 * (ADR-047).
 *
 * Dialect: `**` followed by `/` matches zero or more directories, `**` elsewhere matches
 * across separators, `*` matches within one segment, `?` matches one non-separator
 * character, every other character is literal. Brace alternation, character classes and
 * negation are not part of the dialect: the authority treats them as literals
 * (fail-closed, a pattern that never matches grants nothing), and the discovery scope
 * refuses them explicitly, because a scope that silently matched nothing — or
 * everything — would make a governed run report success over the wrong file set.
 */

const REGEXP_SPECIALS = /[|\\{}()[\]^$+?.]/g;

export function globToRegExpSource(pattern: string): string {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    if (char === "*" && pattern[index + 1] === "*") {
      if (pattern[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
      continue;
    }
    if (char === "*") {
      source += "[^/]*";
      continue;
    }
    if (char === "?") {
      source += "[^/]";
      continue;
    }
    source += char.replace(REGEXP_SPECIALS, String.raw`\$&`);
  }
  return `${source}$`;
}

/** Case-sensitive matcher used by the repository authority (`inline_allow`). */
export function globToRegExp(pattern: string): RegExp {
  return new RegExp(globToRegExpSource(pattern));
}

const UNSUPPORTED_SCOPE_SYNTAX = /[{}[\]!]/;
const CONTROL_CHARACTER = /[\u0000-\u001F\u007F]/;

/**
 * Validate a discovery-scope glob. The scope names the files a governed run may plan
 * and mutate, so it is judged before any directory is read: absolute, parent-relative,
 * backslash, doubled-separator, control-character and unsupported-syntax patterns are
 * refused with the reason, never narrowed or widened silently.
 */
export function assertDiscoveryGlob(pattern: string): string {
  if (typeof pattern !== "string" || pattern.length === 0) throw new Error("discovery glob must be a non-empty pattern");
  if (pattern.trim() !== pattern) throw new Error(`discovery glob must not carry surrounding whitespace: ${JSON.stringify(pattern)}`);
  if (pattern.length > 512) throw new Error("discovery glob must be at most 512 characters");
  if (CONTROL_CHARACTER.test(pattern)) throw new Error("discovery glob contains a forbidden control character");
  if (pattern.includes("\\")) throw new Error(`discovery glob must use forward slashes: ${pattern}`);
  if (pattern.startsWith("/")) throw new Error(`discovery glob must be repository-relative, not absolute: ${pattern}`);
  if (pattern.startsWith("./")) throw new Error(`discovery glob must not start with ./: ${pattern}`);
  if (pattern.includes("//")) throw new Error(`discovery glob must not contain an empty segment: ${pattern}`);
  const segments = pattern.split("/");
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(`discovery glob must not contain . or .. segments: ${pattern}`);
  }
  if (UNSUPPORTED_SCOPE_SYNTAX.test(pattern)) {
    throw new Error(`discovery glob uses unsupported syntax (brace alternation, character classes and negation are not part of the dialect): ${pattern}`);
  }
  return pattern;
}

export interface DiscoveryGlob {
  pattern: string;
  /** Whole-path matcher, case-insensitive so `*.MD` keeps matching `.md` as the former extension filter did. */
  matches: (relativePath: string) => boolean;
  /** `.ext` when the final segment is exactly `*.ext`; the legacy extension-filter shape. */
  extensionFilter: string | null;
}

/** Compile a validated discovery-scope glob into a whole-path matcher. */
export function compileDiscoveryGlob(pattern: string): DiscoveryGlob {
  const validated = assertDiscoveryGlob(pattern);
  const expression = new RegExp(globToRegExpSource(validated), "i");
  const extMatch = /^\*\.([a-z0-9]+)$/i.exec(validated.slice(validated.lastIndexOf("/") + 1));
  return {
    pattern: validated,
    matches: (relativePath) => expression.test(relativePath),
    extensionFilter: extMatch ? `.${extMatch[1].toLowerCase()}` : null,
  };
}
