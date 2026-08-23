"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const REPO = path.resolve(__dirname, "../..");
const EXPECTED_PERSISTED_OUTPUTS = [
  "archives-expanded.json",
  "coverage-report.json",
  "dedup-report.json",
  "dedup-report.md",
  "meta-v3-index.json",
  "placement-plan.json",
  "primitive-library-index.json",
  "prompt-library-index.json",
  "verification-report.json",
].sort((a, b) => a.localeCompare(b));

const AUTHORITY_CRITICAL_PATHS = [
  ".github/workflows/ci.yml",
  "README.md",
  "CHANGELOG.md",
  "package.json",
  "Makefile",
  "package-lock.json",
  "tsconfig.json",
  "fixtures/package-consumer/package.json",
  "fixtures/package-consumer/runtime.cjs",
  "fixtures/package-consumer/deep-import.cjs",
  "fixtures/package-consumer/tsconfig.json",
  "fixtures/package-consumer/types.ts",
  "src/index.ts",
  "src/pipeline.ts",
  "src/schema.ts",
  "src/meta_v3.ts",
  "src/repository_model.ts",
  "src/local_source.ts",
  "src/local_source_model.ts",
  "src/corpus_analysis.ts",
  "src/corpus_report.ts",
  "src/corpus_scan.ts",
  "src/corpus_roots.ts",
  "src/corpus_cache.ts",
  "src/corpus_snapshot.ts",
  "src/corpus_diff.ts",
  "src/corpus_session.ts",
  "src/corpus_readiness.ts",
  "src/corpus_candidates.ts",
  "src/corpus_coverage.ts",
  "src/ordering.ts",
  "src/extractors/work_intelligence.ts",
  "src/extractors/index.ts",
  "src/interpretation.ts",
  "src/inventory.ts",
  "dist/corpus_analysis.js",
  "dist/corpus_analysis.d.ts",
  "dist/corpus_analysis.js.map",
  "dist/corpus_scan.js",
  "dist/corpus_scan.d.ts",
  "dist/corpus_scan.js.map",
  "dist/corpus_roots.js",
  "dist/corpus_roots.d.ts",
  "dist/corpus_roots.js.map",
  "dist/corpus_cache.js",
  "dist/corpus_cache.d.ts",
  "dist/corpus_cache.js.map",
  "dist/corpus_snapshot.js",
  "dist/corpus_snapshot.d.ts",
  "dist/corpus_snapshot.js.map",
  "dist/corpus_diff.js",
  "dist/corpus_diff.d.ts",
  "dist/corpus_diff.js.map",
  "dist/corpus_session.js",
  "dist/corpus_session.d.ts",
  "dist/corpus_session.js.map",
  "dist/corpus_readiness.js",
  "dist/corpus_readiness.d.ts",
  "dist/corpus_readiness.js.map",
  "dist/corpus_candidates.js",
  "dist/corpus_candidates.d.ts",
  "dist/corpus_candidates.js.map",
  "dist/corpus_coverage.js",
  "dist/corpus_coverage.d.ts",
  "dist/corpus_coverage.js.map",
  "dist/corpus_report.js",
  "dist/corpus_report.d.ts",
  "dist/corpus_report.js.map",
  "dist/ordering.js",
  "dist/ordering.d.ts",
  "dist/ordering.js.map",
  "dist/extractors/work_intelligence.js",
  "dist/extractors/work_intelligence.d.ts",
  "dist/extractors/work_intelligence.js.map",
  "tests/corpus_intelligence.test.ts",
  "tests/corpus_qualification.test.ts",
  "tests/corpus_multi_root.test.ts",
  "tests/corpus_cache.test.ts",
  "tests/corpus_diff.test.ts",
  "tests/corpus_session.test.ts",
  "tests/corpus_readiness.test.ts",
  "tests/corpus_candidates.test.ts",
  "tests/corpus_scale.test.ts",
  "tests/corpus_cli.test.ts",
  "tests/helpers/multi_root_fixtures.ts",
  "tests/work_intelligence.test.ts",
  "tests/artifact_scoped_assertions.test.ts",
  "tests/local_source_cli.test.ts",
  "tests/helpers/corpus_fixtures.ts",
  "docs/corpus-intelligence.md",
  "docs/corpus-archaeology.md",
  "docs/decisions/037-corpus-intelligence-artifact-scope-and-duplicate-topology.md",
  "docs/decisions/038-multi-root-corpus-incremental-cache-and-readiness-evidence.md",
  "src/local_archive_policy.ts",
  "src/archive_preflight.ts",
  "src/zip_reader.ts",
  "src/encoding.ts",
  "dist/local_source.js",
  "dist/local_source.d.ts",
  "dist/local_source.js.map",
  "dist/local_source_model.js",
  "dist/local_source_model.d.ts",
  "dist/local_source_model.js.map",
  "dist/local_archive_policy.js",
  "dist/local_archive_policy.d.ts",
  "dist/local_archive_policy.js.map",
  "dist/archive_preflight.js",
  "dist/archive_preflight.d.ts",
  "dist/archive_preflight.js.map",
  "dist/zip_reader.js",
  "dist/zip_reader.d.ts",
  "dist/zip_reader.js.map",
  "dist/encoding.js",
  "dist/encoding.d.ts",
  "dist/encoding.js.map",
  "scripts/local-source-cli.js",
  "tests/local_source_safety.test.ts",
  "tests/local_source_archive_security.test.ts",
  "tests/local_source_model.test.ts",
  "tests/local_source_qualification.test.ts",
  "tests/encoding_safety.test.ts",
  "tests/helpers/zip_fixtures.ts",
  "docs/decisions/036-read-only-local-source-acquisition.md",
  "src/public/inventory.ts",
  "src/public/schema.ts",
  "src/public/advanced.ts",
  "src/public/llm.ts",
  "src/public/repository_model.ts",
  "dist/index.js",
  "dist/index.d.ts",
  "dist/index.js.map",
  "dist/public/inventory.js",
  "dist/public/inventory.d.ts",
  "dist/public/inventory.js.map",
  "dist/public/schema.js",
  "dist/public/schema.d.ts",
  "dist/public/schema.js.map",
  "dist/public/advanced.js",
  "dist/public/advanced.d.ts",
  "dist/public/advanced.js.map",
  "dist/public/llm.js",
  "dist/public/llm.d.ts",
  "dist/public/llm.js.map",
  "dist/repository_model.js",
  "dist/repository_model.d.ts",
  "dist/repository_model.js.map",
  "dist/public/repository_model.js",
  "dist/public/repository_model.d.ts",
  "dist/public/repository_model.js.map",
  "scripts/selfpack.js",
  "scripts/repository-model-cli.js",
  "scripts/topology-conformance.js",
  "scripts/check-public-api.js",
  "scripts/check-publication-readiness.js",
  "scripts/check-architecture-authority.js",
  "scripts/check-dist-sync.js",
  "scripts/generate-architecture-manifest.js",
  "scripts/test-packed-consumer.js",
  "scripts/lib/public-api.js",
  "scripts/lib/architecture-authority.js",
  "scripts/lib/dist-integrity.js",
  "tests/public_api_runtime.test.ts",
  "tests/public_api_types.test.ts",
  "tests/publication_readiness.test.ts",
  "tests/architecture_authority.test.ts",
  "tests/dist_integrity.test.ts",
  "tests/repository_model.test.ts",
  "docs/topology-conformance.json",
  "fixtures/repository-model/expected-bundle/manifest.json",
  "fixtures/local-source/expected-bundle/manifest.json",
  "fixtures/local-source/expected-bundle/packet.json",
  "fixtures/local-source/expected-bundle/receipts/validation-receipt.json",
  "fixtures/local-source/sample-source/Bundle.zip",
  "fixtures/local-source/sample-source/README.md",
  "fixtures/local-source/sample-source/package.json",
  "fixtures/repository-model/expected-bundle/packet.json",
  "fixtures/repository-model/expected-bundle/receipts/validation-receipt.json",
  "docs/architecture.md",
  "docs/architecture-authority.json",
  "docs/output-placement-contract.md",
  "docs/contracts.md",
  "docs/public-api-contract.json",
  "docs/package-contract.json",
  "docs/package-publication-decision.json",
  "docs/release-checklist.md",
  "docs/decision_log.md",
  "docs/manifest.md",
  "docs/public-api.md",
  "docs/migrations/v2-to-v3.md",
  "docs/migrations/local-files-to-local-source.md",
  "docs/local-source-trust-boundary.md",
  "docs/traceability-map.json",
  "docs/schemas/architecture-authority.schema.json",
  "docs/legacy/consolidation-v1/README.md",
  "docs/legacy/consolidation-v1/contracts.md",
  "docs/legacy/consolidation-v1/decision_log.md",
  "docs/legacy/consolidation-v1/traceability_map.yaml",
  "docs/legacy/consolidation-v1/manifest.md",
  "docs/legacy/consolidation-v1/artifact_manifest.yaml",
  "tools/consolidation/README.md",
  "tools/consolidation/schemas/l9_meta.schema.yaml",
  "tools/consolidation/schemas/l9_artifact_meta.schema.yaml",
  "tools/consolidation/schemas/move_map.schema.yaml",
].sort((a, b) => a.localeCompare(b));

