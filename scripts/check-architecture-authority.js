#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const {
  REPO, readJson, isRegularFile, isDirectory,
  validateAuthorityDocument, validateAuthoritySchemaDocument,
  validateTraceabilityDocument, verifyLegacyArchive,
} = require("./lib/architecture-authority");
const { validatePackageContract } = require("./lib/dist-integrity");
const errors = [];
const required = (cond, msg) => { if (!cond) errors.push(msg); };
const authority = readJson(path.join(REPO, "docs/architecture-authority.json"));
const authoritySchema = readJson(path.join(REPO, "docs/schemas/architecture-authority.schema.json"));
const traceability = readJson(path.join(REPO, "docs/traceability-map.json"));
const pkg = readJson(path.join(REPO, "package.json"));
const packageContract = readJson(path.join(REPO, "docs/package-contract.json"));

errors.push(...validateAuthorityDocument(authority));
errors.push(...validateAuthoritySchemaDocument(authoritySchema));
errors.push(...validateTraceabilityDocument(traceability));
errors.push(...verifyLegacyArchive(REPO));
errors.push(...validatePackageContract(packageContract));

required(authority.engine.package_entrypoint === pkg.main, "package entrypoint disagrees with package.json");
required(authority.engine.types_entrypoint === pkg.types, "types entrypoint disagrees with package.json");
required(authority.distribution.package_contract === "docs/package-contract.json", "authority package-contract reference is invalid");
required(packageContract.package_name === pkg.name, "package contract name disagrees with package.json");
required(packageContract.entrypoints.runtime === pkg.main, "package contract runtime entrypoint disagrees with package.json");
required(packageContract.entrypoints.types === pkg.types, "package contract type entrypoint disagrees with package.json");
for (const rel of Object.values(authority.contracts)) required(isRegularFile(REPO, rel), `missing or unsafe authority contract: ${rel}`);
for (const rel of [authority.legacy.documentation, authority.legacy.runtime, authority.legacy.schemas]) required(isDirectory(REPO, rel), `missing or unsafe legacy boundary: ${rel}`);

const [runtimeFile, runtimeSymbol] = authority.engine.runtime_entrypoint.split("#", 2);
required(isRegularFile(REPO, runtimeFile), `runtime entrypoint file missing: ${runtimeFile}`);
if (isRegularFile(REPO, runtimeFile) && runtimeSymbol) {
  const text = fs.readFileSync(path.join(REPO, runtimeFile), "utf8");
  required(new RegExp(`export\\s+(?:async\\s+)?function\\s+${runtimeSymbol}\\b`).test(text), `runtime symbol is not exported: ${authority.engine.runtime_entrypoint}`);
}

[
  "schemas/l9_meta.schema.yaml",
  "schemas/l9_artifact_meta.schema.yaml",
  "schemas/move_map.schema.yaml",
].forEach((p) => required(!fs.existsSync(path.join(REPO, p)), `legacy schema remains in public schema directory: ${p}`));
required(!fs.existsSync(path.join(REPO, "docs/traceability_map.yaml")), "legacy traceability map remains active");
required(!fs.existsSync(path.join(REPO, "docs/artifact_manifest.yaml")), "legacy artifact manifest remains active");

const activeDocs = ["docs/contracts.md", "docs/decision_log.md", "docs/manifest.md", "docs/public-api.md", "docs/traceability-map.json"];
const forbidden = [/consolidate_request/i, /move_map\.csv/i, /L9_ARTIFACT_META/, /folder_artifact_consolidation/];
for (const rel of activeDocs) {
  const text = fs.readFileSync(path.join(REPO, rel), "utf8");
  for (const re of forbidden) required(!re.test(text), `legacy contract term ${re} found in active document ${rel}`);
}
const decisions = fs.readFileSync(path.join(REPO, "docs/decision_log.md"), "utf8");
required(!/^\|\s*[1-9]\s*\|/m.test(decisions), "historical decisions 1-9 remain in the active log");
for (const n of [10, 11, 12, 13]) required(new RegExp(`^\\|\\s*${n}\\s*\\|`, "m").test(decisions), `active decision ${n} missing`);

required(pkg.scripts?.["check:authority"] === "node scripts/check-architecture-authority.js", "package script check:authority missing or changed");
required(pkg.scripts?.["check:manifest"] === "node scripts/generate-architecture-manifest.js --check", "package script check:manifest missing or changed");
required(pkg.scripts?.["check:dist"] === "node scripts/check-dist-sync.js", "package script check:dist missing or changed");
required(pkg.scripts?.["test:packed"] === "node scripts/test-packed-consumer.js", "package script test:packed missing or changed");
required(pkg.scripts?.validate === "npm run typecheck && npm test && npm run check:authority && npm run check:manifest && npm run check:dist && npm run selfpack && npm run test:packed", "canonical validate script missing or changed");
required(pkg.scripts?.prepack === "npm run check:authority && npm run check:manifest && npm run check:dist", "prepack gate missing or changed");
required(pkg.scripts?.prepublishOnly === "npm run validate", "prepublishOnly gate missing or changed");
required(Array.isArray(pkg.files), "package files allowlist missing");
if (Array.isArray(pkg.files)) {
  required(!pkg.files.some((p) => p === "tools" || p.startsWith("tools/") || p === "docs" || p.startsWith("docs/legacy")), "package files allowlist exposes legacy implementation material");
}

const workflow = fs.readFileSync(path.join(REPO, ".github/workflows/ci.yml"), "utf8");
required(/actions\/checkout@[a-f0-9]{40}/.test(workflow), "PR #9 checkout SHA pin was not preserved");
required(/actions\/setup-node@[a-f0-9]{40}/.test(workflow), "PR #9 setup-node SHA pin was not preserved");
required(/persist-credentials:\s*false/.test(workflow), "PR #9 credential hardening was not preserved");
required(/permissions:\s*\n\s+contents:\s*read/.test(workflow), "PR #9 read-only contents permission was not preserved");
required(/timeout-minutes:\s*15/.test(workflow), "PR #9 timeout was not preserved");
required(/npm run validate/.test(workflow), "canonical validation gate is not wired into CI");
required(/git status --porcelain --untracked-files=all/.test(workflow), "CI does not assert a clean checkout after validation");

for (const capability of traceability.capabilities) {
  const sourceRefs = capability.source.split(/\s+and\s+/).map((x) => x.split("#", 1)[0]);
  for (const ref of sourceRefs) required(isRegularFile(REPO, ref) || isDirectory(REPO, ref), `traceability source missing: ${capability.capability} -> ${ref}`);
  for (const test of capability.tests) required(isRegularFile(REPO, test), `traceability test missing: ${capability.capability} -> ${test}`);
}

if (errors.length) {
  console.error(`architecture-authority: FAILED (${errors.length})`);
  [...new Set(errors)].forEach((e) => console.error(`  - ${e}`));
  process.exit(1);
}
console.log("architecture-authority: OK");
