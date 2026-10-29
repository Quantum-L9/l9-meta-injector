/**
 * Repository metadata-authority loading and validation.
 *
 * The authority file is intentionally parsed with a narrow, fail-closed grammar.
 * It accepts l9.meta-authority/v1 and l9.meta-authority/v2 and never attempts
 * permissive YAML recovery. A malformed authority declaration is an error, not
 * an invitation to infer repository policy.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import {
  META_AUTHORITY_SCHEMA,
  META_AUTHORITY_SCHEMA_V2,
  SEMANTIC_LEDGER_DIGEST_RE,
  SEMANTIC_LEDGER_ID_RE,
  isAuthorityConfig,
  isSupportedAuthoritySchema,
  type AuthorityConfig,
  type AuthorityConflict,
  type AuthorityConflictCode,
  type AuthorityWriter,
  type HeaderIdentityRequest,
  type HeaderIdentityResolution,
  type SemanticFoundationBinding,
} from "./operation_contracts";
import { compareCodePoints } from "./ordering";

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

const isBlank = (char: string | undefined): boolean => char === " " || char === "\t";

/**
 * Whether a scalar (or a flow-list item) begins at `index`. Only there does a quote
 * open a quoted scalar: a mid-word apostrophe (`maintainer's`) is plain text in
 * YAML and must not hide a trailing comment (RC-024). A `:` is a mapping separator
 * only when a blank follows it, and a `[` opens a flow item only when it was itself
 * counted as a flow opener (`inFlow`), so `x:'a` and `x['a` stay plain (audit G03).
 * Kept in lockstep with meta_schema.scalarStartsAt.
 */
function scalarStartsAt(line: string, index: number, inFlow: boolean): boolean {
  let j = index - 1;
  while (j >= 0 && isBlank(line[j])) j--;
  if (j < 0) return true;
  const previous = line[j];
  if (previous === ":") return j < index - 1;
  if (previous === "[" || previous === ",") return inFlow;
  if (previous === "-" && j < index - 1) {
    let k = j - 1;
    while (k >= 0 && isBlank(line[k])) k--;
    return k < 0;
  }
  return false;
}

function stripInlineComment(line: string): string {
  let quote: "'" | '"' | null = null;
  let flowDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quote === '"') {
      if (char === "\\") i++;
      else if (char === '"') quote = null;
      continue;
    }
    if (quote === "'") {
      if (char === "'" && line[i + 1] === "'") i++;
      else if (char === "'") quote = null;
      continue;
    }
    if ((char === "'" || char === '"') && scalarStartsAt(line, i, flowDepth > 0)) quote = char;
    else if (char === "[" && scalarStartsAt(line, i, flowDepth > 0)) flowDepth++;
    else if (char === "]" && flowDepth > 0) flowDepth--;
    else if (char === "#" && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line.trimEnd();
}

