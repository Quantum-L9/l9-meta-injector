#!/usr/bin/env node
/*
 * selfpack.js — repeatable smoke test + advancement monitor.
 *
 * Runs the meta-injection pipeline over ./fixtures (a fixed corpus that exercises
 * every injection strategy), asserts the index/report outputs are produced, then
 * distills a DETERMINISTIC summary (volatile fields like timestamps and content
 * hashes excluded) and diffs it against a committed baseline.
 *
 *   npm run selfpack            # verify current output matches fixtures/selfpack.baseline.json
 *   npm run selfpack -- --update  (or SELFPACK_UPDATE=1)  # re-baseline after an intended change
 *
 * Exit code 0 = matches baseline; 1 = drift (prints a readable diff); 2 = hard failure
 * (missing index output / pipeline error). CI runs this as a smoke step.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const FIXTURES = path.join(REPO, "fixtures");
// Baseline lives OUTSIDE the fixture corpus so it is never itself injected/scanned.
const BASELINE = path.join(__dirname, "selfpack.baseline.json");
const UPDATE = process.argv.includes("--update") || process.env.SELFPACK_UPDATE === "1";

const REQUIRED_INDEXES = [
  "primitive-library-index.json",
  "prompt-library-index.json",
  "dedup-report.json",
  "dedup-report.md",
  "verification-report.json",
];

function fail(msg) { console.error(`selfpack: ${msg}`); process.exit(2); }

let pkg;
try { pkg = require(path.join(REPO, "dist", "index.js")); }
catch (e) { fail(`could not load dist/index.js (run "npm run build" first): ${e.message}`); }

function isGenerated(name) {
  return name.endsWith(".inject.log") || name.endsWith(".l9meta.yaml") || name === "selfpack.baseline.json";
}
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (isGenerated(e.name)) continue; // never copy generated artifacts into the corpus
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc); else acc.push(p);
  }
  return acc;
}
function rel(root, p) { return path.relative(root, p).split(path.sep).join("/"); }

function pipelineConfig(root, out) {
  return {
    root, glob: "**/*", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.doctrine.platform", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}

function tmp(prefix) { return fs.mkdtempSync(path.join(os.tmpdir(), prefix)); }

async function measureIdempotency() {
  const root = tmp("selfpack-idem-"), out = tmp("selfpack-idemo-");
  copyDir(FIXTURES, root);
  await pkg.runPipelineAsync(pipelineConfig(root, out));
  const before = new Map(walk(root).map((f) => [f, fs.readFileSync(f)]));
  await pkg.runPipelineAsync(pipelineConfig(root, out));
  const after = walk(root);
  let changed = 0;
  for (const f of after) { const b = before.get(f); if (!b || !b.equals(fs.readFileSync(f))) changed++; }
  return changed;
}

