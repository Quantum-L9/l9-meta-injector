/**
 * Read-only scan for competing repository metadata authorities.
 *
 * This scanner intentionally includes hidden control surfaces that normal artifact
 * discovery omits. It does not make those paths mutation candidates.
 *
 * Three distinct things are separated here, because collapsing them is what made a
 * mature repository un-adoptable without source surgery:
 *
 *   historical marker        legacy L9 metadata *text*, with nothing showing that the
 *                            containing surface writes L9 metadata. Always inert.
 *   dormant writer artifact  a control surface whose own evidence specifically claims to
 *                            write/inject/verify/generate/sync L9 metadata, but which
 *                            nothing invokes. Blocking under `forbidden`; a recorded
 *                            migration notice under `migration_only`.
 *   active invocation        a live control surface that calls a competing writer.
 *                            Blocking under every policy.
 *
 * A generic `writeFileSync` / `json.dump` / `yaml.safe_dump` / `open(..., "w")` is never
 * sufficient on its own. The write has to be tied to the L9 metadata surface, either on
 * the same line or by a filename that names it.
 *
 * The repository's declared `legacy_writers` policy is an input to this decision, not a
 * separate validation pass: there is exactly one authority scanner.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadRepositoryAuthority, type AuthorityLoadOptions } from "./authority";
import {
  operationRequiresAuthority,
  type AuthorityConfig,
  type AuthorityConflict,
  type AuthorityLegacyPolicy,
  type AuthorityNotice,
  type OperationMode,
} from "./operation_contracts";

export type AuthorityEvidenceKind =
  | "writer_script"
  | "writer_invocation"
  | "legacy_marker"
  | "canonical_invocation";

/** How the repository's legacy policy dispositions one piece of evidence. */
export type AuthorityEvidenceDisposition = "inert" | "migration" | "conflict";

export interface AuthorityEvidence {
  path: string;
  kind: AuthorityEvidenceKind;
  rule: string;
  line?: number;
  excerpt?: string;
}

export interface AuthorityScanOptions {
  maxFileBytes?: number;
  excludedDirectoryNames?: string[];
  /**
   * Repository legacy-writer policy. Absent means the authority did not resolve, and the
   * scan fails closed: every legacy writer signal is treated as a conflict.
   */
  legacyPolicy?: AuthorityLegacyPolicy;
}

export interface AuthorityScanResult {
  scannedPaths: string[];
  evidence: AuthorityEvidence[];
  scanGaps: AuthorityConflict[];
  conflicts: AuthorityConflict[];
  /** Non-blocking findings: inert historical markers and migration allowances. */
  notices: AuthorityNotice[];
}

export interface RepositoryAuthorityInspection {
  root: string;
  authorityPath: string;
  authority?: AuthorityConfig;
  authorityResolved: boolean;
  /** The policy actually applied to legacy evidence, when the authority resolved. */
  legacyPolicy?: AuthorityLegacyPolicy;
  scannedPaths: string[];
  evidence: AuthorityEvidence[];
  scanGaps: AuthorityConflict[];
  conflicts: AuthorityConflict[];
  notices: AuthorityNotice[];
}

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  ".git",
  ".venv",
  "node_modules",
  "dist",
  "build",
  "coverage",
  "__pycache__",
  "docs",
  "test",
  "tests",
  "fixture",
  "fixtures",
  "reports",
]);

const CONTROL_FILE_NAMES = new Set([
  "package.json",
  "Makefile",
  "makefile",
  "GNUmakefile",
  ".pre-commit-config.yaml",
  ".pre-commit-config.yml",
]);

const CONTROL_PREFIXES = [
  ".github/workflows/",
  ".github/actions/",
  ".githooks/",
  ".husky/",
  "scripts/",
  "bin/",
  "tools/",
];