/** YAML 1.2 core-schema null and bool tokens: never a plain string in YAML. */
const NON_STRING_PLAIN = /^(?:null|Null|NULL|~|true|True|TRUE|false|False|FALSE)$/;

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
  // A plain null/bool token is not a string in YAML, and ': ' (or a trailing ':')
  // inside a plain value starts a nested mapping; both are outside the grammar.
  if (NON_STRING_PLAIN.test(value)) {
    fail("META_AUTHORITY_CONFIG_INVALID", `plain '${value}' is a YAML null or bool, not a string; quote it`);
  }
  if (value.includes(": ") || value.endsWith(":")) {
    fail("META_AUTHORITY_CONFIG_INVALID", `plain scalar '${value}' contains a mapping separator; quote it`);
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
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (double) {
      current += char;
      if (char === "\\") {
        current += body[i + 1] ?? "";
        i++;
      } else if (char === '"') {
        double = false;
      }
      continue;
    }
    if (single) {
      current += char;
      if (char === "'" && body[i + 1] === "'") {
        current += "'";
        i++;
      } else if (char === "'") {
        single = false;
      }
      continue;
    }
    // A quote opens a quoted item only where the item begins (RC-024).
    if ((char === "'" || char === '"') && current.trim() === "") {
      if (char === "'") single = true;
      else double = true;
      current += char;
      continue;
    }
    if (char === ",") {
      items.push(scalar(current));
      current = "";
    } else {
      current += char;
    }
  }
  if (single || double) {
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
    // A key ends at ':' followed by a space or the end of the line, as in YAML.
    const match = /^([A-Za-z_][\w-]*):(?: +(.*))?$/.exec(line);
    if (!match) fail("META_AUTHORITY_CONFIG_INVALID", `invalid mapping at line ${index + 1}`);
    const key = match[1];
    const rest = match[2] ?? "";
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
        const childMatch = /^([A-Za-z_][\w-]*): +(.+)$/.exec(child.trim());
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
      // YAML reads `key:` with no items as null, not as an empty list; an empty
      // list is written `key: []` (RC-024).
      if (values.length === 0) fail("META_AUTHORITY_CONFIG_INVALID", `${key} has no list items; write '${key}: []' for an empty list`);
      result[key] = values;
      continue;
    }

    if (key === "semantic_foundation") {
      if (rest) fail("META_AUTHORITY_CONFIG_INVALID", "semantic_foundation must be a nested mapping");
      index++;
      const foundation = parseSemanticFoundation(lines, index);
      index = foundation._end as number;
      delete foundation._end;
      result.semantic_foundation = foundation;
      continue;
    }

    if (key === "product") {
      if (rest) fail("META_AUTHORITY_CONFIG_INVALID", "product must be a nested mapping");
      index++;
      const product: Record<string, string> = Object.create(null);
      while (index < lines.length && assertIndent(lines[index]) > 0) {
        const child = lines[index];
        if (assertIndent(child) !== 2) {
          fail("META_AUTHORITY_CONFIG_INVALID", `product entries must use two spaces at line ${index + 1}`);
        }
        const childMatch = /^([A-Za-z_][\w-]*): +(.+)$/.exec(child.trim());
        if (!childMatch) fail("META_AUTHORITY_CONFIG_INVALID", `invalid product entry at line ${index + 1}`);
        const childKey = childMatch[1];
        if (!["id", "owner", "kind", "archetype"].includes(childKey)) {
          fail("META_AUTHORITY_CONFIG_INVALID", `unsupported product key '${childKey}'`);
        }
        if (childKey in product) fail("META_AUTHORITY_CONFIG_INVALID", `duplicate product key '${childKey}'`);
        product[childKey] = scalar(childMatch[2]);
        index++;
      }
      result.product = product;
      continue;
    }

    if (!["schema", "default_carrier", "legacy_writers"].includes(key)) {
      fail("META_AUTHORITY_CONFIG_INVALID", `unsupported top-level key '${key}'`);
    }
    if (!rest) fail("META_AUTHORITY_CONFIG_INVALID", `missing value for '${key}'`);
    result[key] = scalar(rest);
    index++;
  }

  if (!isSupportedAuthoritySchema(result.schema)) {
    fail(
      "META_AUTHORITY_SCHEMA_UNSUPPORTED",
      `unsupported authority schema '${String(result.schema ?? "<missing>")}'`,
    );
  }
  if (result.schema === META_AUTHORITY_SCHEMA && ("semantic_foundation" in result || "product" in result)) {
    fail("META_AUTHORITY_CONFIG_INVALID", "l9.meta-authority/v1 does not admit semantic_foundation or product");
  }
  if (!isAuthorityConfig(result)) {
    const schema = String(result.schema ?? "<missing>");
    fail(
      result.schema === META_AUTHORITY_SCHEMA_V2 ? "META_SEMANTIC_BINDING_INVALID" : "META_AUTHORITY_CONFIG_INVALID",
      `authority document does not satisfy ${schema}`,
    );
  }
  return result;
}

