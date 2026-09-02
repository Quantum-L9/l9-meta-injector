#!/usr/bin/env node
"use strict";
// validation-report.js — run the gate, then write down what it did.
const cp = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { gitBinary } = require("./lib/git-binary");

const REPO = path.resolve(__dirname, "..");
const REPORT = path.join(REPO, "CURRENT_VALIDATION_REPORT.md");
const LABEL = "validation-report";
const REPORT_RELATIVE = "CURRENT_VALIDATION_REPORT.md";

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

function gitNul(args) {
  const result = cp.spawnSync(GIT_BINARY, args, { cwd: REPO, encoding: "utf8" });
  if (result.status !== 0) {
    fail(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.split("\0").filter((entry) => entry.length > 0);
}

/**
 * What the validation evidence is bound to.
 *
 * Paths come from NUL-delimited Git output, never Git's quoted display form, so
 * tabs, quotes and embedded newlines remain the real filesystem path. Identity
 * binds the actual bytes plus the executable bit Git can version. The report is
 * the sole exclusion so committing the report does not invalidate itself.
 */
function treeState() {
  const head = git(["rev-parse", "HEAD"]);
  const tracked = gitNul(["ls-files", "-z"]);
  const untracked = gitNul(["ls-files", "--others", "--exclude-standard", "-z"]);
  const paths = new Set([...tracked, ...untracked].filter((entry) => entry !== REPORT_RELATIVE));

  const statusRun = cp.spawnSync(
    GIT_BINARY,
    [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=all",
      "--",
      ".",
      `:(exclude)${REPORT_RELATIVE}`,
    ],
    { cwd: REPO, encoding: "utf8" },
  );
  if (statusRun.status !== 0) {
    fail(`git status --porcelain failed: ${(statusRun.stderr || statusRun.stdout || "").trim()}`);
  }

  const ordered = [...paths].sort();
  const digest = crypto.createHash("sha256");
  for (const relative of ordered) {
    const absolute = path.join(REPO, relative);
    let stats = null;
    try {
      stats = fs.lstatSync(absolute);
    } catch {
      // A tracked path deleted from disk is still part of the bound tree.
    }

    let descriptor;
    if (stats === null) {
      descriptor = "missing";
    } else if (stats.isSymbolicLink()) {
      descriptor = `link:${fs.readlinkSync(absolute)}`;
    } else if (stats.isDirectory()) {
      descriptor = "dir";
    } else if (stats.isFile()) {
      const bytes = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      const executable = (stats.mode & 0o111) !== 0 ? "x" : "-";
      descriptor = `file:${executable}:${bytes}`;
    } else {
      descriptor = `special:${stats.mode & 0o170000}`;
    }

    // NUL framing makes path/descriptor boundaries unambiguous even when the
    // path itself contains tabs or newlines. POSIX paths cannot contain NUL.
    digest.update(relative, "utf8");
    digest.update("\0");
    digest.update(descriptor, "utf8");
    digest.update("\0");
  }

  return {
    head,
    clean: statusRun.stdout.length === 0,
    digest: `sha256:${digest.digest("hex")}`,
  };
}

function run(command) {
  const started = Date.now();
  const result = cp.spawnSync(command.argv[0], command.argv.slice(1), {
    cwd: REPO,
    encoding: "utf8",
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

It is bound to the **tree digest**, not to the commit id: a NUL-framed digest over
every tracked and untracked path's actual bytes/type and executable bit, with
this report itself excluded. Committing the report therefore does not invalidate
it, and changing one byte, executable mode, or unusual Git path changes the
digest — including a second edit of a file that was already dirty.
\`npm run validate:report -- --check\` recomputes the digest and also requires the
non-report tree to be clean, so stale evidence cannot be carried over a dirty
checkout.

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
- It is not a statement about any other tree. Re-run it on the tree you mean to
  make a claim about.
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
    if (!state.clean) {
      fail(`${path.basename(REPORT)} cannot validate a dirty non-report tree`);
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
