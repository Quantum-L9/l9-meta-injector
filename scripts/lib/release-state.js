"use strict";
// release-state.js — decide what a release push still has to do.
//
// Publication has three independent side effects: the immutable exact tag, the
// GitHub Release, and the maintained major pointer. The first version of this
// logic lived in bash inside the workflow and collapsed them into a single
// flag, reading "the exact tag exists" as "the release is complete". Because
// the exact tag is created first, any failure after it stranded the release: a
// rerun saw the tag, concluded there was nothing left to do, and skipped both
// acceptance and publication, so an ordinary rerun could never converge and the
// maintained major pointer stayed stale behind an immutable tag.
//
// Keeping the three states apart is what makes a rerun safe. Putting the
// decision in a pure function is what makes every partial boundary testable —
// the defect above could not be caught while the rule lived in YAML.
const { compareVersions } = require("./release-identity.js");

/**
 * What remains to be done for the release at `headSha`.
 *
 * Every input is an observation of remote state; this function performs no I/O
 * so the caller decides how to observe and this stays exercisable for states
 * that are awkward to reach for real.
 *
 * @param {object} observed
 * @param {string} observed.headSha            commit being released
 * @param {string|null} observed.exactTagSha   what `vX.Y.Z` resolves to, if it exists
 * @param {string|null} observed.majorTagSha   what `vX` resolves to, if it exists
 * @param {string|null} observed.majorTagVersion  package version at `majorTagSha`
 * @param {string} observed.version            package.json version being released
 * @param {boolean} observed.releaseExists     whether the GitHub Release exists
 * @returns {{isReleaseCommit: boolean, createExact: boolean, createRelease: boolean,
 *            advanceMajor: boolean, majorVerdict: "create"|"advance"|"hold"|"regress",
 *            workPending: boolean, reason: string}}
 */
function releaseDecision(observed) {
  const { headSha, exactTagSha, majorTagSha, majorTagVersion, version, releaseExists } = observed;
  if (!headSha) throw new Error("releaseDecision requires headSha");

  const exact = exactTagSha || null;
  const major = majorTagSha || null;

  // An exact tag somewhere else means this version was released from another
  // commit. Exact tags are immutable provenance and are never moved, so there
  // is nothing to do — this is the ordinary shape of a package.json push that
  // is not a version bump.
  if (exact && exact !== headSha) {
    return {
      isReleaseCommit: false,
      createExact: false,
      createRelease: false,
      advanceMajor: false,
      majorVerdict: "hold",
      workPending: false,
      reason: `the exact tag already exists at ${exact}; this push is not a new release`,
    };
  }

  const createExact = exact === null;
  const createRelease = !releaseExists;

  let majorVerdict;
  if (major === null) {
    // First pointer for this major line: created, never leased over a prior one.
    majorVerdict = "create";
  } else if (major === headSha) {
    majorVerdict = "hold";
  } else {
    const order = compareVersions(majorTagVersion, version);
    majorVerdict = order === -1 ? "advance" : order === 0 ? "hold" : "regress";
  }

  const advanceMajor = majorVerdict === "create" || majorVerdict === "advance";
  const workPending = createExact || createRelease || advanceMajor;

  const outstanding = [
    createExact ? "exact tag" : null,
    createRelease ? "GitHub Release" : null,
    advanceMajor ? "maintained major tag" : null,
  ].filter(Boolean);

  return {
    isReleaseCommit: true,
    createExact,
    createRelease,
    advanceMajor,
    majorVerdict,
    workPending,
    reason:
      majorVerdict === "regress"
        ? `the maintained major tag is ahead of this release; refusing to move it back`
        : outstanding.length === 0
          ? "the release is already complete at this commit"
          : `outstanding: ${outstanding.join(", ")}`,
  };
}

module.exports = { releaseDecision };
