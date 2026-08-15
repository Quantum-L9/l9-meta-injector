#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const REPO = path.resolve(__dirname, "..");
function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const file = path.join(REPO, "docs/package-publication-decision.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = [];
  if (doc.schema !== "l9.package-publication-decision/v1") errors.push("invalid schema");
  if (doc.package_name !== pkg.name || doc.package_version !== pkg.version) errors.push("package identity mismatch");
  if (doc.status !== "approved") errors.push(`publication status is ${doc.status}; resolve every required evidence item before publishing`);
  if (!Array.isArray(doc.evidence) || doc.evidence.length === 0) errors.push("evidence list is empty");
  else for (const [i, item] of doc.evidence.entries()) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !["verified", "not_applicable_with_reason"].includes(item.status)) errors.push(`evidence[${i}] is unresolved`);
    if (typeof item.result !== "string" || item.result.trim() === "") errors.push(`evidence[${i}].result is missing`);
  }
  if (errors.length) {
    console.error("publication-readiness: BLOCKED");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log("publication-readiness: APPROVED");
}
main();
