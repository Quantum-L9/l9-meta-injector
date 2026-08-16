// interpretation.ts — deterministic repository interpretation (Seam B).
//
// Inventory answers "what files exist and what are they". Interpretation answers
// "what do those files declare", and it is a separate, separately versioned pass
// on purpose: observation must stay pure and cheap, while interpretation reads
// file bodies and can grow rules over time without perturbing the inventory
// contract.
//
// Every assertion produced here carries the evidence that produced it — exact
// repository-relative path, exact line range, a bounded excerpt, and the hash of
// the file it came from. An assertion that cannot cite a span is not emitted.
//
// Boundaries this module holds:
//   - Deterministic: no clock, no network, no locale-dependent ordering, no
//     randomness, no model. The same bytes always yield the same assertions.
//   - Observational: extractors parse syntax and report what a file states. They
//     never summarize, infer, resolve a contradiction, or upgrade a claim.
//   - Secret-safe: candidate secret files are never interpreted, and no excerpt
//     that looks like a credential is persisted.
import * as fs from "node:fs";
import * as path from "node:path";
import { InventoryResult } from "./inventory";
import { compareCodePoints, semanticHash, sha256TextPrefixed, stableId } from "./repository_model";

/** Identity of the interpretation policy. Bumped when extraction rules change. */
export const INTERPRETATION_PROFILE_ID = "meta-injector-repository-interpretation";
export const INTERPRETATION_PROFILE_VERSION = "1.0.0";

/**
 * How an assertion was evidenced.
 *
 * `declared` — the repository states it about itself (a manifest field, a
 * contract clause, a documented status).
 * `observed` — the extractor saw the construct in source (a route decorator, a
 * marker inside a handler body).
 *
 * There is deliberately no `inferred` class. An extractor that would need one is
 * out of scope for this profile.
 */
export type InterpretedEvidenceClass = "declared" | "observed";

/** Mirrors the Repository Model authority vocabulary. */
export type InterpretedAuthority =
  | "source"
  | "validated-machine"
  | "derived"
  | "candidate"
  | "unknown";

export type InterpretedConfidenceLevel = "low" | "medium" | "high";

/** 1-based, inclusive line span of the evidence inside `source_path`. */
export interface InterpretedSourceRange {
  start_line: number;
  end_line: number;
}

export interface InterpretedAssertion {
  assertion_id: string;
  subject_id: string;
  predicate: string;
  object: string;
  source_path: string;
  source_range: InterpretedSourceRange;
  evidence_excerpt: string;
  source_content_hash: string;
  extractor_id: string;
  evidence_class: InterpretedEvidenceClass;
  authority: InterpretedAuthority;
  confidence: InterpretedConfidenceLevel;
}

export interface InterpretationDiagnostic {
  code: string;
  severity: "info" | "warning" | "error";
  message: string;
  extractor_id?: string;
  source_path?: string;
}

export interface InterpretationProfile {
  profile_id: string;
  profile_version: string;
  profile_hash: string;
  /** Every extractor consulted, whether or not it produced an assertion. */
  extractor_versions: Record<string, string>;
}

export interface InterpretationResult {
  profile: InterpretationProfile;
  assertions: InterpretedAssertion[];
  diagnostics: InterpretationDiagnostic[];
}

// ───────────────────────────── extractor contract ─────────────────────────────

export interface ExtractorFileInput {
  /** Subject the assertions attach to, e.g. `repo:golden-repo`. */
  subjectId: string;
  /** Repository-relative POSIX path. Never absolute: identity must be portable. */
  sourcePath: string;
  content: string;
  /** `sha256:`-prefixed hash of the exact file bytes. */
  contentHash: string;
  /**
   * True when a repository-relative path was observed by inventory.
   *
   * Lets an extractor distinguish a reference that resolves from one that does
   * not, without guessing: a document naming a file that is not in the tree is
   * itself a fact worth reporting.
   */
  pathExists(relativePath: string): boolean;
}

/** What an extractor returns. Identity and evidence plumbing is added centrally. */
export interface AssertionDraft {
  predicate: string;
  object: string;
  sourceRange: InterpretedSourceRange;
  evidenceExcerpt: string;
  evidenceClass: InterpretedEvidenceClass;
  authority: InterpretedAuthority;
  confidence: InterpretedConfidenceLevel;
}

export interface Extractor {
  id: string;
  version: string;
  /** True when this extractor claims the file. Path-based and side-effect free. */
  matches(sourcePath: string): boolean;
  /** Parse and report. Must not throw on malformed input; return [] instead. */
  extract(input: ExtractorFileInput): AssertionDraft[];
}

