#!/usr/bin/env node
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { performance } = require("node:perf_hooks");
const { hasControlChar, isWithin } = require("./lib/operation-dispatch");
const { validateExternalReportPath, writeExternalReport } = require("./tracked-metadata-cli");

const OUTPUT_NAMES = ["metadata-index.snapshot.jsonl", "coverage-receipt.json", "result.json"];

function qualificationOutput(root, requested) {
  if (typeof requested !== "string" || requested.trim() === "" || hasControlChar(requested)) {
    throw new Error("qualification output requires a directory path without control characters");
  }
  const out = path.resolve(requested);
  if (isWithin(root, out)) {
    throw new Error("qualification output must be outside source");
  }
  // The caller supplies an existing private directory. Never create/chmod a
  // pathname that could alias the source; each save reuses the CLI's pinned,
  // canonical-parent, no-replace export boundary rather than a path-based write.
  const actual = fs.realpathSync(out);
  if (actual !== out || isWithin(root, actual)) {
    throw new Error("qualification output ancestry must be canonical and outside source");
  }
  const stat = fs.lstatSync(out);
  if (
    !stat.isDirectory() ||
    typeof process.getuid !== "function" ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o777) !== 0o700
  ) {
    throw new Error(
      "qualification output must be an existing caller-owned private directory (mode 0700)",
    );
  }
  for (const name of OUTPUT_NAMES) {
    validateExternalReportPath(root, path.join(out, name));
  }
  return out;
}

function filesystemState(dir) {
  const rows = [];
  function visit(current) {
    for (const name of fs.readdirSync(current).sort()) {
      const file = path.join(current, name);
      const stat = fs.lstatSync(file, { bigint: true });
      rows.push([
        path.relative(dir, file),
        String(stat.mode),
        String(stat.size),
        String(stat.mtimeNs),
        String(stat.ino),
        String(stat.nlink),
      ]);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        visit(file);
      }
    }
  }
  visit(dir);
  return JSON.stringify(rows);
}

const [rootArg, repositoryId, revision, outArg, producerDir, producerCommit] =
  process.argv.slice(2);
