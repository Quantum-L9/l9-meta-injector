#!/usr/bin/env node
"use strict";
// release-identity-cli.js — shell entry point for scripts/lib/release-identity.js.
//
// Workflows need the derived release identifiers in bash. Inlining `node -e`
// into YAML would put a fifth copy of the derivation in the repository, which
// is the duplication ADR-050 and the release contract test forbid, and it
// cannot be unit-tested. This wrapper keeps the rule in one module and gives
// the workflow a command.
const fs = require("node:fs");
const path = require("node:path");
const identity = require("./lib/release-identity.js");

const REPO = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`release-identity: ${message}`);
  process.exit(1);
}

function readPackageVersion() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  return pkg.version;
}

function flag(argv, name) {
  const at = argv.indexOf(name);
  return at === -1 ? null : argv[at + 1];
}

function emit(argv) {
  const explicit = flag(argv, "--version");
  const version = explicit === null ? readPackageVersion() : explicit;
  let derived;
  try {
    derived = identity.releaseIdentity(version);
  } catch (error) {
    return fail(error.message);
  }

  if (argv.includes("--require-plan") && !fs.existsSync(path.join(REPO, derived.planPath))) {
    return fail(`release plan is missing: ${derived.planPath}`);
  }

  const fields = {
    version: derived.version,
    major: String(derived.major),
    exact_tag: derived.exactTag,
    major_tag: derived.majorTag,
    consumer_ref: derived.consumerRef,
    plan_path: derived.planPath,
    release_branch: derived.releaseBranch,
  };

  const one = flag(argv, "--field");
  if (one !== null) {
    if (!Object.hasOwn(fields, one)) return fail(`unknown field: ${one}`);
    process.stdout.write(`${fields[one]}\n`);
    return;
  }

  const lines = Object.entries(fields).map(([key, value]) => `${key}=${value}`);
  const target = process.env.GITHUB_OUTPUT;
  if (target) fs.appendFileSync(target, `${lines.join("\n")}\n`);
  else process.stdout.write(`${lines.join("\n")}\n`);
}

// Prints advance | equal | regress and exits 0. The caller decides what each
// verdict means, because "equal" is a clean skip for a non-bump push while
// "regress" is a fail-closed condition.
function compare(argv) {
  const prev = flag(argv, "--prev");
  const next = flag(argv, "--next");
  let order;
  try {
    order = identity.compareVersions(prev, next);
  } catch (error) {
    return fail(error.message);
  }
  process.stdout.write(`${order === -1 ? "advance" : order === 0 ? "equal" : "regress"}\n`);
}

// Asserts a release branch agrees with the version authority, or exits 1.
function assertBranch(argv) {
  const ref = flag(argv, "--branch");
  if (ref === null) return fail("assert-branch requires --branch <ref>");
  try {
    identity.assertBranchMatchesVersion(ref, readPackageVersion());
  } catch (error) {
    return fail(error.message);
  }
}

const [command, ...argv] = process.argv.slice(2);
if (command === "emit") emit(argv);
else if (command === "compare") compare(argv);
else if (command === "assert-branch") assertBranch(argv);
else fail("usage: release-identity-cli.js emit|compare|assert-branch [...]");
