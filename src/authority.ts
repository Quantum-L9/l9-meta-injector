/**
 * Repository metadata-authority loading and validation.
 *
 * The authority file is intentionally parsed with a narrow, fail-closed grammar.
 * It accepts only the l9.meta-authority/v1 shape and never attempts permissive
 * YAML recovery. A malformed authority declaration is an error, not an invitation
 * to infer repository policy.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  META_AUTHORITY_SCHEMA,
  isAuthorityConfig,
  type AuthorityConfig,
  type AuthorityConflict,
  type AuthorityConflictCode,
  type AuthorityWriter,
} from "./operation_contracts";

export const META_AUTHORITY_RELATIVE_PATH = ".l9/meta-authority.yaml" as const;

export interface AuthorityLoadOptions {
  authorityPath?: string;
  expectedWriter?: Partial<AuthorityWriter>;
}

export interface AuthorityLoadResult {
  path: string;
  authority?: AuthorityConfig;
  conflicts: AuthorityConflict[];
}

class AuthorityParseError extends Error {
  readonly code: AuthorityConflictCode;

  constructor(code: AuthorityConflictCode, message: string) {
    super(message);
    this.name = "AuthorityParseError";
    this.code = code;
  }
}

function fail(code: AuthorityConflictCode, message: string): never {
  throw new AuthorityParseError(code, message);
}

function stripInlineComment(line: string): string {
  let single = false;
  let double = false;
  let escaped = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && double) {
      escaped = true;
      continue;
    }
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    else if (char === "#" && !single && !double && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

function scalar(raw: string): string {
  const value = raw.trim();
  if (!value) fail("META_AUTHORITY_CONFIG_INVALID", "empty scalar value");
  if (value.startsWith('"') || value.endsWith('"')) {
    if (!(value.startsWith('"') && value.endsWith('"') && value.length >= 2)) {
      fail("META_AUTHORITY_CONFIG_INVALID", `unbalanced double quote in '${value}'`);
    }
    try {
      return JSON.parse(value) as string;
    } catch {
      fail("META_AUTHORITY_CONFIG_INVALID", `invalid double-quoted scalar '${value}'`);
    }
  }
  if (value.startsWith("'") || value.endsWith("'")) {
    if (!(value.startsWith("'") && value.endsWith("'") && value.length >= 2)) {
      fail("META_AUTHORITY_CONFIG_INVALID", `unbalanced single quote in '${value}'`);
    }
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^[\[\]{}&*!>|%@`]/.test(value)) {
    fail("META_AUTHORITY_CONFIG_INVALID", `unsupported YAML scalar '${value}'`);
  }
  return value;
}

function parseInlineList(raw: string): string[] {
  const value = raw.trim();
  if (value === "[]") return [];
  if (!value.startsWith("[") || !value.endsWith("]")) {
    fail("META_AUTHORITY_CONFIG_INVALID", `expected inline list, got '${value}'`);
  }
  const body = value.slice(1, -1).trim();
  if (!body) return [];
  const items: string[] = [];
  let current = "";
  let single = false;
  let double = false;
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\" && double) {
      current += char;
      escaped = true;
      continue;
    }
    if (char === "'" && !double) single = !single;
    else if (char === '"' && !single) double = !double;
    if (char === "," && !single && !double) {
      items.push(scalar(current));
      current = "";
    } else {
      current += char;
    }
  }
  if (single || double || escaped) {
    fail("META_AUTHORITY_CONFIG_INVALID", "unterminated quote in inline list");
  }
  items.push(scalar(current));
  return items;
}

function assertIndent(line: string): number {
  if (line.includes("\t")) fail("META_AUTHORITY_CONFIG_INVALID", "tabs are forbidden in authority YAML");
  return line.length - line.replace(/^ +/, "").length;
}

/** Parse the intentionally small l9.meta-authority/v1 YAML grammar. */
export function parseAuthorityYaml(text: string): AuthorityConfig {
  const lines = text.replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map(stripInlineComment)
    .filter((line) => line.trim().length > 0);

  const result: Record<string, unknown> = Object.create(null);
  const seen = new Set<string>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (assertIndent(line) !== 0) {
      fail("META_AUTHORITY_CONFIG_INVALID", `unexpected indentation at line ${index + 1}`);
    }
    const match = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (!match) fail("META_AUTHORITY_CONFIG_INVALID", `invalid mapping at line ${index + 1}`);
    const key = match[1];
    const rest = match[2];
    if (seen.has(key)) fail("META_AUTHORITY_CONFIG_INVALID", `duplicate key '${key}'`);
    seen.add(key);

    if (key === "writer") {
      if (rest) fail("META_AUTHORITY_CONFIG_INVALID", "writer must be a nested mapping");
      index++;
      const writer: Record<string, string> = Object.create(null);
      while (index < lines.length && assertIndent(lines[index]) > 0) {
        const child = lines[index];
        if (assertIndent(child) !== 2) {
          fail("META_AUTHORITY_CONFIG_INVALID", `writer entries must use two spaces at line ${index + 1}`);
        }
        const childMatch = /^([A-Za-z_][\w-]*):\s*(.+)$/.exec(child.trim());
        if (!childMatch) fail("META_AUTHORITY_CONFIG_INVALID", `invalid writer entry at line ${index + 1}`);
        const childKey = childMatch[1];
        if (childKey !== "repository" && childKey !== "ref") {
          fail("META_AUTHORITY_CONFIG_INVALID", `unsupported writer key '${childKey}'`);
        }
        if (childKey in writer) fail("META_AUTHORITY_CONFIG_INVALID", `duplicate writer key '${childKey}'`);
        writer[childKey] = scalar(childMatch[2]);
        index++;
      }
      result.writer = writer;
      continue;
    }

    if (key === "inline_allow" || key === "validation_commands") {
      if (rest) {
        result[key] = parseInlineList(rest);
        index++;
        continue;
      }
      index++;
      const values: string[] = [];
      while (index < lines.length && assertIndent(lines[index]) > 0) {
        const child = lines[index];
        if (assertIndent(child) !== 2 || !child.trim().startsWith("- ")) {
          fail("META_AUTHORITY_CONFIG_INVALID", `${key} entries must be two-space list items at line ${index + 1}`);
        }
        values.push(scalar(child.trim().slice(2)));
        index++;
      }
      result[key] = values;
      continue;
    }

    if (!["schema", "default_carrier", "legacy_writers"].includes(key)) {
      fail("META_AUTHORITY_CONFIG_INVALID", `unsupported top-level key '${key}'`);
    }
    if (!rest) fail("META_AUTHORITY_CONFIG_INVALID", `missing value for '${key}'`);
    result[key] = scalar(rest);
    index++;
  }

  if (result.schema !== META_AUTHORITY_SCHEMA) {
    fail(
      "META_AUTHORITY_SCHEMA_UNSUPPORTED",
      `unsupported authority schema '${String(result.schema ?? "<missing>")}'`,
    );
  }
  if (!isAuthorityConfig(result)) {
    fail("META_AUTHORITY_CONFIG_INVALID", "authority document does not satisfy l9.meta-authority/v1");
  }
  return result;
}

