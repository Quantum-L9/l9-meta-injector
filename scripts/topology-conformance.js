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
  { id: "interpreted", bundle: "fixtures/repository-model/expected-interpreted-bundle" },
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

function gitRevision(checkout) {
  const result = cp.spawnSync("git", ["rev-parse", "HEAD"], { cwd: checkout, encoding: "utf8" });
  if (result.status !== 0) fail(`cannot resolve the topology revision: ${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sha256(file) {
  return `sha256:${require("node:crypto").createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
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

main();
