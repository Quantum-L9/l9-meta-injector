#!/usr/bin/env node
"use strict";
// validation-report.js — run the gate, then write down what it did.
//
//   node scripts/validation-report.js            # run and write CURRENT_VALIDATION_REPORT.md
//   node scripts/validation-report.js --check    # verify the committed report is not stale
//
// The repository already had a `VALIDATION_REPORT.md`. It was dated, hand-written
// and unbound: nothing tied it to a commit, so it went on describing a green gate
// through every subsequent change, and a reader had no way to tell whether the
// tree it described was the tree in front of them. A report like that is worse
// than none — it answers the question "is this green" with a yes that was true
// once.
//
// So this script does not accept a claim. It runs each command, records the exit
// code it actually got, and binds the report to a digest of the tree it ran over.
// `--check` recomputes the digest and fails when it has moved, which is what
// makes stale reuse a build failure rather than a matter of remembering.
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gitBinary } = require("./lib/git-binary");

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(REPO, "CURRENT_VALIDATION_REPORT.md");
const LABEL = "validation-report";

/**
 * The commands the report covers, in the order a contributor runs them.
 *
 * `npm run validate` is the aggregate gate and subsumes typecheck, tests, the
 * API and authority checks, the manifest check, dist parity, selfpack and the
 * packed-consumer proof. It is listed once rather than expanded into the eleven
 * things it runs: a table that claimed eleven independent passes from one
 * invocation would be inflating its own evidence.
 */
const COMMANDS = [
  { id: "lint", argv: ["npm", "run", "lint"], note: "ESLint over src and tests" },
  { id: "validate", argv: ["npm", "run", "validate"], note: "the aggregate gate" },
];

function fail(message) {
  console.error(`${LABEL}: FAILED: ${message}`);
  process.exit(1);
}

const GIT_BINARY = gitBinary(fail);

function git(args) {
  const result = cp.spawnSync(GIT_BINARY, args, { cwd: REPO, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.trim();
}

/** The report names itself, and must not be part of what it is bound to. */
const REPORT_RELATIVE = "CURRENT_VALIDATION_REPORT.md";

/**
 * What the tree the gate ran over actually was.
 *
 * Bound to the *content* rather than to a commit id, and deliberately so. A
 * report bound to HEAD is invalidated by the commit that carries it: generate,
 * commit, and the report now names its own parent. The obvious workarounds are
 * worse — a report generated after the commit is never committed, and one that
 * excuses a single mismatch excuses the case it exists to catch.
 *
 * The binding is a digest over the actual bytes of every tracked and untracked
 * file, with this report itself excluded. A previous version bound the digest
 * to `git ls-files -s` index blobs plus the porcelain status class, which has
 * one hole the byte binding closes: a second edit of an already-dirty file
 * rewrites no index blob and changes no status class, so the old digest could
 * not see it. Hashing the bytes on disk means every edit moves the digest,
 * dirty or not. Non-file entries are recorded by kind, a vanished path as
 * `missing` — never silently dropped.
 *
 * Working-tree status decides the `clean` flag only; it never participates in
 * the digest, because staging or committing a file changes its status class
 * without changing a byte, and a binding that moved when the report's own
 * commit landed would be one nobody could satisfy.
 *
 * HEAD is recorded beside it because a reader wants to know which commit the run
 * happened at. It is not what the check compares, and the report says so.
 */
function treeState() {
  const head = git(["rev-parse", "HEAD"]);
  const trackedPaths = git(["ls-files"])
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && line !== REPORT_RELATIVE);

  // Porcelain is read without the shared `git()` helper, which trims output and
  // would eat the leading space of the first record's status column. The status
  // codes themselves only decide `clean`; the paths feed the content pass.
  const statusRun = cp.spawnSync(GIT_BINARY, ["status", "--porcelain", "--untracked-files=all"], {
    cwd: REPO,
    encoding: "utf8",
  });
  if (statusRun.status !== 0) {
    fail(`git status --porcelain failed: ${(statusRun.stderr || statusRun.stdout || "").trim()}`);
  }
  const porcelain = statusRun.stdout
    .split(/\r?\n/)
    .map((line) => {
      if (line.length === 0) return null;
      const body = line.slice(3);
      // `R  old -> new` names two paths; the destination is the one that matters.
      const arrow = body.indexOf(" -> ");
      return { path: arrow < 0 ? body : body.slice(arrow + 4) };
    })
    .filter((entry) => entry !== null && entry.path !== REPORT_RELATIVE);

  // One union of paths, one content pass. The porcelain plane contributes the
  // untracked and modified paths; its status codes decide `clean` and nothing
  // else.
  const paths = new Set(trackedPaths);
  for (const entry of porcelain) paths.add(entry.path);

  const lines = [];
  for (const relative of paths) {
    const absolute = path.join(REPO, relative);
    let stats = null;
    try {
      stats = fs.lstatSync(absolute);
    } catch {
      // Recorded as missing below; a deleted path must move the digest.
    }
    let descriptor;
    if (stats === null) descriptor = "missing";
    else if (stats.isSymbolicLink()) descriptor = `link:${fs.readlinkSync(absolute)}`;
    else if (stats.isDirectory()) descriptor = "dir";
    else if (stats.isFile()) {
      descriptor = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
    } else descriptor = "special";
    lines.push(`${relative}\t${descriptor}`);
  }
  lines.sort();
  const digest = crypto.createHash("sha256").update(`${lines.join("\n")}\n`).digest("hex");
  return { head, clean: porcelain.length === 0, digest: `sha256:${digest}` };
}

/** Run one command and report what happened, whatever that was. */
function run(command) {
  const started = Date.now();
  const result = cp.spawnSync(command.argv[0], command.argv.slice(1), {
    cwd: REPO,
    encoding: "utf8",
    // Tells `tests/validation_report.test.ts` that this is the run producing the
    // report, so it does not fail on the absence of the file about to be
    // written. Set here and nowhere else; every other invocation is strict.
    env: { ...process.env, CI: "true", L9_VALIDATION_REPORT_RUN: "1" },
  });
  const status = result.status === null ? -1 : result.status;
  return {
    id: command.id,
    command: command.argv.join(" "),
    note: command.note,
    exit_code: status,
    passed: status === 0,
    duration_ms: Date.now() - started,
    // Kept for the failure path only. A passing command's output is noise; a
    // failing one's last lines are the whole reason to read the report.
    tail: status === 0
      ? ""
      : `${result.stdout || ""}${result.stderr || ""}`.trim().split(/\r?\n/).slice(-25).join("\n"),
  };
}

function renderReport(state, results, generatedAt) {
  const verdict = results.every((entry) => entry.passed) ? "green" : "RED";
  const rows = results
    .map((entry) => `| \`${entry.command}\` | ${entry.exit_code} | ${entry.passed ? "pass" : "**FAIL**"} | ${entry.note} |`)
    .join("\n");
  const failures = results.filter((entry) => !entry.passed);
  const failureSection = failures.length === 0
    ? ""
    : `\n## Failures\n\n${failures
      .map((entry) => `### \`${entry.command}\` — exit ${entry.exit_code}\n\n\`\`\`\n${entry.tail}\n\`\`\`\n`)
      .join("\n")}`;

  return `# Current validation report

**Generated at commit:** \`${state.head}\`
**Working tree:** ${state.clean ? "clean apart from this report" : "**dirty** — this report describes uncommitted changes"}
**Bound to tree:** \`${state.digest}\`
**Generated:** ${generatedAt}

This report is written by \`scripts/validation-report.js\`, which runs each
command below and records the exit code it received rather than a claim about it.

It is bound to the **tree digest**, not to the commit id: a digest over the
actual bytes of every tracked and untracked file, with this report itself
excluded. Committing the report therefore does not invalidate it, and changing
one byte of anything else does — including a second edit of a file that was
already dirty.
\`npm run validate:report -- --check\` recomputes the digest and fails when it has
moved, so a report written against an earlier tree cannot be presented as
evidence for this one. The commit above is recorded because a reader wants to
know where the run happened; it is not what the check compares.

## Commands

| Command | Exit | Result | Covers |
|---|---:|---|---|
${rows}
${failureSection}
## Verdict

**${verdict}**

${verdict === "green"
    ? "Every command above exited zero on the tree named at the top of this file."
    : "At least one command failed. The tail of its output is above; this tree is not green."}

## What this report does not say

- It is not a publication authorization. \`npm run check:publication\` is a
  separate gate and remains fail-closed on its own evidence.
- It is not a statement about any other commit. Re-run it on the tree you mean
  to make a claim about.
- \`[l9-meta-injector] verification FAILED for 1/1 file(s)\` lines inside the
  Vitest output are fail-closed negative-path fixtures asserting their own
  refusal, not failures; the exit codes in the table are the authority.
`;
}

