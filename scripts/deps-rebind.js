#!/usr/bin/env node
// deps-rebind.js — land a dependency update as one validated commit pair.
//
// CURRENT_VALIDATION_REPORT.md is bound to a digest of every tracked and untracked
// file except itself, so any change to package-lock.json invalidates it and the
// report test fails. A bot cannot regenerate the report: that means running the
// whole gate and committing the result. This script is the maintainer's one
// command for a Dependabot group or any other lockfile change (ADR-056):
//
//   1. npm ci                 — install exactly what the lockfile says
//   2. npm run build          — dist/ follows src/ (committed output)
//   3. npm run manifest:update — architecture manifest follows the tree
//   4. npm run validate:report — lint + validate, then rebind the report
//
// It stops at the first failure and never commits; the maintainer reviews the
// diff and commits the code change and the rebound report as two commits.
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const LABEL = "deps-rebind";
const STEPS = [
  ["npm", ["ci", "--ignore-scripts"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "manifest:update"]],
  ["npm", ["run", "validate:report"]],
];

for (const [command, args] of STEPS) {
  process.stdout.write(`${LABEL}: running ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { cwd: REPO, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.stderr.write(`${LABEL}: FAILED at '${command} ${args.join(" ")}' (exit ${result.status ?? "signal"})\n`);
    process.exit(result.status ?? 1);
  }
}
process.stdout.write(`${LABEL}: OK — review 'git status', then commit the dependency change and CURRENT_VALIDATION_REPORT.md\n`);