// ───────────────────────────── secret safety ─────────────────────────────

/**
 * Files never opened for interpretation.
 *
 * Matching is on the repository-relative POSIX path, case-insensitively. This is
 * a refusal to read, not a filter on output: the safest excerpt of a private key
 * is the one that was never loaded.
 */
const SECRET_PATH_PATTERNS: RegExp[] = [
  /(^|\/)\.env$/i,
  /(^|\/)\.env\./i,
  /\.pem$/i,
  /\.key$/i,
  /\.p12$/i,
  /\.pfx$/i,
  /(^|\/)id_(rsa|dsa|ecdsa|ed25519)$/i,
  /credential/i,
  /secret/i,
  /password/i,
  /\.netrc$/i,
  /(^|\/)\.htpasswd$/i,
];

export function isSecretCandidatePath(sourcePath: string): boolean {
  return SECRET_PATH_PATTERNS.some((pattern) => pattern.test(sourcePath));
}

/**
 * Values that must never be persisted in an excerpt even from a file whose path
 * looked innocuous. A long opaque token assigned to a suggestive name is the
 * shape worth refusing; the assertion is dropped rather than redacted, because a
 * redacted excerpt is no longer evidence of anything.
 */
const SECRET_VALUE_PATTERNS: RegExp[] = [
  /\b(?:api[_-]?key|secret|token|password|passwd|credential|private[_-]?key)\b\s*[:=]\s*\S{8,}/i,
  /-----BEGIN[A-Z ]*PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
];

