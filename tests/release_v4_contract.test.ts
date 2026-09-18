import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, test } from "vitest";

const identity = require("../scripts/lib/release-identity.js");
const releaseState = require("../scripts/lib/release-state.js");

const ROOT = path.resolve(__dirname, "..");
const read = (relative: string) => fs.readFileSync(path.join(ROOT, relative), "utf8");

// --- derivation for releases that have not happened yet ---------------------
//
// The point of these rows is that they prove the rule without performing a
// release. ADR-050 says patch and minor releases advance the same maintained
// major tag while a new major starts a new line; that is a property of the
// derivation, so it can be asserted directly.

const CURRENT = "4.1.0";

test.each([
  { next: "4.1.1", bump: "patch", majorTag: "v4" },
  { next: "4.2.0", bump: "minor", majorTag: "v4" },
  { next: "5.0.0", bump: "major", majorTag: "v5" },
])("derives release identity for the next $bump release", ({ next, bump, majorTag }) => {
  expect(identity.bumpKind(CURRENT, next)).toBe(bump);
  const derived = identity.releaseIdentity(next);
  expect(derived.exactTag).toBe(`v${next}`);
  expect(derived.majorTag).toBe(majorTag);
  expect(derived.consumerRef).toBe(`Quantum-L9/l9-meta-injector@${majorTag}`);
  expect(derived.planPath).toBe(`docs/release/v${next}-release-plan.json`);
  expect(derived.releaseBranch).toBe(`release/v${next}`);
});

describe("maintained major line", () => {
  it("keeps patch and minor releases on the same major tag", () => {
    const base = identity.releaseIdentity(CURRENT).majorTag;
    expect(identity.releaseIdentity("4.1.1").majorTag).toBe(base);
    expect(identity.releaseIdentity("4.2.0").majorTag).toBe(base);
  });

  it("never lets a new major rewrite the prior major line", () => {
    expect(identity.releaseIdentity("5.0.0").majorTag).not.toBe(
      identity.releaseIdentity(CURRENT).majorTag,
    );
  });

  test.each([
    { prev: "4.1.0", next: "4.1.1", advance: true },
    { prev: "4.1.0", next: "5.0.0", advance: true },
    { prev: "4.1.0", next: "4.1.0", advance: false },
    { prev: "4.1.0", next: "4.0.9", advance: false },
    { prev: "5.0.0", next: "4.9.9", advance: false },
  ])("$prev -> $next advances: $advance", ({ prev, next, advance }) => {
    expect(identity.isAdvance(prev, next)).toBe(advance);
    expect(identity.bumpKind(prev, next) !== null).toBe(advance);
  });

  it("rejects a version that is not plain SemVer", () => {
    for (const bad of ["4.1.0-rc.1", "v4.1.0", "4.1", "", "latest"]) {
      expect(identity.parseVersion(bad)).toBeNull();
      expect(() => identity.releaseIdentity(bad)).toThrow();
    }
  });
});

// --- the branch is an assertion input, never a value source -----------------

describe("release branch", () => {
  test.each([
    { ref: "release/v4.1.0", version: "4.1.0" },
    { ref: "release/v5.0.0", version: "5.0.0" },
  ])("$ref names version $version", ({ ref, version }) => {
    expect(identity.parseReleaseBranch(ref)).toBe(version);
    expect(() => identity.assertBranchMatchesVersion(ref, version)).not.toThrow();
  });

  it("is not a release branch when it does not carry a version", () => {
    for (const ref of ["main", "feat/thing", "release/v4.1", ""]) {
      expect(identity.parseReleaseBranch(ref)).toBeNull();
      // A non-release branch carries any version legitimately.
      expect(() => identity.assertBranchMatchesVersion(ref, "4.1.0")).not.toThrow();
    }
  });

  it("fails closed when the branch disagrees with the version authority", () => {
    expect(() => identity.assertBranchMatchesVersion("release/v4.2.0", "4.1.0")).toThrow(
      /release\/v4\.2\.0.*4\.1\.0/s,
    );
  });
});

// --- the predecessor plan is derived ----------------------------------------

