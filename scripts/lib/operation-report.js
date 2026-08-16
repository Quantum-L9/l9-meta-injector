"use strict";
/**
 * Human-readable rendering of governed operation outcomes.
 *
 * A governed run that stops must say what stopped it, where, and why, without the
 * operator opening the injector's source. Every renderer here is deterministic: the same
 * result always produces the same lines in the same order.
 *
 * Diagnostics quote repository content (control-surface excerpts, frontmatter messages),
 * so every quoted value passes through `redact` first. A conflict is worth reporting; a
 * credential that happened to sit on the same line is not.
 */

const SECRET_ASSIGNMENT =
  /((?:api[_-]?key|apikey|token|secret|password|passwd|pwd|authorization|bearer|client[_-]?secret)\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;

/**
 * A long opaque credential-shaped run. Deliberately narrow: it requires a mixed-case
 * alphanumeric run, so Git object ids, content hashes, and pinned Action SHAs — which are
 * exactly the values an operator needs to see — are left intact.
 */
const OPAQUE_CREDENTIAL = /\b(?=[A-Za-z0-9_\-+/]{32,})(?=[^\s]*[a-z])(?=[^\s]*[A-Z])(?=[^\s]*\d)[A-Za-z0-9_\-+/]{32,}={0,2}\b/g;

const REDACTED = "[redacted]";

function redact(value) {
  if (typeof value !== "string" || value.length === 0) return value;
  return value
    .replace(SECRET_ASSIGNMENT, (_match, prefix) => `${prefix}${REDACTED}`)
    .replace(OPAQUE_CREDENTIAL, REDACTED);
}

function compare(...keys) {
  return (left, right) => {
    for (const key of keys) {
      const a = String(left[key] ?? "");
      const b = String(right[key] ?? "");
      if (a !== b) return a < b ? -1 : 1;
    }
    return 0;
  };
}

function detailLines(label, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return [];
  return evidence.map((item) => `${label}evidence: ${redact(String(item))}`);
}

/** `CODE at path: message`, with `path` omitted when the finding is repository-wide. */
function describeAuthorityFinding(item) {
  const where = item.path ? ` at ${item.path}` : "";
  return `${item.code}${where}: ${redact(String(item.message ?? ""))}`;
}

function describeDrift(item) {
  const hashes = item.expectedHash && item.actualHash
    ? ` (expected ${item.expectedHash}, actual ${item.actualHash})`
    : item.expectedHash ? ` (expected ${item.expectedHash})` : "";
  return `${item.kind}: ${item.path}: ${redact(String(item.message ?? ""))}${hashes}`;
}

/** Carrier decisions that fell back because a file could not carry its own metadata. */
function carrierFallbacks(carrierDecisions) {
  return (carrierDecisions ?? [])
    .filter((item) => typeof item.authorityRule === "string" && item.authorityRule.startsWith("frontmatter_unsupported:"))
    .sort(compare("path", "authorityRule"));
}

/**
 * Render an apply outcome. Returns an ordered array of lines; the caller decides the
 * stream. A passing run reports only non-blocking findings.
 */
function renderApply(label, apply, warnings = []) {
  const lines = [];
  for (const warning of warnings) lines.push(`${label}: warning: ${redact(String(warning))}`);

  const conflicts = [...(apply.authorityConflicts ?? [])].sort(compare("code", "path", "message"));
  if (conflicts.length > 0) {
    lines.push(`${label}: apply refused by ${conflicts.length} repository authority conflict(s):`);
    for (const item of conflicts) {
      lines.push(`${label}:   - ${describeAuthorityFinding(item)}`);
      lines.push(...detailLines(`${label}:       `, item.evidence));
    }
    lines.push(`${label}: the repository was not modified`);
  }

  const fallbacks = carrierFallbacks(apply.carrierDecisions);
  for (const item of fallbacks) {
    lines.push(`${label}: note: ${item.path}: ${redact(item.reason)} [${item.authorityRule}]`);
  }
  for (const item of [...(apply.authorityNotices ?? [])].sort(compare("code", "path", "message"))) {
    lines.push(`${label}: note: ${describeAuthorityFinding(item)}`);
  }
  return lines;
}

/** Render a check outcome: drift first, then authority findings, then notices. */
function renderCheck(label, check, warnings = []) {
  const lines = [];
  for (const warning of warnings) lines.push(`${label}: warning: ${redact(String(warning))}`);

  for (const item of [...(check.drift ?? [])].sort(compare("path", "kind", "message"))) {
    lines.push(`${label}:   - ${describeDrift(item)}`);
  }
  const conflicts = [...(check.authorityConflicts ?? [])].sort(compare("code", "path", "message"));
  if (conflicts.length > 0) {
    lines.push(`${label}: ${conflicts.length} repository authority conflict(s):`);
    for (const item of conflicts) {
      lines.push(`${label}:   - ${describeAuthorityFinding(item)}`);
      lines.push(...detailLines(`${label}:       `, item.evidence));
    }
  }
  for (const item of carrierFallbacks(check.carrierDecisions)) {
    lines.push(`${label}: note: ${item.path}: ${redact(item.reason)} [${item.authorityRule}]`);
  }
  for (const item of [...(check.authorityNotices ?? [])].sort(compare("code", "path", "message"))) {
    lines.push(`${label}: note: ${describeAuthorityFinding(item)}`);
  }
  return lines;
}

/**
 * Render a thrown error as an operator-actionable failure rather than a raw stack.
 * The stack is still available behind `L9_DEBUG=1` for maintainers.
 */
function renderThrow(label, error, env = process.env) {
  const message = error instanceof Error ? error.message : String(error);
  const lines = [`${label}: FAILED: ${redact(message)}`];
  if (env.L9_DEBUG === "1" && error instanceof Error && error.stack) lines.push(redact(error.stack));
  return lines;
}

module.exports = { redact, renderApply, renderCheck, renderThrow };
