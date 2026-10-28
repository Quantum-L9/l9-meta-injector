#!/usr/bin/env node
"use strict";
// check-publication-readiness.js — the fail-closed npm publication gate
// (ADR-015, refined by ADR-070; INV-011, INV-012).
//
// APPROVED only when every rule below holds; each failure is reported, and a
// malformed decision blocks with a message rather than crashing:
//
// - the decision uses schema l9.package-publication-decision/v2 and names this
//   package and package.json#version;
// - status is "approved";
// - the required evidence ids are each present exactly once, no id is unknown
//   or duplicated, and every item is a well-formed, resolved object;
// - distribution_owner_approval is "verified" (an owner approval is never waived);
// - approved_version equals package.json#version. Release preparation restamps
//   package_version but never writes approved_version, so an approval cannot
//   survive a version change.
//
// The required set lives here, not in the decision document, so editing the
// document cannot drop a requirement.
const fs = require("node:fs");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const SCHEMA = "l9.package-publication-decision/v2";
const REQUIRED_EVIDENCE_IDS = Object.freeze([
  "npm_registry_history",
  "constellation_consumer_inventory",
  "distribution_owner_approval",
]);
const OPTIONAL_EVIDENCE_IDS = Object.freeze([
  "github_release_validation",
  "l9_deploy_migration_validation",
]);
const NON_WAIVABLE_EVIDENCE_IDS = Object.freeze(["distribution_owner_approval"]);
const RESOLVED_STATUSES = Object.freeze(["verified", "not_applicable_with_reason"]);

function evidenceErrors(evidence) {
  const errors = [];
  if (!Array.isArray(evidence) || evidence.length === 0) return ["evidence list is empty"];
  const known = new Set([...REQUIRED_EVIDENCE_IDS, ...OPTIONAL_EVIDENCE_IDS]);
  const seen = new Map();
  for (const [i, item] of evidence.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`evidence[${i}] is not an object`);
      continue;
    }
    if (typeof item.id !== "string" || item.id === "") {
      errors.push(`evidence[${i}].id is missing`);
      continue;
    }
    if (!known.has(item.id)) errors.push(`unknown evidence id '${item.id}' at evidence[${i}]`);
    seen.set(item.id, (seen.get(item.id) ?? 0) + 1);
    if (!RESOLVED_STATUSES.includes(item.status)) errors.push(`evidence '${item.id}' is unresolved (status ${JSON.stringify(item.status)})`);
    if (typeof item.result !== "string" || item.result.trim() === "") errors.push(`evidence '${item.id}'.result is missing`);
    if (NON_WAIVABLE_EVIDENCE_IDS.includes(item.id) && item.status !== "verified") {
      errors.push(`${item.id} must be verified; it cannot be waived (status ${JSON.stringify(item.status)})`);
    }
  }
  for (const [id, count] of seen) {
    if (count > 1) errors.push(`evidence id '${id}' appears more than once`);
  }
  for (const id of REQUIRED_EVIDENCE_IDS) {
    if (!seen.has(id)) errors.push(`required evidence '${id}' is missing`);
  }
  return errors;
}

function decisionErrors(doc, pkg) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return ["publication decision is not an object"];
  const errors = [];
  if (doc.schema !== SCHEMA) errors.push(`invalid schema ${JSON.stringify(doc.schema)}; expected ${SCHEMA}`);
  if (doc.package_name !== pkg.name || doc.package_version !== pkg.version) errors.push("package identity mismatch");
  if (doc.status !== "approved") errors.push(`publication status is ${doc.status}; resolve every required evidence item before publishing`);
  errors.push(...evidenceErrors(doc.evidence));
  if (doc.approved_version !== pkg.version) {
    errors.push(`approved_version is ${JSON.stringify(doc.approved_version ?? null)}; an approval must name package.json#version ${pkg.version}`);
  }
  return errors;
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  const file = path.join(REPO, "docs/package-publication-decision.json");
  let errors;
  try {
    errors = decisionErrors(JSON.parse(fs.readFileSync(file, "utf8")), pkg);
  } catch (error) {
    errors = [`publication decision cannot be read: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (errors.length) {
    console.error("publication-readiness: BLOCKED");
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log("publication-readiness: APPROVED");
}

main();
