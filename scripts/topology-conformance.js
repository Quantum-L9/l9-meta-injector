#!/usr/bin/env node
"use strict";
// Cross-repository conformance proof for the Repository Model Packet.
//
//   L9_TOPOLOGY_CHECKOUT=<checkout> [L9_PYTHON=<bin>] \
//     node scripts/topology-conformance.js [--update]
//
// Feeds the committed golden bundles to the ACTUAL l9-constellation-topology consumer
// boundary (`load_repository_model_bundle` + `RepositoryModelV1Adapter`) and requires
// acceptance with no translation shim.
//
// The checkout and interpreter are read from the environment rather than argv, matching
// the existing `L9_TSC` convention in scripts/lib/dist-integrity.js. Nothing taken from
// the command line reaches the spawned process, its working directory, or its environment.
//
// The topology checkout is read-only and ephemeral: this repository never acquires a
// runtime dependency on it. This script is deliberately NOT part of `npm run validate`,
// because the canonical gate must stay runnable without a second repository or a Python
// toolchain. `docs/topology-conformance.json` records the result, and the Vitest suite
// fails if that record drifts from the golden bundle it claims to describe.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const cp = require("node:child_process");

const REPO = path.resolve(__dirname, "..");
// Two committed bundles: the inventory-only packet, and the packet the structured
// interpretation stage produces (capabilities, ROUTES_TO/DOCUMENTED_BY edges, declared
// dependencies). Both must be accepted by the same bound consumer with no translation
// shim — otherwise the richer packet is only theoretically compatible.
const BUNDLES = [
  { id: "inventory", bundle: "fixtures/repository-model/expected-bundle" },
  // A local-source packet exercises the domains an inventory-only packet does not:
  // archive artifacts at virtual member locators, DERIVED_FROM ancestry across a
  // nested archive, and a non-Git `fs:sha256:` source revision. Proving the
  // inventory bundle alone would leave all three only theoretically compatible.
  { id: "local-source", bundle: "fixtures/local-source/expected-bundle" },
];
const EVIDENCE = path.join(REPO, "docs", "topology-conformance.json");
const LABEL = "topology-conformance";

const PROBE = `
import json, sys
from pathlib import Path
from l9_constellation_topology.packets.loader import load_repository_model_bundle
from l9_constellation_topology.packets.adapters.repository_model_v1 import RepositoryModelV1Adapter

bundle = load_repository_model_bundle(Path(sys.argv[1]))
normalized = RepositoryModelV1Adapter().adapt(bundle.packet)
print(json.dumps({
    "packet_id": bundle.packet.packet_id,
    "semantic_hash": bundle.packet.semantic_hash,
    "packet_type": bundle.packet.packet_type,
    "packet_version": bundle.packet.packet_version,
    "receipt_id": bundle.receipt.receipt_id,
    "manifest_packet_id": bundle.manifest.packet_id,
    "adapter_packet_version": RepositoryModelV1Adapter.packet_version,
    "counts": {
        "repositories": len(normalized.repositories),
        "artifacts": len(normalized.artifacts),
        "capabilities": len(normalized.capabilities),
        "relationships": len(normalized.relationships),
        "evidence": len(normalized.evidence),
        "diagnostics": len(normalized.diagnostics),
    },
}))
`;

function fail(message) {
  console.error(`${LABEL}: FAILED: ${message}`);
  process.exit(1);
}

/**
 * Order two strings by UTF-16 code unit, explicitly.
 *
 * A bare `.sort()` already does this, but it does not *say* so, and the obvious
 * "fix" a linter suggests -- `localeCompare` -- would be wrong here: it follows
 * the runtime's ICU data and the ambient locale, so the canonical digest below
 * could differ between two machines looking at identical checkouts. Same
 * contract as `src/ordering.ts`, restated locally because this script runs
 * before and independently of the TypeScript build.
 */
function compareCodeUnits(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Absolute path to the `git` executable, resolved once.
 *
 * Spawning the bare name "git" makes the OS consult PATH at exec time, so a
 * writable directory earlier in PATH decides which binary runs. Resolving to an
 * absolute path up front removes that lookup from every later call, and pinning
 * the result means a PATH edited midway through a run cannot swap the binary
 * between two calls that are meant to describe the same repository.
 *
 * Fails closed: a git that cannot be found is an error here rather than a
 * confusing failure inside the first command that needed it.
 */
function resolveGitBinary() {
  const isWindows = process.platform === "win32";
  const names = isWindows ? ["git.exe", "git.cmd"] : ["git"];
  const entries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of entries) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      try {
        if (fs.statSync(candidate).isFile()) {
          fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        }
      } catch {
        // Not this directory; keep looking.
      }
    }
  }
  fail("cannot locate a git executable on PATH");
  return "git";
}

