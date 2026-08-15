#!/usr/bin/env node
"use strict";
// Cross-repository conformance proof for the Repository Model Packet.
//
//   node scripts/topology-conformance.js --topology <checkout> [--python <bin>] [--update]
//
// Feeds the committed golden bundle to the ACTUAL l9-constellation-topology consumer
// boundary (`load_repository_model_bundle` + `RepositoryModelV1Adapter`) and requires
// acceptance with no translation shim.
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
const GOLDEN = path.join(REPO, "fixtures", "repository-model", "expected-bundle");
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

function opt(name, fallback) {
  const argv = process.argv.slice(2);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
}

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
  const topology = opt("--topology", "");
  const python = opt("--python", "python3");
  const update = process.argv.includes("--update");
  if (!topology) fail("--topology <checkout> is required");

  const checkout = path.resolve(topology);
  const sourceRoot = path.join(checkout, "src");
  if (!fs.existsSync(sourceRoot)) fail(`not a topology checkout: ${checkout}`);
  if (!fs.existsSync(GOLDEN)) fail(`golden bundle missing: ${GOLDEN}`);

  const packet = JSON.parse(fs.readFileSync(path.join(GOLDEN, "packet.json"), "utf8"));
  const revision = gitRevision(checkout);

  const scriptFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "l9-topology-conformance-")), "probe.py");
  fs.writeFileSync(scriptFile, PROBE, "utf8");
  const probe = cp.spawnSync(python, [scriptFile, GOLDEN], {
    cwd: checkout,
    encoding: "utf8",
    env: { ...process.env, PYTHONPATH: sourceRoot },
  });
  fs.rmSync(path.dirname(scriptFile), { recursive: true, force: true });

  if (probe.status !== 0) {
    process.stderr.write(probe.stdout || "");
    process.stderr.write(probe.stderr || "");
    fail("the bound topology consumer rejected the emitted packet");
  }

  let observed;
  try { observed = JSON.parse(probe.stdout.trim().split(/\r?\n/).pop()); }
  catch { fail(`could not parse the consumer probe output: ${probe.stdout}`); }

  if (observed.packet_id !== packet.packet_id) fail("consumer reported a different packet id than the golden bundle");
  if (observed.semantic_hash !== packet.semantic_hash) fail("consumer reported a different semantic hash than the golden bundle");

  const evidence = {
    schema: "l9.topology-conformance/v1",
    repository: "Quantum-L9/l9-meta-injector",
    statement: "The golden Repository Model Packet bundle was accepted by the bound l9-constellation-topology consumer without a translation shim.",
    consumer: {
      repository: "Quantum-L9/l9-constellation-topology",
      revision,
      entrypoints: [
        "l9_constellation_topology.packets.loader.load_repository_model_bundle",
        "l9_constellation_topology.packets.adapters.repository_model_v1.RepositoryModelV1Adapter.adapt",
      ],
      adapter_packet_version: observed.adapter_packet_version,
    },
    subject: {
      bundle: "fixtures/repository-model/expected-bundle",
      packet_id: packet.packet_id,
      semantic_hash: packet.semantic_hash,
      packet_type: packet.packet_type,
      packet_version: packet.packet_version,
      files: ["manifest.json", "packet.json", "receipts/validation-receipt.json"]
        .map((rel) => ({ path: rel, content_hash: sha256(path.join(GOLDEN, rel)) })),
    },
    result: {
      status: "passed",
      translation_shim_required: false,
      normalized_counts: observed.counts,
    },
    verification_command: "node scripts/topology-conformance.js --topology <l9-constellation-topology checkout>",
  };

  if (update) {
    fs.writeFileSync(EVIDENCE, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(`${LABEL}: OK (evidence updated for topology ${revision})`);
    return;
  }

  if (!fs.existsSync(EVIDENCE)) fail(`conformance evidence missing; re-run with --update`);
  const recorded = fs.readFileSync(EVIDENCE, "utf8");
  if (recorded !== `${JSON.stringify(evidence, null, 2)}\n`) {
    fail("recorded conformance evidence is stale; re-run with --update");
  }
  console.log(`${LABEL}: OK (topology ${revision} accepted ${packet.packet_id})`);
}

main();