function parseSemanticFoundation(lines: string[], start: number): Record<string, unknown> {
  const block: Record<string, unknown> = Object.create(null);
  let index = start;
  while (index < lines.length && assertIndent(lines[index]) > 0) {
    if (assertIndent(lines[index]) !== 2) {
      fail("META_SEMANTIC_BINDING_INVALID", `semantic_foundation entries must use two spaces at line ${index + 1}`);
    }
    const child = lines[index];
    const childMatch = /^([A-Za-z_][\w-]*):(?: +(.*))?$/.exec(child.trim());
    if (!childMatch) fail("META_SEMANTIC_BINDING_INVALID", `invalid semantic_foundation entry at line ${index + 1}`);
    const childKey = childMatch[1];
    const rest = childMatch[2] ?? "";
    if (childKey in block) fail("META_SEMANTIC_BINDING_INVALID", `duplicate semantic_foundation key '${childKey}'`);
    if (!["repository", "revision", "release", "admission", "ledgers"].includes(childKey)) {
      fail("META_SEMANTIC_BINDING_INVALID", `unsupported semantic_foundation key '${childKey}'`);
    }
    if (childKey === "ledgers") {
      if (rest) fail("META_SEMANTIC_BINDING_INVALID", "ledgers must be a nested mapping");
      index++;
      const ledgers: Record<string, string> = Object.create(null);
      while (index < lines.length && assertIndent(lines[index]) > 2) {
        const ledgerLine = lines[index];
        if (assertIndent(ledgerLine) !== 4) {
          fail("META_SEMANTIC_BINDING_INVALID", `ledger entries must use four spaces at line ${index + 1}`);
        }
        const ledgerMatch = /^(l9\.[a-z0-9-]+\/[a-z0-9-]+@\d+): +(.+)$/.exec(ledgerLine.trim());
        if (!ledgerMatch || !SEMANTIC_LEDGER_ID_RE.test(ledgerMatch[1])) {
          fail("META_SEMANTIC_BINDING_INVALID", `invalid ledger key at line ${index + 1}`);
        }
        if (ledgerMatch[1] in ledgers) fail("META_SEMANTIC_BINDING_INVALID", `duplicate ledger '${ledgerMatch[1]}'`);
        const digest = scalar(ledgerMatch[2]);
        if (!SEMANTIC_LEDGER_DIGEST_RE.test(digest)) {
          fail("META_SEMANTIC_BINDING_INVALID", `malformed ledger digest for '${ledgerMatch[1]}'`);
        }
        ledgers[ledgerMatch[1]] = digest;
        index++;
      }
      block.ledgers = ledgers;
      continue;
    }
    if (!rest) fail("META_SEMANTIC_BINDING_INVALID", `missing value for '${childKey}'`);
    block[childKey] = scalar(rest);
    index++;
  }
  return Object.assign(block, { _end: index });
}

function conflict(code: AuthorityConflictCode, message: string, filePath: string, evidence?: string[]): AuthorityConflict {
  return { code, message, path: filePath, evidence };
}

/**
 * Check every path component from the repository root down to the authority document
 * without following links (RC-031). The document is read only when no component below
 * the root is a symbolic link (dangling or not), every intermediate is a real directory,
 * the leaf is a regular file, and its realpath lies inside realpath(root). Only ENOENT
 * on a component means the document is missing; every other failure is a configuration
 * error. The root itself may be reached through a link.
 */
