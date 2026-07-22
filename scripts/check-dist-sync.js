#!/usr/bin/env node
"use strict";
const path = require("path");
const { checkDistSync, stableJson } = require("./lib/dist-integrity");
const repo = path.resolve(__dirname, "..");
let report;
try { report = checkDistSync(repo); }
catch (error) {
  report = { schema: "l9.dist-integrity-report/v1", status: "failed", reason: error && error.message ? error.message : String(error) };
}
if (process.argv.includes("--json")) process.stdout.write(stableJson(report));
if (report.status !== "passed") {
  if (!process.argv.includes("--json")) {
    console.error(`dist-integrity: FAILED: ${report.reason}`);
    for (const line of report.preexistingDistStatus || []) console.error(`  dirty: ${line}`);
    const c = report.comparison || {};
    for (const rel of c.missingFromCommitted || []) console.error(`  missing-from-committed: ${rel}`);
    for (const rel of c.staleInCommitted || []) console.error(`  stale-in-committed: ${rel}`);
    for (const item of c.changed || []) console.error(`  changed: ${item.path}`);
    if (report.build && report.build.exitCode !== 0) {
      if (report.build.stdout) process.stderr.write(report.build.stdout);
      if (report.build.stderr) process.stderr.write(report.build.stderr);
    }
  }
  process.exit(1);
}
if (!process.argv.includes("--json")) {
  console.log(`dist-integrity: OK (${report.comparison.committedFiles} files, isolated build byte-identical)`);
}