function conflict(code: AuthorityConflictCode, message: string, filePath: string, evidence?: string[]): AuthorityConflict {
  return { code, message, path: filePath, evidence };
}

export function loadRepositoryAuthority(root: string, options: AuthorityLoadOptions = {}): AuthorityLoadResult {
  const repositoryRoot = path.resolve(root);
  const authorityPath = path.resolve(repositoryRoot, options.authorityPath ?? META_AUTHORITY_RELATIVE_PATH);
  const relative = path.relative(repositoryRoot, authorityPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return {
      path: authorityPath,
      conflicts: [conflict("META_AUTHORITY_CONFIG_INVALID", "authority path escapes repository root", authorityPath)],
    };
  }
  if (!fs.existsSync(authorityPath)) {
    return {
      path: authorityPath,
      conflicts: [conflict("META_AUTHORITY_FILE_MISSING", `missing ${META_AUTHORITY_RELATIVE_PATH}`, authorityPath)],
    };
  }

  try {
    const stat = fs.lstatSync(authorityPath);
    if (stat.isSymbolicLink()) {
      return {
        path: authorityPath,
        conflicts: [conflict("META_AUTHORITY_CONFIG_INVALID", "authority file must not be a symbolic link", authorityPath)],
      };
    }
    if (!stat.isFile()) {
      return {
        path: authorityPath,
        conflicts: [conflict("META_AUTHORITY_CONFIG_INVALID", "authority path is not a regular file", authorityPath)],
      };
    }
    const authority = parseAuthorityYaml(fs.readFileSync(authorityPath, "utf8"));
    const expected = options.expectedWriter;
    const mismatches: string[] = [];
    if (expected?.repository && authority.writer.repository !== expected.repository) {
      mismatches.push(`repository expected ${expected.repository}, got ${authority.writer.repository}`);
    }
    if (expected?.ref && authority.writer.ref !== expected.ref) {
      mismatches.push(`ref expected ${expected.ref}, got ${authority.writer.ref}`);
    }
    if (mismatches.length) {
      return {
        path: authorityPath,
        authority,
        conflicts: [conflict("META_AUTHORITY_WRITER_MISMATCH", "configured metadata writer does not match policy", authorityPath, mismatches)],
      };
    }
    return { path: authorityPath, authority, conflicts: [] };
  } catch (error) {
    if (error instanceof AuthorityParseError) {
      return { path: authorityPath, conflicts: [conflict(error.code, error.message, authorityPath)] };
    }
    return {
      path: authorityPath,
      conflicts: [
        conflict(
          "META_AUTHORITY_CONFIG_INVALID",
          `unable to read authority configuration: ${error instanceof Error ? error.message : String(error)}`,
          authorityPath,
        ),
      ],
    };
  }
}