function main() {
  const check = process.argv.includes("--check");
  const state = treeState();

  if (check) {
    if (!fs.existsSync(REPORT)) {
      fail(`${path.basename(REPORT)} is missing; run \`npm run validate:report\``);
    }
    const contents = fs.readFileSync(REPORT, "utf8");
    const head = /\*\*Generated at commit:\*\* `([0-9a-f]{40})`/.exec(contents);
    const digest = /\*\*Bound to tree:\*\* `(sha256:[0-9a-f]{64})`/.exec(contents);
    if (head === null || digest === null) {
      fail(`${path.basename(REPORT)} does not name a commit and a tree digest`);
    }
    if (digest[1] !== state.digest) {
      fail(
        `${path.basename(REPORT)} was written against a different tree `
        + `(it names ${digest[1].slice(7, 19)}, this tree is ${state.digest.slice(7, 19)}). `
        + "It describes a tree that is not this one; re-run `npm run validate:report`.",
      );
    }
    if (!/\*\*green\*\*/.test(contents)) {
      fail(`${path.basename(REPORT)} does not record a green verdict`);
    }
    console.log(`${LABEL}: OK (bound to ${state.head.slice(0, 12)}, tree unchanged)`);
    return;
  }

  const results = COMMANDS.map((command) => {
    process.stderr.write(`${LABEL}: running ${command.argv.join(" ")}\n`);
    return run(command);
  });

  // Re-read the tree after the run. `npm run validate` regenerates nothing on a
  // clean tree, and if it did the report must be bound to the tree that came out
  // of it rather than the one that went in.
  const after = treeState();
  const generatedAt = new Date().toISOString();
  fs.writeFileSync(REPORT, renderReport(after, results, generatedAt), "utf8");

  const failed = results.filter((entry) => !entry.passed);
  if (failed.length > 0) {
    console.error(
      `${LABEL}: RED — ${failed.map((entry) => entry.command).join(", ")} failed; `
      + `report written to ${path.relative(REPO, REPORT)}`,
    );
    process.exit(1);
  }
  console.log(
    `${LABEL}: OK (green at ${after.head.slice(0, 12)}${after.clean ? "" : ", dirty tree"}; `
    + `wrote ${path.relative(REPO, REPORT)})`,
  );
}

if (require.main === module) main();

module.exports = { renderReport, treeState };