const GIT_BINARY = resolveGitBinary();

function gitRevision(checkout) {
  const result = cp.spawnSync(GIT_BINARY, ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" });
  if (result.status !== 0) fail(`cannot resolve the topology revision: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sha256(file) {
  return `sha256:${require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

/**
 * A digest over a checkout's tracked contents, including modes.
 *
 * Taken before and after the probe so "the topology checkout is read-only" stops
 * being a sentence in a comment and becomes a checked property. This harness
 * runs a Python interpreter with the consumer's source on its path, and an
 * interpreter is perfectly capable of writing: a `.pyc` beside a module, a log,
 * a cache directory, an adapter that persists something on load. Any of those is
 * a mutation of somebody else's repository performed by this one.
 *
 * `.git` is excluded — its object store and index legitimately change when git
 * itself is asked for a revision — and so is `__pycache__`, which the
 * interpreter creates for its own reasons and which the guard below removes
 * before comparing. Everything else must be byte-identical.
 */
function checkoutDigest(root) {
  const crypto = require("node:crypto");
  const entries = {};
  const walk = (directory) => {
    let listing;
    try {
      listing = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (entry.name === ".git" || entry.name === "__pycache__") continue;
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      let stats;
      try {
        stats = fs.lstatSync(absolute);
      } catch {
        continue;
      }
      const mode = (stats.mode & 0o777).toString(8);
      if (stats.isSymbolicLink()) {
        entries[relative] = `symlink:${mode}:${fs.readlinkSync(absolute)}`;
        continue;
      }
      if (stats.isDirectory()) {
        entries[`${relative}/`] = `dir:${mode}`;
        walk(absolute);
        continue;
      }
      if (stats.isFile()) {
        entries[relative] = `file:${mode}:${sha256(absolute)}`;
        continue;
      }
      entries[relative] = `special:${mode}`;
    }
  };
  walk(root);
  const canonical = Object.keys(entries)
    .sort(compareCodeUnits)
    .map((key) => `${key} ${entries[key]}`)
    .join("\n");
  return {
    digest: `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`,
    entries,
  };
}

/** Paths whose digest entry differs between two checkout digests. */
function mutatedCheckoutPaths(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort(compareCodeUnits);
}

/** Remove the bytecode caches the interpreter writes for its own reasons. */
function dropPycache(root) {
  const walk = (directory) => {
    let listing;
    try {
      listing = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of listing) {
      if (!entry.isDirectory()) continue;
      const absolute = path.join(directory, entry.name);
      if (entry.name === ".git") continue;
      if (entry.name === "__pycache__") {
        fs.rmSync(absolute, { recursive: true, force: true });
        continue;
      }
      walk(absolute);
    }
  };
  walk(root);
}

function main() {
  const topology = process.env.L9_TOPOLOGY_CHECKOUT || "";
  const python = process.env.L9_PYTHON || "python3";
  const update = process.argv.includes("--update");
  if (!topology) fail("L9_TOPOLOGY_CHECKOUT=<checkout> is required");

  const checkout = path.resolve(topology);
  const sourceRoot = path.join(checkout, "src");
  if (!fs.existsSync(sourceRoot)) fail(`not a topology checkout: ${checkout}`);
  // Fail closed unless this really is the consumer package, so the probe cannot be
  // pointed at an unrelated tree.
  if (!fs.existsSync(path.join(sourceRoot, "l9_constellation_topology"))) {
    fail(`checkout does not contain l9_constellation_topology: ${checkout}`);
  }
  const revision = gitRevision(checkout);
  // What the consumer's tree looked like before this repository touched it.
  const checkoutBefore = checkoutDigest(checkout);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "l9-topology-conformance-"));
  const scriptFile = path.join(scratch, "probe.py");
  fs.writeFileSync(scriptFile, PROBE, "utf8");

  const subjects = [];
  let adapterPacketVersion = "";
  for (const entry of BUNDLES) {
    const bundleRoot = path.join(REPO, entry.bundle);
    if (!fs.existsSync(bundleRoot)) fail(`golden bundle missing: ${bundleRoot}`);
    const packet = JSON.parse(fs.readFileSync(path.join(bundleRoot, "packet.json"), "utf8"));

    const probe = cp.spawnSync(python, [scriptFile, bundleRoot], {
      cwd: checkout,
      encoding: "utf8",
      env: { ...process.env, PYTHONPATH: sourceRoot },
    });
    if (probe.status !== 0) {
      process.stderr.write(probe.stdout || "");
      process.stderr.write(probe.stderr || "");
      fail(`the bound topology consumer rejected the ${entry.id} packet`);
    }

    let observed;
    try { observed = JSON.parse(probe.stdout.trim().split(/\r?\n/).pop()); }
    catch { fail(`could not parse the consumer probe output: ${probe.stdout}`); }

    if (observed.packet_id !== packet.packet_id) fail(`consumer reported a different packet id than the ${entry.id} bundle`);
    if (observed.semantic_hash !== packet.semantic_hash) fail(`consumer reported a different semantic hash than the ${entry.id} bundle`);
    adapterPacketVersion = observed.adapter_packet_version;

    subjects.push({
      id: entry.id,
      bundle: entry.bundle,
      packet_id: packet.packet_id,
      semantic_hash: packet.semantic_hash,
      packet_type: packet.packet_type,
      packet_version: packet.packet_version,
      files: ["manifest.json", "packet.json", "receipts/validation-receipt.json"]
        .map((rel) => ({ path: rel, content_hash: sha256(path.join(bundleRoot, rel)) })),
      normalized_counts: observed.counts,
    });
  }
  fs.rmSync(scratch, { recursive: true, force: true });

  // The consumer's tree, after. Bytecode caches the interpreter wrote are the
  // one permitted difference and are removed rather than tolerated, so what
  // remains is a mutation this harness caused.
  dropPycache(checkout);
  const checkoutAfter = checkoutDigest(checkout);
  const mutated = mutatedCheckoutPaths(checkoutBefore.entries, checkoutAfter.entries);
  // Deliberately not recorded in `docs/topology-conformance.json`. The digests
  // are a property of one machine's working tree — an untracked virtualenv moves
  // them — so writing them into a committed verification record would put a
  // field in it that nobody else can reproduce, which is the shape of evidence
  // that looks stronger than it is. The guard is a mechanism that fails the run,
  // not a claim in a document.
  if (mutated.length > 0) {
    fail(
      `the topology checkout was modified by this run, which it must never be: `
      + `${mutated.slice(0, 10).join(", ")}${mutated.length > 10 ? ` (+${mutated.length - 10} more)` : ""}`,
    );
  }

  const evidence = {
    schema: "l9.topology-conformance/v1",
    repository: "Quantum-L9/l9-meta-injector",
    statement: "Every committed Repository Model Packet bundle — inventory-only and structurally interpreted — was accepted by the bound l9-constellation-topology consumer without a translation shim.",
    consumer: {
      repository: "Quantum-L9/l9-constellation-topology",
      revision,
      entrypoints: [
        "l9_constellation_topology.packets.loader.load_repository_model_bundle",
        "l9_constellation_topology.packets.adapters.repository_model_v1.RepositoryModelV1Adapter.adapt",
      ],
      adapter_packet_version: adapterPacketVersion,
    },
    subjects,
    result: {
      status: "passed",
      translation_shim_required: false,
    },

    verification_command: "L9_TOPOLOGY_CHECKOUT=<l9-constellation-topology checkout> npm run topology:conformance",
  };

  if (update) {
    fs.writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`${LABEL}: OK (evidence updated for topology ${revision}; ${subjects.length} bundle(s))`);
    return;
  }

  if (!fs.existsSync(EVIDENCE)) fail(`conformance evidence missing; re-run with --update`);
  const recorded = fs.readFileSync(EVIDENCE, "utf8");
  if (recorded !== `${JSON.stringify(evidence, null, 2)}\n`) {
    fail("recorded conformance evidence is stale; re-run with --update");
  }
  console.log(`${LABEL}: OK (topology ${revision} accepted ${subjects.map((item) => item.id).join(", ")})`);
}

// Run when invoked, exported when required. The read-only guard above is the
// part of this script a test can hold without a topology checkout and a Python
// toolchain, and a guard nothing exercises is a guard nobody knows is broken.
if (require.main === module) main();

module.exports = { checkoutDigest, dropPycache, mutatedCheckoutPaths };
