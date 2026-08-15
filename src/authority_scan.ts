/**
 * Read-only scan for competing repository metadata authorities.
 *
 * This scanner intentionally includes hidden control surfaces that normal artifact
 * discovery omits. It does not make those paths mutation candidates. It looks for
 * executable writer scripts and invocations, while treating marker text in docs,
 * tests, fixtures, and reports as inert evidence rather than an active conflict.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loadRepositoryAuthority, type AuthorityLoadOptions } from "./authority";
import {
  operationRequiresAuthority,
  type AuthorityConfig,
  type AuthorityConflict,
  type OperationMode,
} from "./operation_contracts";

export type AuthorityEvidenceKind =
  | "writer_script"
  | "writer_invocation"
  | "legacy_marker"
  | "canonical_invocation";

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
}

export interface AuthorityScanResult {
  scannedPaths: string[];
  evidence: AuthorityEvidence[];
  scanGaps: AuthorityConflict[];
  conflicts: AuthorityConflict[];
}

export interface RepositoryAuthorityInspection {
  root: string;
  authorityPath: string;
  authority?: AuthorityConfig;
  authorityResolved: boolean;
  scannedPaths: string[];
  evidence: AuthorityEvidence[];
  scanGaps: AuthorityConflict[];
  conflicts: AuthorityConflict[];
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

function conflictFor(item: AuthorityEvidence): AuthorityConflict | null {
  if (item.kind === "canonical_invocation") return null;
  const code = item.kind === "legacy_marker" ? "META_LEGACY_METADATA_PRESENT" : "META_AUTHORITY_CONFLICT";
  let message: string;
  if (item.kind === "writer_invocation") {
    message = "active control surface invokes a competing metadata writer";
  } else if (item.kind === "writer_script") {
    message = "competing metadata writer script detected";
  } else {
    message = "legacy metadata marker participates in an active writer";
  }
  return {
    code,
    message,
    path: item.path,
    evidence: [`${item.rule}${item.line ? ` at line ${item.line}` : ""}`, item.excerpt ?? ""].filter(Boolean),
  };
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

function legacyMarkerEvidence(relative: string, content: string): AuthorityEvidence[] {
  const found: AuthorityEvidence[] = [];
  for (const marker of LEGACY_MARKERS) {
    const markerIndex = content.indexOf(marker.value);
    if (markerIndex !== -1 && marker.value !== "l9:meta:start") {
      found.push(evidence(relative, "legacy_marker", marker.rule, content, markerIndex));
    }
  }
  return found;
}

/** Collect every authority-relevant evidence item from one scanned control surface. */
function collectSurfaceEvidence(relative: string, content: string): AuthorityEvidence[] {
  const found: AuthorityEvidence[] = [];
  const canonicalMatch = CANONICAL_INVOCATION.exec(content);
  if (canonicalMatch?.index !== undefined) {
    found.push(evidence(relative, "canonical_invocation", "canonical-l9-meta-injector-invocation", content, canonicalMatch.index));
  }
  const invocationMatch = WRITER_INVOCATION.exec(content);
  if (invocationMatch?.index !== undefined) {
    found.push(evidence(relative, "writer_invocation", "legacy-writer-invocation", content, invocationMatch.index));
  }
  const writeMatch = WRITE_SIGNAL.exec(content);
  if (SUSPICIOUS_NAME.test(path.posix.basename(relative)) && writeMatch?.index !== undefined) {
    found.push(evidence(relative, "writer_script", "suspicious-writer-filename-with-write-signal", content, writeMatch.index));
  }
  if (writeMatch?.index !== undefined) {
    found.push(...legacyMarkerEvidence(relative, content));
  }
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
    .sort((a, b) => `${a.path}:${a.kind}`.localeCompare(`${b.path}:${b.kind}`));
  const conflicts = [
    ...scanGaps,
    ...deduped.map(conflictFor).filter((item): item is AuthorityConflict => item !== null),
  ];
  scannedPaths.sort((a, b) => a.localeCompare(b));
  return { scannedPaths, evidence: deduped, scanGaps, conflicts };
}

export function inspectRepositoryAuthority(
  root: string,
  options: AuthorityLoadOptions & AuthorityScanOptions = {},
): RepositoryAuthorityInspection {
  const repositoryRoot = path.resolve(root);
  const loaded = loadRepositoryAuthority(repositoryRoot, options);
  const scanned = scanRepositoryAuthority(repositoryRoot, options);
  const conflicts = [...loaded.conflicts, ...scanned.conflicts];
  return {
    root: repositoryRoot,
    authorityPath: loaded.path,
    authority: loaded.authority,
    authorityResolved: loaded.authority !== undefined && conflicts.length === 0,
    scannedPaths: scanned.scannedPaths,
    evidence: scanned.evidence,
    scanGaps: scanned.scanGaps,
    conflicts,
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
