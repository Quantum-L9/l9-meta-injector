#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const identity = require("./lib/release-identity.js");

const REPO = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8"));
const dispatch = fs.readFileSync(path.join(REPO, "scripts/lib/operation-dispatch.js"), "utf8");
const errors = [];
const derived = identity.parseVersion(pkg.version) ? identity.releaseIdentity(pkg.version) : null;

if (!derived) {
  errors.push(`package version is not plain SemVer: ${pkg.version}`);
}

const exactTag = derived ? derived.exactTag : null;
const majorTag = derived ? derived.majorTag : null;
const planPath = derived ? path.join(REPO, derived.planPath) : null;
let plan = null;

if (planPath && fs.existsSync(planPath)) {
  plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
} else if (planPath) {
  errors.push(`release plan is missing: docs/release/${exactTag}-release-plan.json`);
}

const publication = JSON.parse(
  fs.readFileSync(path.join(REPO, "docs/package-publication-decision.json"), "utf8"),
);
if (publication.package_version !== pkg.version) {
  errors.push("publication decision version mismatch");
}
if (lock.version !== pkg.version || lock.packages?.[""]?.version !== pkg.version) {
  errors.push("package-lock version mismatch");
}
if (lock.packages?.[""]?.license !== pkg.license) errors.push("package-lock license mismatch");
if (pkg.bin?.["l9-meta-injector"] !== "scripts/operation-cli.js") errors.push("package executable is missing");
if (!Array.isArray(pkg.files) || !pkg.files.includes("scripts")) errors.push("runtime scripts are not packed");

if (plan) {
  if (plan.release_version !== pkg.version || plan.tag !== exactTag) {
    errors.push("release plan identity mismatch");
  }

  if (plan.schema === identity.PLAN_SCHEMA) {
    if (plan.maintained_major_tag !== majorTag) errors.push("maintained major tag mismatch");
    if (plan.consumer_ref !== derived.consumerRef) errors.push("consumer ref mismatch");

    // A plan states what was prepared. It cannot state what was released,
    // because nothing writes back to it after publication — so a plan claiming
    // released state, or carrying a commit placeholder that nothing resolves,
    // is contradictory evidence rather than weak evidence.
    if (plan.record_kind !== "preparation") {
      errors.push(`release plan record_kind must be "preparation"`);
    }
    if (Object.hasOwn(plan, "release_commit")) {
      errors.push("release plan must not record a release commit; the exact tag and its GitHub Release are the released evidence");
    }
    if (plan.github_release?.status !== "candidate") {
      errors.push(`release plan github_release.status must be "candidate"`);
    }
  } else if (plan.github_release?.status !== "released") {
    errors.push(`new release candidates must use ${identity.PLAN_SCHEMA}`);
  }
}

// --- one current package identity -------------------------------------------
//
// ADR-050 makes package.json#version the sole persisted authority, so every
// other current-facing statement of the package version has to be derived from
// it or absent. Proving that once by hand is what let AGENTS.md sit two majors
// behind and the package contract a full release behind; this asserts it on
// every run instead.
const JSON_AUTHORITIES = [
  ["docs/package-contract.json", (doc) => doc.package_version],
  ["docs/public-api-contract.json", (doc) => doc.package_version],
  ["docs/package-publication-decision.json", (doc) => doc.package_version],
];
for (const [relative, pick] of JSON_AUTHORITIES) {
  const found = pick(JSON.parse(fs.readFileSync(path.join(REPO, relative), "utf8")));
  if (found !== pkg.version) {
    errors.push(`${relative} states version ${found}, not ${pkg.version}`);
  }
}

// A regex that stops matching is itself a failure: a reworded document must not
// drop silently out of enforcement.
const TEXT_AUTHORITIES = [
  ["docs/architecture.md", /^\*\*Package version:\*\* (\d+\.\d+\.\d+)$/m],
];
for (const [relative, pattern] of TEXT_AUTHORITIES) {
  const found = pattern.exec(fs.readFileSync(path.join(REPO, relative), "utf8"));
  if (!found) errors.push(`${relative} no longer states a package version where one is enforced`);
  else if (found[1] !== pkg.version) {
    errors.push(`${relative} states version ${found[1]}, not ${pkg.version}`);
  }
}

// README carries the canonical consumer examples, which are the public face of
// the maintained major line. They were projected by a one-time migration and
// validated by nothing, so a future major would have advertised the previous
// line indefinitely.
const readmeRefs = identity.findConsumerRefs(fs.readFileSync(path.join(REPO, "README.md"), "utf8"));
if (readmeRefs.length === 0) {
  errors.push("README.md states no consumer reference where one is enforced");
} else if (derived) {
  for (const ref of new Set(readmeRefs)) {
    if (ref !== derived.consumerRef) {
      errors.push(`README.md points consumers at ${ref}, not ${derived.consumerRef}`);
    }
  }
}

// The agent guide states repository identity and must not pin a version at all,
// since nothing derives it there.
const agents = fs.readFileSync(path.join(REPO, "AGENTS.md"), "utf8");
const pinned = /l9-meta-injector@(\d+\.\d+\.\d+)/.exec(agents);
if (pinned) errors.push(`AGENTS.md pins package version ${pinned[1]}; identity belongs to package.json`);

if (!dispatch.includes('actionPath: path.resolve(__dirname, "..", ".."),')) {
  errors.push("packed CLI action root is incorrect");
}
if (!dispatch.includes("uploadArtifact: false,")) {
  errors.push("CLI upload-artifact default is not contained");
}

if (errors.length) {
  console.error("release-candidate: BLOCKED");
  for (const error of errors) console.error(`  - ${error}`);
  process.exit(1);
}

console.log(`release-candidate: PASS ${exactTag} -> ${majorTag}`);