describe("predecessor plan", () => {
  test.each([
    { current: "4.1.0", expected: "4.0.1" },
    { current: "4.1.1", expected: "4.1.0" },
    { current: "5.0.0", expected: "4.1.0" },
    { current: "4.0.0", expected: null },
  ])("predecessor of $current is $expected", ({ current, expected }) => {
    const known = ["4.0.0", "4.0.1", "4.1.0"];
    expect(identity.predecessorVersion(known, current)).toBe(expected);
  });
});

// --- no candidate-specific constants in generic release automation ----------
//
// Release prep and release publication are triggered generically, by any
// release/vX.Y.Z branch and any version bump. A literal release version or
// consumer major ref inside them is therefore a defect that only shows up one
// release later. This is the guard that keeps them out.

const AUTOMATION = [
  "scripts/prepare-release.js",
  "scripts/check-release-candidate.js",
  "scripts/lib/release-identity.js",
  "scripts/lib/release-state.js",
  "scripts/release-identity-cli.js",
  ".github/workflows/release.yml",
  ".github/workflows/release-prep.yml",
];

test.each(AUTOMATION)("%s hardcodes no release version or consumer line", (relative) => {
  const body = read(relative)
    .split("\n")
    // Comments may name versions while explaining a defect; the guard is about
    // constants the automation executes. Action pins carry a version comment on
    // the `uses:` line, and those are immutable third-party references rather
    // than this package's release line.
    .filter((line) => !/^\s*(#|\/\/)/.test(line) && !/\buses:/.test(line))
    .join("\n");
  expect(body).not.toMatch(/\b\d+\.\d+\.\d+\b/);
  expect(body).not.toMatch(/l9-meta-injector@v\d/);
});

// --- README consumer refs follow the maintained major -----------------------
//
// README holds the canonical action examples, so they are what a consumer
// copies. Projecting them was written as a one-time `@main` migration, which
// stopped matching the moment it ran once: a future major would have advertised
// the previous line forever. These run against the real README bytes, because
// the defect is precisely that the real document stops matching.

describe("README consumer projection", () => {
  const readme = read("README.md");

  it("states at least one consumer reference to project", () => {
    expect(identity.findConsumerRefs(readme).length).toBeGreaterThan(0);
  });

  test.each([
    { version: "4.1.1", majorTag: "v4", note: "next patch keeps the line" },
    { version: "4.2.0", majorTag: "v4", note: "next minor keeps the line" },
    { version: "5.0.0", majorTag: "v5", note: "a new major moves it" },
    { version: "10.0.0", majorTag: "v10", note: "a two-digit major still parses" },
  ])("$note ($version -> $majorTag)", ({ version, majorTag }) => {
    const derived = identity.releaseIdentity(version);
    expect(derived.majorTag).toBe(majorTag);
    const projected = identity.projectConsumerRefs(readme, derived.majorTag);
    const refs = identity.findConsumerRefs(projected);
    expect(refs.length).toBe(identity.findConsumerRefs(readme).length);
    for (const ref of refs) expect(ref).toBe(derived.consumerRef);
  });

  it("is idempotent, so repeated preparation changes nothing", () => {
    const once = identity.projectConsumerRefs(readme, "v5");
    expect(identity.projectConsumerRefs(once, "v5")).toBe(once);
  });

  it("still migrates the pre-maintained-major @main form", () => {
    const legacy = `uses: ${identity.REPOSITORY}@main`;
    expect(identity.projectConsumerRefs(legacy, "v7")).toBe(`uses: ${identity.REPOSITORY}@v7`);
  });
});

// --- publication is restart-safe --------------------------------------------
//
// The exact tag, the GitHub Release and the maintained major pointer are three
// separate side effects, created in that order. Every boundary between them is
// a state a rerun can land in, and a rerun must be able to finish the job from
// any of them. Treating "the exact tag exists" as "the release is complete"
// stranded the release at the first boundary: the rerun skipped acceptance and
// publication entirely, leaving an immutable tag with no Release and a stale
// pointer, recoverable only by hand.

const HEAD = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const RELEASING = "4.1.0";

describe("release state machine", () => {
  test.each([
    {
      boundary: "nothing published yet",
      observed: { exactTagSha: null, majorTagSha: null, majorTagVersion: null, releaseExists: false },
      expect: { createExact: true, createRelease: true, advanceMajor: true, workPending: true },
    },
    {
      boundary: "exact tag only, rerun must continue",
      observed: { exactTagSha: HEAD, majorTagSha: null, majorTagVersion: null, releaseExists: false },
      expect: { createExact: false, createRelease: true, advanceMajor: true, workPending: true },
    },
    {
      boundary: "exact tag and Release, pointer still stale",
      observed: { exactTagSha: HEAD, majorTagSha: OTHER, majorTagVersion: "4.0.0", releaseExists: true },
      expect: { createExact: false, createRelease: false, advanceMajor: true, workPending: true },
    },
    {
      boundary: "Release missing but pointer already moved",
      observed: { exactTagSha: HEAD, majorTagSha: HEAD, majorTagVersion: RELEASING, releaseExists: false },
      expect: { createExact: false, createRelease: true, advanceMajor: false, workPending: true },
    },
    {
      boundary: "fully published, rerun is a clean no-op",
      observed: { exactTagSha: HEAD, majorTagSha: HEAD, majorTagVersion: RELEASING, releaseExists: true },
      expect: { createExact: false, createRelease: false, advanceMajor: false, workPending: false },
    },
  ])("$boundary", ({ observed, expect: wanted }) => {
    const decision = releaseState.releaseDecision({
      headSha: HEAD,
      version: RELEASING,
      ...observed,
    });
    expect(decision.isReleaseCommit).toBe(true);
    expect(decision.createExact).toBe(wanted.createExact);
    expect(decision.createRelease).toBe(wanted.createRelease);
    expect(decision.advanceMajor).toBe(wanted.advanceMajor);
    expect(decision.workPending).toBe(wanted.workPending);
  });

  it("treats an exact tag at another commit as not a release", () => {
    const decision = releaseState.releaseDecision({
      headSha: HEAD,
      exactTagSha: OTHER,
      majorTagSha: OTHER,
      majorTagVersion: RELEASING,
      version: RELEASING,
      releaseExists: true,
    });
    expect(decision.isReleaseCommit).toBe(false);
    expect(decision.workPending).toBe(false);
    // Immutable provenance is never moved to make a rerun tidy.
    expect(decision.createExact).toBe(false);
  });

  it("refuses to move the maintained major tag backwards", () => {
    const decision = releaseState.releaseDecision({
      headSha: HEAD,
      exactTagSha: null,
      majorTagSha: OTHER,
      majorTagVersion: "5.0.0",
      version: RELEASING,
      releaseExists: false,
    });
    expect(decision.majorVerdict).toBe("regress");
    expect(decision.advanceMajor).toBe(false);
  });

  it("creates a new major line rather than leasing over the prior one", () => {
    const decision = releaseState.releaseDecision({
      headSha: HEAD,
      exactTagSha: null,
      majorTagSha: null,
      majorTagVersion: null,
      version: "5.0.0",
      releaseExists: false,
    });
    expect(decision.majorVerdict).toBe("create");
    expect(decision.advanceMajor).toBe(true);
  });

  it("holds a pointer that already names this release", () => {
    const decision = releaseState.releaseDecision({
      headSha: HEAD,
      exactTagSha: HEAD,
      majorTagSha: OTHER,
      majorTagVersion: RELEASING,
      version: RELEASING,
      releaseExists: true,
    });
    expect(decision.majorVerdict).toBe("hold");
    expect(decision.workPending).toBe(false);
  });
});

// --- the committed tree still agrees with its own version authority ---------

describe("committed release state", () => {
  it("derives the lockfile, plan and consumer ref from package.json", () => {
    const pkg = JSON.parse(read("package.json"));
    const lock = JSON.parse(read("package-lock.json"));
    const derived = identity.releaseIdentity(pkg.version);
    const plan = JSON.parse(read(derived.planPath));
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages[""].version).toBe(pkg.version);
    expect(lock.packages[""].license).toBe(pkg.license);
    expect(pkg.bin["l9-meta-injector"]).toBe("scripts/operation-cli.js");
    expect(pkg.files).toContain("scripts");
    expect(plan.release_version).toBe(pkg.version);
    expect(plan.tag).toBe(derived.exactTag);
    expect(plan.maintained_major_tag).toBe(derived.majorTag);
    expect(plan.consumer_ref).toBe(derived.consumerRef);
  });
});
