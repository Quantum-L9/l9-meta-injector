#!/usr/bin/env node
"use strict";
// corpus-qualification.js — run the real-corpus qualification and keep its report.
//
// The qualification itself lives in `tests/corpus_real_world_qualification.test.ts`,
// because it is a test: it builds a mixed read-only two-root corpus, scans it cold
// and then warm, and asserts the properties the corpus layer is only allowed to
// claim if it can demonstrate them.
//
// This wrapper exists so the *evidence* of that run can be kept rather than
// scrolling past. It sets `L9_QUALIFICATION_REPORT` and runs the same test file,
// so the report on disk is produced by the run that passed, not by a second run
// that might have seen something different.
//
//   node scripts/corpus-qualification.js [--out PATH]
//
// Defaults to `reports/corpus-real-world-qualification.json`.
//
// Two fields in the report are environment-dependent by nature and are meant to
// be read as such: `read_only_enforced_for_process` is false when the run is
// root, since root writes through `0o444`, and the tree digests include mode
// bits. Neither is a pass criterion. The pass criterion is
// `mutated_path_count: 0`, which holds either way.
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..");
const DEFAULT_OUT = path.join("reports", "corpus-real-world-qualification.json");
const TEST_FILE = path.join("tests", "corpus_real_world_qualification.test.ts");

function parseOut(argv) {
  const index = argv.indexOf("--out");
  if (index < 0) return DEFAULT_OUT;
  const value = argv[index + 1];
  if (value === undefined) {
    console.error("corpus-qualification: --out requires a path");
    process.exit(2);
  }
  return value;
}

const out = parseOut(process.argv.slice(2));
const absolute = path.resolve(REPO, out);

console.log(`corpus-qualification: running ${TEST_FILE}`);
const result = spawnSync(
  process.execPath,
  [path.join(REPO, "node_modules", "vitest", "vitest.mjs"), "run", TEST_FILE],
  {
    cwd: REPO,
    stdio: "inherit",
    env: { ...process.env, CI: "true", L9_QUALIFICATION_REPORT: absolute },
  },
);

if (result.error) {
  console.error(`corpus-qualification: could not run vitest (${result.error.message})`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error("corpus-qualification: FAILED — the qualification did not pass, no report written");
  process.exit(result.status === null ? 1 : result.status);
}

const fs = require("node:fs");
if (!fs.existsSync(absolute)) {
  console.error(`corpus-qualification: the run passed but wrote no report to ${out}`);
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(absolute, "utf8"));
console.log(`corpus-qualification: OK — ${out}`);
console.log(`  roots            ${report.roots.map((root) => root.root_label).join(", ")}`);
console.log(`  files scanned    ${report.files_scanned}`);
console.log(`  bytes scanned    ${report.bytes_scanned}`);
console.log(`  archives         ${report.corpus.archive_count}, ${report.corpus.archive_member_count} member(s)`);
console.log(
  `  decoded          ${report.decoder_coverage.normalized_document.covered}`
  + `/${report.decoder_coverage.normalized_document.eligible}`
  + ` (${report.corpus.artifact_count} artifacts, ${report.corpus.distinct_extension_count} extensions)`,
);
console.log(
  `  second run       hit ratio ${report.cache_hit_ratio_second_run.hit_ratio}`
  + ` (${report.cache_hit_ratio_second_run.hits} hit(s), ${report.cache_hit_ratio_second_run.misses} miss(es))`,
);
console.log(
  `  duplicates       ${report.duplicate_counts.exact_duplicate_cluster_count} exact cluster(s), `
  + `${report.duplicate_counts.cross_root_duplicate_cluster_count} crossing a root boundary; `
  + `${report.duplicate_counts.near_duplicate_candidate_count} near-duplicate candidate(s)`,
);
console.log(
  `  candidates       ${report.topic_candidate_counts.candidate_count} topic, `
  + `${report.project_candidate_counts.candidate_count} project, `
  + `${report.reasoning_eligible_count} reasoning-eligible`,
);
console.log(
  `  not read         ${report.unsupported_counts.unsupported_format_total} unsupported, `
  + `${report.unsupported_counts.ocr_required_count} OCR-required, `
  + `${report.unsupported_counts.secret_skipped_count} secret-skipped`,
);
console.log(
  `  cold == warm     ${report.cold_warm_equivalence.semantic_output_identical}`
  + `   source mutated paths: ${report.source_mutation.mutated_path_count}`,
);