if (!producerCommit || !/^[a-f0-9]{40}$/.test(producerCommit)) {
  throw new Error("exact producer implementation commit required");
}
const root = fs.realpathSync(rootArg);
const out = qualificationOutput(root, outArg);
const producer = require(path.join(producerDir, "dist/public/advanced.js"));
const version = require(path.join(producerDir, "package.json")).version;
const before = filesystemState(root);
const timings = [];
let first;
for (let run = 0; run < 2; run++) {
  const start = performance.now();
  const value = producer.runTrackedCoverage({
    root,
    repositoryId,
    revision,
    contract: "l9.tracked-carrier-policy/v2",
    producerVersion: version,
  });
  timings.push(performance.now() - start);
  if (first) {
    assert.equal(value.bytes, first.bytes);
    assert.equal(value.coverageBytes, first.coverageBytes);
  } else {
    first = value;
  }
}
assert.equal(filesystemState(root), before, "source filesystem metadata changed during census");
const env = Object.create(null);
for (const [key, value] of Object.entries(process.env)) {
  if (!key.toUpperCase().startsWith("GIT_")) {
    env[key] = value;
  }
}
env.GIT_CONFIG_NOSYSTEM = "1";
env.GIT_CONFIG_GLOBAL = "/dev/null";
env.GIT_CONFIG_SYSTEM = "/dev/null";
env.GIT_OPTIONAL_LOCKS = "0";
env.GIT_NO_LAZY_FETCH = "1";
env.GIT_NO_REPLACE_OBJECTS = "1";
env.GIT_ALLOW_PROTOCOL = "";
env.GIT_TERMINAL_PROMPT = "0";
env.LC_ALL = "C";
const git = spawnSync(
  "/usr/bin/git",
  [
    "--no-optional-locks",
    "--no-replace-objects",
    "-c",
    "extensions.partialClone=",
    "-c",
    "core.fsmonitor=false",
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    first.coverage.snapshot.tree_oid,
  ],
  { cwd: root, env, shell: false, timeout: 30000, maxBuffer: 64 * 1024 * 1024 },
);
if (git.error || git.status !== 0) {
  throw new Error("independent tree metadata observation failed");
}
const raw = git.stdout;
if (raw.length && raw.at(-1) !== 0) {
  throw new Error("independent tree truncated");
}
const tree = new Map();
let offset = 0;
while (offset < raw.length) {
  const end = raw.indexOf(0, offset);
  const row = raw.subarray(offset, end);
  const tab = row.indexOf(9);
  assert(tab > 0);
  const match = /^(\d{6}) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})$/.exec(
    row.subarray(0, tab).toString("ascii"),
  );
  assert(match);
  const bytes = row.subarray(tab + 1);
  const key = bytes.toString("base64");
  assert(!tree.has(key));
  tree.set(key, { mode: match[1], type: match[2], oid: match[3], bytes });
  offset = end + 1;
}
const receipts = new Map();
for (const entry of first.coverage.entries) {
  assert(!receipts.has(entry.path_bytes_base64));
  receipts.set(entry.path_bytes_base64, entry);
  const expected = tree.get(entry.path_bytes_base64);
  assert(expected);
  assert.equal(entry.mode, expected.mode);
  assert.equal(entry.object_type, expected.type);
  assert.equal(entry.object_oid, expected.oid);
  assert.equal(entry.content_hash, null);
  assert.equal(entry.content_hash_scope, "not_inspected");
  const encoded = `l9.path/v2:${Buffer.from(repositoryId).toString("base64url")}.${expected.bytes.toString("base64url")}`;
  assert.equal(entry.id, encoded);
}
assert.equal(receipts.size, tree.size);
const indexed = new Map();
for (const record of first.records) {
  assert(!indexed.has(record.path_bytes_base64));
  indexed.set(record.path_bytes_base64, record);
  const entry = receipts.get(record.path_bytes_base64);
  assert.equal(entry.disposition, "indexed");
  assert.equal(entry.id, record.metadata.id);
  assert.equal(record.git.mode, entry.mode);
  assert.equal(record.git.object_oid, entry.object_oid);
  assert.equal(record.content_hash, null);
}
for (const entry of receipts.values()) {
  assert.equal(indexed.has(entry.path_bytes_base64), entry.disposition === "indexed");
  if (entry.disposition !== "indexed") {
    assert(entry.reason);
  }
  if (entry.mode === "120000" || entry.mode === "160000") {
    assert.equal(entry.carrier, "inventory_only");
  }
  if (entry.path === ".l9/metadata-index.jsonl" || entry.path === "GIT_TREE_MANIFEST.json") {
    assert.equal(entry.disposition, "protected");
  }
}
assert.equal(first.coverage.totals.tree_leaves, tree.size);
assert.equal(
  first.coverage.totals.indexed +
    first.coverage.totals.protected +
    first.coverage.totals.unsupported,
  tree.size,
);
assert.equal(first.coverage.closure, "exact_set_verified");
assert.equal(
  crypto.createHash("sha256").update(first.bytes).digest("hex"),
  first.coverage.index.sha256,
);
const counts = {
  blobs: 0,
  gitlinks: 0,
  symlinks: 0,
  hidden: 0,
  archives: 0,
  central_manifest: 0,
  inventory_only: 0,
};
for (const entry of first.coverage.entries) {
  if (entry.object_type === "blob") {
    counts.blobs++;
  } else {
    counts.gitlinks++;
  }
  if (entry.mode === "120000") {
    counts.symlinks++;
  }
  if (entry.path?.split("/").some((segment) => segment.startsWith("."))) {
    counts.hidden++;
  }
  if (entry.path && /\.(tar\.gz|tgz|zip|pdf)$/i.test(entry.path)) {
    counts.archives++;
  }
  if (entry.carrier === "central_manifest") {
    counts.central_manifest++;
  }
  if (entry.carrier === "inventory_only") {
    counts.inventory_only++;
  }
}
assert.equal(filesystemState(root), before, "independent comparator changed source metadata");
function save(name, bytes) {
  writeExternalReport(root, path.join(out, name), bytes);
}
save("metadata-index.snapshot.jsonl", first.bytes);
save("coverage-receipt.json", first.coverageBytes);
const result = {
  status: "passed",
  repository: repositoryId,
  requested_revision: revision,
  resolved_revision: first.coverage.snapshot.revision,
  tree_oid: first.coverage.snapshot.tree_oid,
  producer_commit: producerCommit,
  producer_version: version,
  totals: first.coverage.totals,
  counts,
  index_sha256: first.sha256,
  receipt_sha256: crypto.createHash("sha256").update(first.coverageBytes).digest("hex"),
  exact_set_verified: true,
  repeat_bytes_identical: true,
  source_filesystem_unchanged: true,
  subject_payload_inspection: false,
  authority_inspection: "not_performed",
  host_materializability: "not_assessed",
  timings_ms: timings,
  max_rss_kib: process.resourceUsage().maxRSS,
  node: process.version,
  git_version: spawnSync("/usr/bin/git", ["--version"], { encoding: "utf8" }).stdout.trim(),
};
save("result.json", JSON.stringify(result, null, 2) + "\n");
process.stdout.write(JSON.stringify(result) + "\n");