async function main() {
  const root = tmp("selfpack-"), out = tmp("selfpack-out-");
  copyDir(FIXTURES, root);
  const result = await pkg.runPipelineAsync(pipelineConfig(root, out));

  // Hard assertions: every required index/report must exist.
  for (const name of REQUIRED_INDEXES) {
    if (!fs.existsSync(path.join(out, name))) fail(`missing required index output: ${name}`);
  }
  const primitive = JSON.parse(fs.readFileSync(path.join(out, "primitive-library-index.json"), "utf8"));
  const prompt = JSON.parse(fs.readFileSync(path.join(out, "prompt-library-index.json"), "utf8"));
  const dedup = JSON.parse(fs.readFileSync(path.join(out, "dedup-report.json"), "utf8"));
  const verification = JSON.parse(fs.readFileSync(path.join(out, "verification-report.json"), "utf8"));
  if (!Array.isArray(primitive) || !Array.isArray(prompt) || !Array.isArray(verification)) {
    fail("index outputs are not arrays as expected");
  }

  // Deterministic per-file view (sorted; volatile fields excluded).
  const injByPath = new Map(result.injected.map((r) => [r.sourcePath, r]));
  const verByPath = new Map(result.verified.map((v) => [v.sourcePath, v]));
  const files = result.scanned
    .filter((e) => injByPath.has(e.sourcePath))
    .map((e) => {
      const r = injByPath.get(e.sourcePath), v = verByPath.get(e.sourcePath);
      return {
        path: rel(root, e.sourcePath),
        artifact_type: r.meta.artifact_type,
        mcp_primitive: r.meta.mcp_primitive,
        injectable: r.meta.injectable,
        strategy: r.injectionStrategy,
        hasSidecar: !!r.sidecarPath,
        yamlValid: v ? v.yamlValid : null,
        bodyPreserved: v ? v.bodyPreserved : null,
        sharingScopeValid: v ? v.sharingScopeValid : null,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const dist = (arr, key) => arr.reduce((m, x) => { m[x[key]] = (m[x[key]] || 0) + 1; return m; }, {});
  const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => a[0].localeCompare(b[0])));

  const summary = {
    fixtures: rel(REPO, FIXTURES),
    totals: {
      scanned: result.scanned.length,
      injected: result.injected.length,
      verified: result.verified.length,
      verifiedClean: result.verified.filter((v) => v.yamlValid && v.bodyPreserved && v.taxonomyValid && v.sharingScopeValid && v.issues.length === 0).length,
    },
    strategyDist: sortObj(dist(files, "strategy")),
    typeDist: sortObj(dist(files, "artifact_type")),
    indexes: {
      primitiveLibraryEntries: primitive.length,
      promptLibraryEntries: prompt.length,
      dedupTotalScanned: dedup.totalScanned,
      dedupUniqueCount: dedup.uniqueCount,
      dedupExactTwins: dedup.auditorTwins.length,
      verificationEntries: verification.length,
      verificationClean: verification.filter((v) => v.yamlValid && v.bodyPreserved && v.taxonomyValid && v.sharingScopeValid && v.issues.length === 0).length,
    },
    idempotency: { rerunFilesChanged: await measureIdempotency() },
    files,
  };

  const rendered = JSON.stringify(summary, null, 2) + "\n";

  if (UPDATE || !fs.existsSync(BASELINE)) {
    fs.writeFileSync(BASELINE, rendered, "utf8");
    console.log(`selfpack: baseline ${UPDATE ? "updated" : "created"} → ${rel(REPO, BASELINE)}`);
    printHighlights(summary);
    return;
  }

  const baseline = fs.readFileSync(BASELINE, "utf8");
  if (baseline === rendered) {
    console.log("selfpack: OK — output matches baseline.");
    printHighlights(summary);
    return;
  }

  console.error("selfpack: DRIFT — output differs from baseline (fixtures/selfpack.baseline.json).");
  printLineDiff(baseline, rendered);
  console.error('\nIf this change is intended/an improvement, re-baseline with:  npm run selfpack -- --update');
  process.exit(1);
}

function printHighlights(s) {
  console.log(`  scanned=${s.totals.scanned} injected=${s.totals.injected} verifiedClean=${s.totals.verifiedClean}/${s.totals.verified}`);
  console.log(`  strategies=${JSON.stringify(s.strategyDist)}`);
  console.log(`  types=${JSON.stringify(s.typeDist)}`);
  console.log(`  idempotency.rerunFilesChanged=${s.idempotency.rerunFilesChanged}` + (s.idempotency.rerunFilesChanged === 0 ? " (stable)" : " (NOT yet stable)"));
}

function printLineDiff(a, b) {
  const la = a.split("\n"), lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] !== lb[i]) {
      if (la[i] !== undefined) console.error(`  - ${la[i]}`);
      if (lb[i] !== undefined) console.error(`  + ${lb[i]}`);
    }
  }
}

main().catch((e) => fail(e && e.stack || String(e)));