const SUSPICIOUS_NAME = /(?:inject|verify|write|writer|generate|sync)[-_.a-z0-9]*meta(?:data)?|meta(?:data)?[-_.a-z0-9]*(?:inject|verify|write|writer|generate|sync)/i;
const LEGACY_MARKERS = [
  { value: "L9_ARTIFACT_META", rule: "legacy-marker-l9-artifact-meta" },
  { value: "x-l9-meta", rule: "legacy-marker-x-l9-meta" },
  { value: "L9_META", rule: "legacy-marker-l9-meta" },
  { value: "l9:meta:start", rule: "canonical-block-marker" },
];
const WRITE_SIGNAL = /(?:writeFileSync|writeFile\s*\(|write_text\s*\(|write_bytes\s*\(|fs\.write|yaml\.safe_dump|json\.dump|open\s*\([^)]*["']w|>\s*["']?[^\n]*meta)/i;
const WRITER_INVOCATION = /(?:^|[\s"'`])(?:python(?:3)?\s+|node\s+|bash\s+|sh\s+)?(?:\.\/)?[^\s"'`]*(?:inject|verify)[-_]?l9[-_]?meta[^\s"'`]*/im;
const CANONICAL_INVOCATION = /Quantum-L9\/l9-meta-injector@[0-9a-f]{40}|(?:^|[\s"'`])l9-meta-injector(?:[\s"'`/:]|$)/im;

/**
 * Names of the L9 metadata surface itself.
 *
 * A write becomes an L9-metadata write only when it is tied to one of these. This is the
 * discriminator that separates "this file happens to call json.dump" from "this file
 * writes competing L9 metadata".
 */
const L9_METADATA_TOKEN = /L9_ARTIFACT_META|x-l9-meta|L9_META|l9:meta:start|l9meta|l9[-_]meta|\.l9\/metadata-index/i;
/** A filename that itself claims to be an L9 metadata writer. */
const L9_METADATA_FILENAME = /l9[-_.]?meta/i;

function toPosix(value: string): string {
  return value.split(path.sep).join("/");
}

function lineFor(content: string, index: number): number {
  return content.slice(0, index).split("\n").length;
}

function excerptAt(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1;
  const endAt = content.indexOf("\n", index);
  const end = endAt === -1 ? content.length : endAt;
  return content.slice(start, end).trim().slice(0, 240);
}

function evidence(pathName: string, kind: AuthorityEvidenceKind, rule: string, content: string, index: number): AuthorityEvidence {
  return {
    path: pathName,
    kind,
    rule,
    line: lineFor(content, index),
    excerpt: excerptAt(content, index),
  };
}

function isCandidate(relativePath: string): boolean {
  const base = path.posix.basename(relativePath);
  if (CONTROL_FILE_NAMES.has(base)) return true;
  if (CONTROL_PREFIXES.some((prefix) => relativePath.startsWith(prefix))) return true;
  return SUSPICIOUS_NAME.test(base);
}

interface WalkResult {
  files: string[];
  gaps: AuthorityConflict[];
}

function scanGap(relativePath: string, message: string): AuthorityConflict {
  return {
    code: "META_AUTHORITY_SCAN_INCOMPLETE",
    message,
    path: relativePath || ".",
  };
}

function walkFiles(root: string, excluded: Set<string>): WalkResult {
  const files: string[] = [];
  const gaps: AuthorityConflict[] = [];
  const walk = (directory: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      const relative = toPosix(path.relative(root, directory)) || ".";
      gaps.push(scanGap(relative, `unable to enumerate path during authority scan: ${error instanceof Error ? error.message : String(error)}`));
      return;
    }
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      const relative = toPosix(path.relative(root, full));
      if (entry.isSymbolicLink()) {
        if (isCandidate(relative)) gaps.push(scanGap(relative, "authority scan does not follow control-surface symlinks"));
        continue;
      }
      if (entry.isDirectory()) {
        if (excluded.has(entry.name)) continue;
        walk(full);
      } else if (entry.isFile() && isCandidate(relative)) {
        files.push(full);
      }
    }
  };
  walk(root);
  files.sort((a, b) => a.localeCompare(b));
  return { files, gaps };
}

/**
 * Apply the repository's declared legacy-writer policy to one piece of evidence.
 *
 * An absent policy means the authority did not resolve; the scan then fails closed and
 * treats every legacy writer signal as a conflict.
 */
export function dispositionForEvidence(
  kind: AuthorityEvidenceKind,
  policy: AuthorityLegacyPolicy | undefined,
): AuthorityEvidenceDisposition {
  // The canonical writer is this package. Seeing it is the desired state, not a conflict.
  if (kind === "canonical_invocation") return "inert";
  // Historical marker text never blocks: it is evidence about the past, and no repository
  // should have to rewrite its own history to adopt the canonical writer.
  if (kind === "legacy_marker") return "inert";
  // A live invocation of a competing writer is a conflict under every policy.
  if (kind === "writer_invocation") return "conflict";
  // Dormant writer artifact: `migration_only` records it, `forbidden` blocks on it.
  return policy === "migration_only" ? "migration" : "conflict";
}

function evidenceDetail(item: AuthorityEvidence): string[] {
  return [`${item.rule}${item.line ? ` at line ${item.line}` : ""}`, item.excerpt ?? ""].filter(Boolean);
}

function conflictFor(item: AuthorityEvidence, policy: AuthorityLegacyPolicy | undefined): AuthorityConflict | null {
  if (dispositionForEvidence(item.kind, policy) !== "conflict") return null;
  const message = item.kind === "writer_invocation"
    ? "active control surface invokes a competing metadata writer"
    : `competing metadata writer artifact detected under legacy_writers: ${policy ?? "unresolved"}`;
  return {
    code: "META_AUTHORITY_CONFLICT",
    message,
    path: item.path,
    evidence: evidenceDetail(item),
  };
}

function noticeFor(item: AuthorityEvidence, policy: AuthorityLegacyPolicy | undefined): AuthorityNotice | null {
  const disposition = dispositionForEvidence(item.kind, policy);
  if (disposition === "migration") {
    return {
      code: "META_LEGACY_WRITER_MIGRATION",
      message: "dormant competing metadata writer artifact retained under legacy_writers: migration_only",
      path: item.path,
      evidence: evidenceDetail(item),
    };
  }
  if (item.kind === "legacy_marker") {
    return {
      code: "META_LEGACY_METADATA_PRESENT",
      message: "historical L9 metadata marker present; no evidence that this surface writes L9 metadata",
      path: item.path,
      evidence: evidenceDetail(item),
    };
  }
  return null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type ControlSurfaceRead = { relative: string; content: string } | { relative: string; gap: AuthorityConflict };

/** Read one control surface, returning its text or a scan gap explaining why it was skipped. */
function readControlSurface(filePath: string, repositoryRoot: string, maxFileBytes: number): ControlSurfaceRead {
  const relative = toPosix(path.relative(repositoryRoot, filePath));
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch (error) {
    return { relative, gap: scanGap(relative, `unable to stat control surface: ${describeError(error)}`) };
  }
  if (stat.size > maxFileBytes) {
    return { relative, gap: scanGap(relative, `control surface exceeds authority-scan limit of ${maxFileBytes} bytes`) };
  }
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    return { relative, gap: scanGap(relative, `unable to read control surface: ${describeError(error)}`) };
  }
  if (content.includes("\u0000") || content.includes("\uFFFD")) {
    return { relative, gap: scanGap(relative, "control surface is binary or not valid UTF-8 text") };
  }
  return { relative, content };
}

/**
 * Every legacy marker occurrence in the surface, unconditionally.
 *
 * This deliberately does NOT depend on a write signal. Historical marker text is evidence
 * in its own right and is preserved whether or not it turns out to be blocking.
 */
function legacyMarkerEvidence(relative: string, content: string): AuthorityEvidence[] {
  const found: AuthorityEvidence[] = [];
  for (const marker of LEGACY_MARKERS) {
    if (marker.value === "l9:meta:start") continue; // the canonical block marker, not a legacy one
    const markerIndex = content.indexOf(marker.value);
    if (markerIndex !== -1) found.push(evidence(relative, "legacy_marker", marker.rule, content, markerIndex));
  }
  return found;
}

function lineAt(content: string, index: number): string {
  const start = content.lastIndexOf("\n", index) + 1;
  const endAt = content.indexOf("\n", index);
  return content.slice(start, endAt === -1 ? content.length : endAt);
}

/** Every write-signal position in the surface, so each can be judged in its own context. */
function writeSignalIndexes(content: string): number[] {
  const scanner = new RegExp(WRITE_SIGNAL.source, "gi");
  const found: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(content)) !== null) {
    found.push(match.index);
    if (scanner.lastIndex === match.index) scanner.lastIndex += 1;
  }
  return found;
}

/**
 * Locate a write that is specifically an L9 *metadata* write.
 *
 * Qualifying evidence is either a write on a line that also names the L9 metadata surface,
 * or — for a file whose own name claims to inject/verify/generate/sync L9 metadata — any
 * write at all. A generic write with an unrelated L9 marker elsewhere in the file does not
 * qualify, which is exactly the historical-marker false positive this repairs.
 */
function findMetadataWriteIndex(relative: string, content: string): number | null {
  const indexes = writeSignalIndexes(content);
  if (indexes.length === 0) return null;
  for (const index of indexes) {
    const line = lineAt(content, index);
    // `l9-meta-injector` itself contains an L9 metadata token. A line that invokes the
    // canonical writer and redirects its output is this package doing its job, not a
    // competitor, and must never be reported as one.
    if (CANONICAL_INVOCATION.test(line)) continue;
    if (L9_METADATA_TOKEN.test(line)) return index;
  }
  const basename = path.posix.basename(relative);
  if (SUSPICIOUS_NAME.test(basename) && L9_METADATA_FILENAME.test(basename)) return indexes[0];
  return null;
}

/** Collect every authority-relevant evidence item from one scanned control surface. */
function collectSurfaceEvidence(relative: string, content: string): AuthorityEvidence[] {
  const found: AuthorityEvidence[] = [];
  const canonicalMatch = CANONICAL_INVOCATION.exec(content);
  if (canonicalMatch?.index !== undefined) {
    found.push(evidence(relative, "canonical_invocation", "canonical-l9-meta-injector-invocation", content, canonicalMatch.index));
  }
  const invocationMatch = WRITER_INVOCATION.exec(content);
  // A canonical `l9-meta-injector` reference on the same line is this package, not a
  // competitor, so it must never be reported as a competing invocation.
  if (invocationMatch?.index !== undefined && !CANONICAL_INVOCATION.test(lineAt(content, invocationMatch.index))) {
    found.push(evidence(relative, "writer_invocation", "legacy-writer-invocation", content, invocationMatch.index));
  }
  const metadataWriteIndex = findMetadataWriteIndex(relative, content);
  if (metadataWriteIndex !== null) {
    found.push(evidence(relative, "writer_script", "l9-metadata-write-signal", content, metadataWriteIndex));
  }
  found.push(...legacyMarkerEvidence(relative, content));
  return found;
}

export function scanRepositoryAuthority(root: string, options: AuthorityScanOptions = {}): AuthorityScanResult {
  const repositoryRoot = path.resolve(root);
  const excluded = new Set(DEFAULT_EXCLUDED_DIRECTORIES);
  for (const item of options.excludedDirectoryNames ?? []) excluded.add(item);
  const maxFileBytes = options.maxFileBytes ?? 1024 * 1024;
  const walked = walkFiles(repositoryRoot, excluded);
  const files = walked.files;
  const scannedPaths: string[] = [];
  const found: AuthorityEvidence[] = [];
  const scanGaps: AuthorityConflict[] = [...walked.gaps];

  for (const filePath of files) {
    const surface = readControlSurface(filePath, repositoryRoot, maxFileBytes);
    if ("gap" in surface) {
      scanGaps.push(surface.gap);
      continue;
    }
    scannedPaths.push(surface.relative);
    found.push(...collectSurfaceEvidence(surface.relative, surface.content));
  }

  const deduped = [...new Map(found.map((item) => [`${item.path}:${item.kind}:${item.rule}`, item])).values()]
    .sort((a, b) => `${a.path}:${a.kind}:${a.rule}`.localeCompare(`${b.path}:${b.kind}:${b.rule}`));
  const policy = options.legacyPolicy;
  const conflicts = [
    ...scanGaps,
    ...deduped.map((item) => conflictFor(item, policy)).filter((item): item is AuthorityConflict => item !== null),
  ];
  const notices = deduped
    .map((item) => noticeFor(item, policy))
    .filter((item): item is AuthorityNotice => item !== null);
  scannedPaths.sort((a, b) => a.localeCompare(b));
  return { scannedPaths, evidence: deduped, scanGaps, conflicts, notices };
}

export function inspectRepositoryAuthority(
  root: string,
  options: AuthorityLoadOptions & AuthorityScanOptions = {},
): RepositoryAuthorityInspection {
  const repositoryRoot = path.resolve(root);
  const loaded = loadRepositoryAuthority(repositoryRoot, options);
  // The declared policy is an input to the one scanner, so legacy evidence is judged by
  // the repository's own contract rather than by a second, independent rule set. An
  // unresolved authority leaves the policy undefined and the scan fails closed.
  const legacyPolicy = loaded.authority?.legacy_writers ?? options.legacyPolicy;
  const scanned = scanRepositoryAuthority(repositoryRoot, { ...options, ...(legacyPolicy !== undefined ? { legacyPolicy } : {}) });
  const conflicts = [...loaded.conflicts, ...scanned.conflicts];
  return {
    root: repositoryRoot,
    authorityPath: loaded.path,
    authority: loaded.authority,
    authorityResolved: loaded.authority !== undefined && conflicts.length === 0,
    ...(legacyPolicy !== undefined ? { legacyPolicy } : {}),
    scannedPaths: scanned.scannedPaths,
    evidence: scanned.evidence,
    scanGaps: scanned.scanGaps,
    conflicts,
    notices: scanned.notices,
  };
}

export function assertRepositoryAuthorityForOperation(
  mode: OperationMode,
  inspection: RepositoryAuthorityInspection,
): AuthorityConfig | undefined {
  if (!operationRequiresAuthority(mode)) return inspection.authority;
  if (!inspection.authority) {
    const codes = inspection.conflicts.map((item) => item.code).join(", ") || "META_AUTHORITY_FILE_MISSING";
    throw new Error(`operation mode '${mode}' requires resolved repository authority (${codes})`);
  }
  if (inspection.conflicts.length > 0) {
    const summary = inspection.conflicts.map((item) => `${item.code}:${item.path ?? "<repository>"}`).join(", ");
    throw new Error(`operation mode '${mode}' blocked by repository metadata authority conflict: ${summary}`);
  }
  return inspection.authority;
}