function authorityPathConflict(repositoryRoot: string, authorityPath: string, relative: string): AuthorityConflict | null {
  // The root is not an authority path component: a root that is absent or is not a
  // directory simply holds no authority document, exactly as before.
  try {
    if (!fs.statSync(repositoryRoot).isDirectory()) {
      return conflict("META_AUTHORITY_FILE_MISSING", `missing ${META_AUTHORITY_RELATIVE_PATH}`, authorityPath);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return conflict("META_AUTHORITY_FILE_MISSING", `missing ${META_AUTHORITY_RELATIVE_PATH}`, authorityPath);
    }
    return conflict(
      "META_AUTHORITY_CONFIG_INVALID",
      `unable to inspect repository root: ${error instanceof Error ? error.message : String(error)}`,
      authorityPath,
    );
  }
  const segments = relative.split(path.sep);
  let cursor = repositoryRoot;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const component = path.relative(repositoryRoot, cursor).split(path.sep).join("/") || ".";
    const leaf = index === segments.length - 1;
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(cursor);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return conflict("META_AUTHORITY_FILE_MISSING", `missing ${META_AUTHORITY_RELATIVE_PATH}`, authorityPath);
      }
      return conflict(
        "META_AUTHORITY_CONFIG_INVALID",
        `unable to inspect authority path component ${component}: ${error instanceof Error ? error.message : String(error)}`,
        authorityPath,
      );
    }
    if (stat.isSymbolicLink()) {
      return conflict(
        "META_AUTHORITY_CONFIG_INVALID",
        leaf ? "authority file must not be a symbolic link" : `authority path component must not be a symbolic link: ${component}`,
        authorityPath,
      );
    }
    if (!leaf && !stat.isDirectory()) {
      return conflict("META_AUTHORITY_CONFIG_INVALID", `authority path component is not a directory: ${component}`, authorityPath);
    }
    if (leaf && !stat.isFile()) {
      return conflict("META_AUTHORITY_CONFIG_INVALID", "authority path is not a regular file", authorityPath);
    }
  }
  try {
    const contained = path.relative(fs.realpathSync(repositoryRoot), fs.realpathSync(authorityPath));
    if (!contained || contained.startsWith("..") || path.isAbsolute(contained)) {
      return conflict("META_AUTHORITY_CONFIG_INVALID", "authority path escapes repository root", authorityPath);
    }
  } catch (error) {
    return conflict(
      "META_AUTHORITY_CONFIG_INVALID",
      `unable to resolve authority path: ${error instanceof Error ? error.message : String(error)}`,
      authorityPath,
    );
  }
  return null;
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
  const pathConflict = authorityPathConflict(repositoryRoot, authorityPath, relative);
  if (pathConflict) return { path: authorityPath, conflicts: [pathConflict] };

  try {
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

export function resolveHeaderIdentity(root: string, request: HeaderIdentityRequest = {}): HeaderIdentityResolution {
  const loaded = loadRepositoryAuthority(root);
  const operatorAuthority = request.authority?.trim() || undefined;
  const operatorNamespace = request.namespace?.trim() || undefined;
  const folderNamespace = request.unboundNamespaceDefault?.trim() || path.basename(path.resolve(root));

  const bindingConflicts = loaded.conflicts.filter((item) =>
    item.code !== "META_AUTHORITY_FILE_MISSING",
  );
  if (bindingConflicts.length) {
    return {
      authority: operatorAuthority ?? "",
      namespace: operatorNamespace ?? folderNamespace,
      source: "operator",
      conflicts: bindingConflicts,
    };
  }

  const authority = loaded.authority;
  const bound = authority?.schema === META_AUTHORITY_SCHEMA_V2
    && authority.product
    && authority.semantic_foundation;
  if (bound && authority.product) {
    const conflicts: AuthorityConflict[] = [];
    if (operatorAuthority && operatorAuthority !== authority.product.owner) {
      conflicts.push(conflict(
        "META_AUTHORITY_IDENTITY_MISMATCH",
        `operator authority '${operatorAuthority}' does not match bound product.owner '${authority.product.owner}'`,
        loaded.path,
      ));
    }
    if (operatorNamespace && operatorNamespace !== authority.product.id) {
      conflicts.push(conflict(
        "META_AUTHORITY_IDENTITY_MISMATCH",
        `operator namespace '${operatorNamespace}' does not match bound product.id '${authority.product.id}'`,
        loaded.path,
      ));
    }
    for (const rule of request.namespaceGlobs ?? []) {
      if (rule.namespace === authority.product.id) continue;
      conflicts.push(conflict(
        "META_AUTHORITY_IDENTITY_MISMATCH",
        `namespace glob '${rule.glob}' maps to '${rule.namespace}', which does not match bound product.id '${authority.product.id}'`,
        loaded.path,
      ));
    }
    return {
      authority: authority.product.owner,
      namespace: authority.product.id,
      source: "semantic_binding",
      conflicts,
      product: authority.product,
      semanticFoundation: authority.semantic_foundation,
    };
  }

  if (!operatorAuthority) {
    if (request.requireAuthorityWhenUnbound === false) {
      return {
        authority: "",
        namespace: operatorNamespace ?? folderNamespace,
        source: operatorNamespace ? "operator" : "folder",
        conflicts: [],
      };
    }
    return {
      authority: "",
      namespace: operatorNamespace ?? folderNamespace,
      source: operatorNamespace ? "operator" : "folder",
      conflicts: [conflict(
        "META_AUTHORITY_FILE_MISSING",
        "header authority is required when no l9.meta-authority/v2 product binding is present",
        loaded.path,
      )],
    };
  }
  return {
    authority: operatorAuthority,
    namespace: operatorNamespace ?? folderNamespace,
    source: operatorNamespace ? "operator" : "folder",
    conflicts: [],
  };
}

export function assertHeaderIdentity(resolution: HeaderIdentityResolution): HeaderIdentityResolution {
  if (resolution.conflicts.length) {
    const first = resolution.conflicts[0];
    throw new Error(`${first.code}: ${first.message}`);
  }
  return resolution;
}

const ARTIFACT_ID_LINE = /^artifact_id:\s*(\S+)\s*$/;

export function verifySemanticFoundation(
  binding: SemanticFoundationBinding,
  semanticsRoot: string,
): AuthorityConflict[] {
  const root = path.resolve(semanticsRoot);
  const conflicts: AuthorityConflict[] = [];
  const semanticsDir = path.join(root, "semantics");
  if (!fs.existsSync(semanticsDir) || !fs.statSync(semanticsDir).isDirectory()) {
    return [conflict(
      "META_SEMANTIC_BINDING_INVALID",
      `semantics directory missing under ${root}`,
      semanticsDir,
    )];
  }
  // Every claimant is kept: a cited id claimed by more than one file does not identify
  // one ledger, so it is refused rather than resolved by file order (RC-036).
  const byId = new Map<string, Array<{ path: string; digest: string }>>();
  for (const name of fs.readdirSync(semanticsDir).sort()) {
    if (!name.endsWith(".yaml")) continue;
    const filePath = path.join(semanticsDir, name);
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    const bytes = fs.readFileSync(filePath);
    const text = bytes.toString("utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = ARTIFACT_ID_LINE.exec(line);
      if (!match) continue;
      const digest = `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
      const claimants = byId.get(match[1]) ?? [];
      claimants.push({ path: filePath, digest });
      byId.set(match[1], claimants);
      break;
    }
  }
  for (const [id, expected] of Object.entries(binding.ledgers)) {
    const claimants = byId.get(id) ?? [];
    if (claimants.length > 1) {
      const paths = claimants.map((item) => item.path).sort(compareCodePoints);
      conflicts.push(conflict(
        "META_SEMANTIC_BINDING_INVALID",
        `cited ledger ${id} is claimed by more than one file under ${semanticsDir}`,
        semanticsDir,
        paths,
      ));
      continue;
    }
    const found = claimants[0];
    if (!found) {
      conflicts.push(conflict(
        "META_SEMANTIC_BINDING_INVALID",
        `cited ledger ${id} is not present under ${semanticsDir}`,
        semanticsDir,
      ));
      continue;
    }
    if (found.digest !== expected) {
      conflicts.push(conflict(
        "META_SEMANTIC_BINDING_INVALID",
        `digest mismatch for ${id}: bound ${expected}, observed ${found.digest}`,
        found.path,
      ));
    }
  }
  return conflicts;
}
