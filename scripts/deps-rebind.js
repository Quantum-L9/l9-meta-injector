#!/usr/bin/env node
// deps-rebind.js — verify a dependency update locally before it is pushed.
//
// ADR-056 introduced this as the maintainer's one command for rebinding the
// committed validation report after a lockfile change. ADR-093 retired the
// committed report and the committed architecture manifest, so a dependency
// update no longer has anything to rebind: CI runs the full gate on the head of
// every pull request, Dependabot's included. The command remains the local
// equivalent of that gate for a lockfile change:
//
//   1. npm ci            — install exactly what the lockfile says
//   2. npm run build     — dist/ follows src/ (committed output; a TypeScript
//                          bump can change emitted bytes)
//   3. npm run lint      — ESLint, the separate required gate
//   4. npm run validate  — the aggregate gate
//
// It stops at the first failure and never commits.
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const LABEL = "deps-rebind";
const STEPS = [
  ["npm", ["ci", "--ignore-scripts"]],
  ["npm", ["run", "build"]],
  ["npm", ["run", "lint"]],
  ["npm", ["run", "validate"]],
];

for (const [command, args] of STEPS) {
  process.stdout.write(`${LABEL}: running ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, { cwd: REPO, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    process.stderr.write(`${LABEL}: FAILED at '${command} ${args.join(" ")}' (exit ${result.status ?? "signal"})\n`);
    process.exit(result.status ?? 1);
  }
}
process.stdout.write(`${LABEL}: OK — review 'git status'; commit any dist/ change with the dependency update\n`);
