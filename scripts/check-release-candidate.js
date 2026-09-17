#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(REPO, "package-lock.json"), "utf8"));
const dispatch = fs.readFileSync(path.join(REPO, "scripts/lib/operation-dispatch.js"), "utf8");
const errors = [];
const semver = /^(\d+)\.(\d+)\.(\d+)$/;
const match = semver.exec(pkg.version);

if (!match) {
  errors.push(`package version is not plain SemVer: ${pkg.version}`);
}

const exactTag = match ? `v${pkg.version}` : null;
const majorTag = match ? `v${match[1]}` : null;
const planPath = exactTag
  ? path.join(REPO, "docs", "release", `${exactTag}-release-plan.json`)
  : null;
let plan = null;

if (planPath && fs.existsSync(planPath)) {
  plan = JSON.parse(fs.readFileSync(planPath, "utf8"));
} else if (planPath) {
  errors.push(`release plan is missing: docs/release/${exactTag}-release-plan.json`);
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

  if (plan.schema === "l9.meta-injector-release-plan/v2") {
    if (plan.maintained_major_tag !== majorTag) errors.push("maintained major tag mismatch");
    if (plan.consumer_ref !== `Quantum-L9/l9-meta-injector@${majorTag}`) {
      errors.push("consumer ref mismatch");
    }
  } else if (plan.github_release?.status !== "released") {
    errors.push("new release candidates must use l9.meta-injector-release-plan/v2");
  }
}

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