const LEGACY_ARCHIVE_BLOBS = Object.freeze({
  "docs/legacy/consolidation-v1/contracts.md": "0fb15ff79f7357e426bfcb25644d52919c96d744",
  "docs/legacy/consolidation-v1/decision_log.md": "3377f9bb4236a7957b7b45e28a01a6268d2258a3",
  "docs/legacy/consolidation-v1/traceability_map.yaml": "836ec8b5efca02c016bfd74bace3ecd40196aa52",
  "docs/legacy/consolidation-v1/manifest.md": "18c97ba760c15117821af0222bcd1e9fcdd9f56c",
  "docs/legacy/consolidation-v1/artifact_manifest.yaml": "3f589985403aef6c8d6015ef8e49d88ed1a39b9d",
  "tools/consolidation/schemas/l9_meta.schema.yaml": "5c7ee8791008c27d12bdf5f8246f8771a5266583",
  "tools/consolidation/schemas/l9_artifact_meta.schema.yaml": "1ea74752496d2398209ba53e86c30587861b8401",
  "tools/consolidation/schemas/move_map.schema.yaml": "3a2d2b60d40d4b7f1e1f6cd0f6dd3fab8462a983",
});

function fail(message) { throw new Error(message); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function gitBlobSha(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`, "utf8");
  // NOSONAR(S4790): SHA-1 here reproduces Git's blob object id for content-drift
  // detection, not a security control. Git itself uses SHA-1 for object identity.
  return crypto.createHash("sha1").update(header).update(buffer).digest("hex"); // NOSONAR
}
function exactKeys(value, requiredKeys, optionalKeys, label, errors) {
  if (!isPlainObject(value)) { errors.push(`${label} must be an object`); return; }
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  for (const key of requiredKeys) if (!(key in value)) errors.push(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!allowed.has(key)) errors.push(`${label}.${key} is not allowed`);
}
function requireString(value, label, errors, pattern) {
  if (typeof value !== "string" || value.length === 0) errors.push(`${label} must be a non-empty string`);
  else if (pattern && !pattern.test(value)) errors.push(`${label} has an invalid format`);
}
function requireStringArray(value, label, errors) {
  if (!Array.isArray(value) || value.some((x) => typeof x !== "string" || x.length === 0)) {
    errors.push(`${label} must be an array of non-empty strings`);
  }
}
function validateAuthorityDocument(authority) {
  const errors = [];
  exactKeys(authority,
    ["schema","repository","audit_base_ref","status","engine","contracts","distribution","public_api","persisted_outputs","validation","legacy"],
    ["operation_contract","invocation_boundary","deterministic_identity","carrier_policy","metadata_index","frontmatter_safety","local_source_acquisition"], "authority", errors);
  if (!isPlainObject(authority)) return errors;
  if (authority.schema !== "l9.architecture-authority/v1") errors.push("authority.schema is invalid");
  if (authority.repository !== "Quantum-L9/l9-meta-injector") errors.push("authority.repository is invalid");
  requireString(authority.audit_base_ref, "authority.audit_base_ref", errors, /^[a-f0-9]{40}$/);
  if (authority.status !== "active") errors.push("authority.status must be active");

  exactKeys(authority.engine, ["language","source_root","runtime_entrypoint","package_entrypoint","types_entrypoint"], [], "authority.engine", errors);
  if (isPlainObject(authority.engine)) {
    if (authority.engine.language !== "typescript") errors.push("authority.engine.language must be typescript");
    for (const key of ["source_root","runtime_entrypoint","package_entrypoint","types_entrypoint"]) requireString(authority.engine[key], `authority.engine.${key}`, errors);
  }
  exactKeys(authority.contracts, ["metadata","pipeline","architecture","public_api","package"], ["operations","repository_authority","authority_scan","check","operation_dispatch","discovery","carrier_policy","metadata_index","carrier_operation","file_transaction","frontmatter_patch","output_placement","local_source","local_archive_policy","archive_preflight","encoding","corpus_analysis","corpus_report","corpus_scan","corpus_roots","corpus_cache","corpus_snapshot","corpus_diff","corpus_session","corpus_readiness","corpus_candidates","corpus_coverage","corpus_archaeology","work_intelligence","ordering"], "authority.contracts", errors);
  if (isPlainObject(authority.contracts)) for (const key of Object.keys(authority.contracts)) requireString(authority.contracts[key], `authority.contracts.${key}`, errors);
  exactKeys(authority.distribution, ["model","source_root","generated_root","compliance_state","source_parity_command","packed_consumer_command","package_contract"], [], "authority.distribution", errors);
  if (isPlainObject(authority.distribution)) {
    if (authority.distribution.model !== "committed_dist_mirror") errors.push("authority.distribution.model is invalid");
    if (authority.distribution.compliance_state !== "enforced_RAA-006") errors.push("authority.distribution.compliance_state must be enforced_RAA-006");
    requireString(authority.distribution.source_root, "authority.distribution.source_root", errors);
    requireString(authority.distribution.generated_root, "authority.distribution.generated_root", errors);
    if (authority.distribution.source_parity_command !== "npm run check:dist") errors.push("authority.distribution.source_parity_command is invalid");
    if (authority.distribution.packed_consumer_command !== "npm run test:packed") errors.push("authority.distribution.packed_consumer_command is invalid");
    if (authority.distribution.package_contract !== "docs/package-contract.json") errors.push("authority.distribution.package_contract is invalid");
  }
  exactKeys(authority.public_api, ["model","current_state","primary_entrypoint","contract","versioning","supported_subpaths","validation_command"], [], "authority.public_api", errors);
  if (isPlainObject(authority.public_api)) {
    if (authority.public_api.model !== "orchestration_root_plus_versioned_subpaths") errors.push("authority.public_api.model is invalid");
    if (authority.public_api.current_state !== "enforced_RAA-007") errors.push("authority.public_api.current_state must be enforced_RAA-007");
    requireString(authority.public_api.primary_entrypoint, "authority.public_api.primary_entrypoint", errors);
    if (authority.public_api.contract !== "docs/public-api-contract.json") errors.push("authority.public_api.contract is invalid");
    requireString(authority.public_api.versioning, "authority.public_api.versioning", errors);
    requireStringArray(authority.public_api.supported_subpaths, "authority.public_api.supported_subpaths", errors);
    if (authority.public_api.validation_command !== "npm run check:api") errors.push("authority.public_api.validation_command is invalid");
  }
  requireStringArray(authority.persisted_outputs, "authority.persisted_outputs", errors);
  if (Array.isArray(authority.persisted_outputs)) {
    const actual = [...authority.persisted_outputs].sort((a, b) => a.localeCompare(b));
    if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_PERSISTED_OUTPUTS)) errors.push("authority.persisted_outputs does not match the live pipeline outputs");
  }
  exactKeys(authority.validation, ["api","authority","manifest","dist","packed_consumer","publication","canonical","ci_workflow","selfpack","publish_path"], [], "authority.validation", errors);
  if (isPlainObject(authority.validation)) for (const key of Object.keys(authority.validation)) requireString(authority.validation[key], `authority.validation.${key}`, errors);
  exactKeys(authority.legacy, ["status","documentation","runtime","schemas"], [], "authority.legacy", errors);
  if (isPlainObject(authority.legacy)) {
    if (authority.legacy.status !== "reference_only") errors.push("authority.legacy.status must be reference_only");
    for (const key of ["documentation","runtime","schemas"]) requireString(authority.legacy[key], `authority.legacy.${key}`, errors);
  }
  return errors;
}
function validateAuthoritySchemaDocument(schema) {
  const errors = [];
  if (!isPlainObject(schema)) return ["authority schema must be an object"];
  if (schema.$schema !== "https://json-schema.org/draft/2020-12/schema") errors.push("authority schema draft is invalid");
  if (schema.type !== "object" || schema.additionalProperties !== false) errors.push("authority schema root must be a closed object");
  const required = ["schema","repository","audit_base_ref","status","engine","contracts","distribution","public_api","persisted_outputs","validation","legacy"].sort((a, b) => a.localeCompare(b));
  const actual = Array.isArray(schema.required) ? [...schema.required].sort((a, b) => a.localeCompare(b)) : [];
  if (JSON.stringify(required) !== JSON.stringify(actual)) errors.push("authority schema required-key set is incomplete");
  for (const key of ["engine","contracts","distribution","public_api","validation","legacy"]) {
    const node = schema.properties?.[key];
    if (!isPlainObject(node) || node.type !== "object" || node.additionalProperties !== false || !Array.isArray(node.required)) {
      errors.push(`authority schema ${key} must be a closed required object`);
    }
  }
  return errors;
}
function validateTraceabilityDocument(doc) {
  const errors = [];
  exactKeys(doc, ["schema","repository","authority","capabilities"], [], "traceability", errors);
  if (!isPlainObject(doc)) return errors;
  if (doc.schema !== "l9.traceability-map/v1") errors.push("traceability.schema is invalid");
  if (doc.repository !== "Quantum-L9/l9-meta-injector") errors.push("traceability.repository is invalid");
  if (doc.authority !== "docs/architecture-authority.json") errors.push("traceability.authority is invalid");
  if (!Array.isArray(doc.capabilities) || doc.capabilities.length === 0) return [...errors, "traceability.capabilities must be a non-empty array"];
  const names = new Set();
  for (let i = 0; i < doc.capabilities.length; i++) {
    const c = doc.capabilities[i];
    const label = `traceability.capabilities[${i}]`;
    exactKeys(c, ["capability","source","public_entrypoint","tests","validators","stability"], ["persisted_outputs"], label, errors);
    if (!isPlainObject(c)) continue;
    requireString(c.capability, `${label}.capability`, errors);
    if (names.has(c.capability)) errors.push(`${label}.capability is duplicated`);
    names.add(c.capability);
    requireString(c.source, `${label}.source`, errors);
    if (!(c.public_entrypoint === null || typeof c.public_entrypoint === "string")) errors.push(`${label}.public_entrypoint must be string or null`);
    requireStringArray(c.tests, `${label}.tests`, errors);
    requireStringArray(c.validators, `${label}.validators`, errors);
    requireString(c.stability, `${label}.stability`, errors);
    if ("persisted_outputs" in c) requireStringArray(c.persisted_outputs, `${label}.persisted_outputs`, errors);
  }
  return errors;
}
function isRegularFile(root, rel) {
  const abs = path.join(root, rel);
  try { return fs.lstatSync(abs).isFile() && !fs.lstatSync(abs).isSymbolicLink(); }
  catch { return false; }
}
function isDirectory(root, rel) {
  const abs = path.join(root, rel);
  try { return fs.lstatSync(abs).isDirectory() && !fs.lstatSync(abs).isSymbolicLink(); }
  catch { return false; }
}
function verifyLegacyArchive(root = REPO) {
  const errors = [];
  for (const [rel, expected] of Object.entries(LEGACY_ARCHIVE_BLOBS)) {
    if (!isRegularFile(root, rel)) { errors.push(`legacy archive file missing or unsafe: ${rel}`); continue; }
    const actual = gitBlobSha(fs.readFileSync(path.join(root, rel)));
    if (actual !== expected) errors.push(`legacy archive blob drift: ${rel} expected ${expected}, got ${actual}`);
  }
  return errors;
}
function buildManifest(root = REPO) {
  const entries = AUTHORITY_CRITICAL_PATHS.map((rel) => {
    if (!isRegularFile(root, rel)) fail(`missing or unsafe authority-critical file: ${rel}`);
    const content = fs.readFileSync(path.join(root, rel));
    return { path: rel, git_blob_sha1: gitBlobSha(content) };
  });
  return {
    schema: "l9.architecture-manifest/v1",
    repository: "Quantum-L9/l9-meta-injector",
    authority: "docs/architecture-authority.json",
    note: "The manifest excludes itself to avoid a self-referential digest. Git blob identities are content-bound and verified from the working tree.",
    entries,
  };
}
function stableJson(value) { return JSON.stringify(value, null, 2) + "\n"; }
module.exports = {
  REPO, EXPECTED_PERSISTED_OUTPUTS, AUTHORITY_CRITICAL_PATHS, LEGACY_ARCHIVE_BLOBS,
  buildManifest, stableJson, readJson, fail, gitBlobSha, isRegularFile, isDirectory,
  validateAuthorityDocument, validateAuthoritySchemaDocument, validateTraceabilityDocument,
  verifyLegacyArchive,
};