export function looksSecret(value: string): boolean {
  return SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/** Excerpts are bounded so a packet can never become a file mirror. */
export const MAX_EXCERPT_LENGTH = 240;
/** Files larger than this are reported as a diagnostic rather than interpreted. */
export const DEFAULT_MAX_FILE_BYTES = 512 * 1024;

export function boundExcerpt(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= MAX_EXCERPT_LENGTH
    ? collapsed
    : `${collapsed.slice(0, MAX_EXCERPT_LENGTH - 1)}…`;
}

// ───────────────────────────── orchestration ─────────────────────────────

export interface InterpretRepositoryInput {
  /** Repository root the inventory was taken from. */
  root: string;
  /** Subject the assertions attach to, e.g. `repo:golden-repo`. */
  subjectId: string;
  inventory: InventoryResult;
  /**
   * Extractors to consult. Passed in rather than defaulted here so the contract
   * does not depend on the registry that implements it; callers use
   * `defaultExtractors()` from `./extractors`.
   */
  extractors: Extractor[];
  maxFileBytes?: number;
}

function profileHash(extractors: Extractor[]): string {
  return semanticHash({
    id: INTERPRETATION_PROFILE_ID,
    version: INTERPRETATION_PROFILE_VERSION,
    evidence_classes: ["declared", "observed"],
    ordering: "code-point",
    absolute_paths_in_identity: false,
    max_excerpt_length: MAX_EXCERPT_LENGTH,
    extractors: extractors
      .map((extractor) => ({ id: extractor.id, version: extractor.version }))
      .sort((left, right) => compareCodePoints(left.id, right.id)),
  });
}

/** Total order over assertions. Stable regardless of filesystem or extractor order. */
function compareAssertions(left: InterpretedAssertion, right: InterpretedAssertion): number {
  return (
    compareCodePoints(left.source_path, right.source_path) ||
    left.source_range.start_line - right.source_range.start_line ||
    left.source_range.end_line - right.source_range.end_line ||
    compareCodePoints(left.predicate, right.predicate) ||
    compareCodePoints(left.object, right.object) ||
    compareCodePoints(left.extractor_id, right.extractor_id)
  );
}

function compareDiagnostics(
  left: InterpretationDiagnostic,
  right: InterpretationDiagnostic,
): number {
  return (
    compareCodePoints(left.code, right.code) ||
    compareCodePoints(left.source_path ?? "", right.source_path ?? "") ||
    compareCodePoints(left.message, right.message)
  );
}

/**
 * Interpret a repository that inventory has already observed.
 *
 * Returns an empty assertion set rather than throwing when nothing matches: a
 * repository the profile has no rules for is not an error, it is a repository
 * with no declared semantics this profile can read.
 */
export function interpretRepository(input: InterpretRepositoryInput): InterpretationResult {
  const extractors = [...input.extractors].sort((left, right) =>
    compareCodePoints(left.id, right.id),
  );
  const maxFileBytes = input.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const assertions: InterpretedAssertion[] = [];
  const diagnostics: InterpretationDiagnostic[] = [];

  // Inventory order is filesystem order; sort so the read order is fixed too.
  const records = [...input.inventory.records]
    .filter((record) => record.artifact_type !== "folder")
    .sort((left, right) => compareCodePoints(left.relative_path, right.relative_path));
  const observedPaths = new Set(input.inventory.records.map((record) => record.relative_path));
  const pathExists = (relativePath: string): boolean =>
    observedPaths.has(relativePath.replace(/^\.\//, ""));

  for (const record of records) {
    const sourcePath = record.relative_path;
    const claiming = extractors.filter((extractor) => extractor.matches(sourcePath));
    if (claiming.length === 0) continue;

    if (isSecretCandidatePath(sourcePath)) {
      diagnostics.push({
        code: "interpretation.secret_path_skipped",
        severity: "info",
        message: "path matches a credential pattern and was not opened for interpretation",
        source_path: sourcePath,
      });
      continue;
    }
    if (record.size_bytes !== null && record.size_bytes > maxFileBytes) {
      diagnostics.push({
        code: "interpretation.file_too_large",
        severity: "warning",
        message: `file exceeds the ${maxFileBytes}-byte interpretation limit and was not read`,
        source_path: sourcePath,
      });
      continue;
    }

    const absolute = record.absolute_path ?? path.join(input.root, sourcePath);
    let content: string;
    try {
      content = fs.readFileSync(absolute, "utf8");
    } catch (error) {
      diagnostics.push({
        code: "interpretation.unreadable",
        severity: "warning",
        message: `file could not be read: ${(error as Error).message}`,
        source_path: sourcePath,
      });
      continue;
    }
    // Hash the text actually interpreted, so evidence binds to what was parsed.
    const contentHash = sha256TextPrefixed(content);

    for (const extractor of claiming) {
      let drafts: AssertionDraft[];
      try {
        drafts = extractor.extract({
          subjectId: input.subjectId,
          sourcePath,
          content,
          contentHash,
          pathExists,
        });
      } catch (error) {
        // A malformed file is a fact about the repository, not a crash.
        diagnostics.push({
          code: "interpretation.extractor_failed",
          severity: "warning",
          message: `extractor did not complete: ${(error as Error).message}`,
          extractor_id: extractor.id,
          source_path: sourcePath,
        });
        continue;
      }

      for (const draft of drafts) {
        const excerpt = boundExcerpt(draft.evidenceExcerpt);
        if (looksSecret(excerpt) || looksSecret(draft.object)) {
          diagnostics.push({
            code: "interpretation.secret_value_suppressed",
            severity: "warning",
            message: "assertion was dropped because its evidence resembled a credential",
            extractor_id: extractor.id,
            source_path: sourcePath,
          });
          continue;
        }
        if (draft.sourceRange.start_line < 1 || draft.sourceRange.end_line < draft.sourceRange.start_line) {
          diagnostics.push({
            code: "interpretation.invalid_source_range",
            severity: "error",
            message: "assertion was dropped because its source range was not a valid span",
            extractor_id: extractor.id,
            source_path: sourcePath,
          });
          continue;
        }
        const identity = {
          subject_id: input.subjectId,
          predicate: draft.predicate,
          object: draft.object,
          source_path: sourcePath,
          source_range: draft.sourceRange,
          extractor_id: extractor.id,
        };
        assertions.push({
          assertion_id: stableId("assertion", identity),
          subject_id: input.subjectId,
          predicate: draft.predicate,
          object: draft.object,
          source_path: sourcePath,
          source_range: draft.sourceRange,
          evidence_excerpt: excerpt,
          source_content_hash: contentHash,
          extractor_id: extractor.id,
          evidence_class: draft.evidenceClass,
          authority: draft.authority,
          confidence: draft.confidence,
        });
      }
    }
  }

  return {
    profile: {
      profile_id: INTERPRETATION_PROFILE_ID,
      profile_version: INTERPRETATION_PROFILE_VERSION,
      profile_hash: profileHash(extractors),
      extractor_versions: Object.fromEntries(
        extractors.map((extractor) => [extractor.id, extractor.version]),
      ),
    },
    assertions: assertions.sort(compareAssertions),
    diagnostics: diagnostics.sort(compareDiagnostics),
  };
}
