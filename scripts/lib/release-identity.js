"use strict";
// release-identity.js — derive every release identifier from one version string.
//
// ADR-050 makes `package.json#version` the sole persisted semantic-version
// authority: the lockfile version, the exact tag, the release-plan identity and
// the maintained major tag are all derived from it. Before this module that
// derivation existed four times over — in `scripts/prepare-release.js`, in
// `scripts/check-release-candidate.js`, in the release contract test, and again
// in bash inside `.github/workflows/release.yml` as `${VERSION%%.*}`. Four
// copies of one rule is four places for a candidate-specific constant to hide,
// which is how `v4.0.1` and `@v4` ended up embedded in automation that is
// triggered generically.
//
// Everything here is pure and takes its inputs as arguments: no filesystem
// access at module scope, so the derivation can be unit-tested for releases
// that have not happened yet. `scripts/release-identity-cli.js` is the shell
// entry point, so a workflow consumes this module rather than re-deriving.
const REPOSITORY = "Quantum-L9/l9-meta-injector";
const PLAN_SCHEMA = "l9.meta-injector-release-plan/v2";
const PLAN_DIRECTORY = "docs/release";

// Plain SemVer only. A prerelease or build-metadata version would resolve to a
// major tag that consumers follow, so it is rejected rather than truncated.
const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)$/;
const RELEASE_BRANCH_PATTERN = /^release\/v(\d+\.\d+\.\d+)$/;
const PLAN_FILE_PATTERN = /^v(\d+\.\d+\.\d+)-release-plan\.json$/;

/**
 * Parse a plain SemVer string into its numeric parts.
 *
 * @param {string} value
 * @returns {{major: number, minor: number, patch: number} | null} null when the
 *   value is absent or is not exactly three dot-separated integers.
 */
function parseVersion(value) {
  const match = VERSION_PATTERN.exec(typeof value === "string" ? value : "");
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/**
 * Parse a version or throw naming the offending input.
 *
 * @param {string} value
 * @param {string} label what the value is, so the message says which input was wrong.
 */
function assertVersion(value, label) {
  const parsed = parseVersion(value);
  if (!parsed) throw new Error(`${label} is not plain SemVer: ${JSON.stringify(value)}`);
  return parsed;
}

/**
 * Order two versions.
 *
 * @returns {-1 | 0 | 1} -1 when a precedes b, 1 when a follows b, 0 when equal.
 */
function compareVersions(a, b) {
  const left = assertVersion(a, "version");
  const right = assertVersion(b, "version");
  for (const part of ["major", "minor", "patch"]) {
    if (left[part] < right[part]) return -1;
    if (left[part] > right[part]) return 1;
  }
  return 0;
}

/**
 * Which component a version advanced, if it advanced at all.
 *
 * @returns {"major" | "minor" | "patch" | null} null when next does not
 *   strictly follow prev — equal versions and regressions are both null,
 *   because neither is an advance.
 */
function bumpKind(prev, next) {
  if (compareVersions(prev, next) !== -1) return null;
  const from = assertVersion(prev, "previous version");
  const to = assertVersion(next, "next version");
  if (to.major !== from.major) return "major";
  if (to.minor !== from.minor) return "minor";
  return "patch";
}

/** Whether next strictly follows prev. Equality is not an advance. */
function isAdvance(prev, next) {
  return compareVersions(prev, next) === -1;
}

/**
 * Every identifier a release derives from its version.
 *
 * @param {string} version the authority value, i.e. `package.json#version`.
 */
function releaseIdentity(version) {
  const { major, minor, patch } = assertVersion(version, "release version");
  return {
    version,
    major,
    minor,
    patch,
    exactTag: `v${version}`,
    majorTag: `v${major}`,
    consumerRef: `${REPOSITORY}@v${major}`,
    planPath: `${PLAN_DIRECTORY}/v${version}-release-plan.json`,
    releaseBranch: `release/v${version}`,
    planSchema: PLAN_SCHEMA,
    repository: REPOSITORY,
  };
}

/**
 * The version a release branch names, or null when the ref is not one.
 *
 * The branch name is an assertion input, never a value source: reading a
 * version out of it and writing that into `package.json` is the dataflow
 * inversion ADR-050 exists to forbid.
 */
function parseReleaseBranch(ref) {
  const match = RELEASE_BRANCH_PATTERN.exec(typeof ref === "string" ? ref : "");
  return match ? match[1] : null;
}

/**
 * Fail closed when a release branch disagrees with the version authority.
 *
 * A ref that is not a release branch is not checked — `main` and feature
 * branches legitimately carry any version.
 *
 * @param {string} ref branch name, e.g. `release/v1.2.3` or `$GITHUB_REF_NAME`.
 * @param {string} version the authority value.
 */
function assertBranchMatchesVersion(ref, version) {
  const branchVersion = parseReleaseBranch(ref);
  if (branchVersion === null) return;
  if (branchVersion !== version) {
    throw new Error(
      `release branch ${ref} does not match the version authority: ` +
        `package.json#version is ${version}. Bump package.json to ${branchVersion}, ` +
        `or rename the branch to ${releaseIdentity(version).releaseBranch}.`,
    );
  }
}

// Any consumer reference to this action, whatever it currently points at.
// Matching a pattern rather than one literal ref is the difference between a
// projection that works at every major transition and a one-time migration:
// the previous rewrite searched for the pre-v1 `@main` form, which stopped
// existing the moment the first projection ran, so it silently became dead
// code and a future major would have left every documented consumer behind.
const CONSUMER_REF_PATTERN = new RegExp(`${REPOSITORY}@(?:main|v\\d+)`, "g");

/** Every consumer reference in `text`, in order of appearance. */
function findConsumerRefs(text) {
  return String(text).match(CONSUMER_REF_PATTERN) || [];
}

/**
 * Point every consumer reference in `text` at the maintained major line.
 *
 * Idempotent: re-projecting the same major changes nothing, which is what lets
 * release preparation run repeatedly on an already-prepared branch.
 *
 * @param {string} text document body, e.g. README.md
 * @param {string} majorTag the derived `vX`
 */
function projectConsumerRefs(text, majorTag) {
  return String(text).replace(CONSUMER_REF_PATTERN, `${REPOSITORY}@${majorTag}`);
}

/** Matches a release-plan filename, capturing its version. */
function planPathPattern() {
  return PLAN_FILE_PATTERN;
}

/** The plan directory, relative to the repository root. */
function planDirectory() {
  return PLAN_DIRECTORY;
}

/**
 * The release immediately preceding `current`.
 *
 * Used to stamp the outgoing plan as superseded. Deriving it is what keeps the
 * next patch release from re-stamping a plan two releases back and leaving the
 * one it actually replaces un-superseded forever.
 *
 * @param {string[]} versions every known release version, unordered.
 * @param {string} current the version being prepared.
 * @returns {string | null} the greatest version strictly below current.
 */
function predecessorVersion(versions, current) {
  assertVersion(current, "current version");
  let best = null;
  for (const candidate of versions) {
    if (!parseVersion(candidate)) continue;
    if (compareVersions(candidate, current) !== -1) continue;
    if (best === null || compareVersions(candidate, best) === 1) best = candidate;
  }
  return best;
}

module.exports = {
  REPOSITORY,
  PLAN_SCHEMA,
  parseVersion,
  assertVersion,
  compareVersions,
  bumpKind,
  isAdvance,
  releaseIdentity,
  parseReleaseBranch,
  assertBranchMatchesVersion,
  planPathPattern,
  planDirectory,
  predecessorVersion,
  findConsumerRefs,
  projectConsumerRefs,
};
