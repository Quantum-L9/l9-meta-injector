#!/usr/bin/env node
"use strict";
// Executable Repository Model Packet egress.
//
//   node scripts/repository-model-cli.js <root> --name <repo> \
//     --revision git:<sha> --out <bundle-dir> [--generated-at <iso>]
//
// Observes a repository with the inventory engine and writes a canonical packet
// bundle that the l9-constellation-topology Repository Model consumer accepts
// directly. Read-only with respect to the observed repository.
const path = require("node:path");
const { parseCli, requireBuilt } = require("./lib/cli-args");

const LABEL = "repository-model";
const USAGE = [
  "usage: repository-model <root> --name <repository> --revision <rev> --out <bundle-dir>",
  "",
  "  <root>         repository root to observe",
  "  --name         canonical repository name (required)",
  "  --revision     explicit source revision, e.g. git:<40-hex> (required; never inferred)",
  "  --out          bundle directory to create (required; must be empty or absent)",
  "  --generated-at ISO timestamp recorded in the bundle (default: deterministic epoch)",
].join("\n");

function main() {
  const cli = parseCli(LABEL, USAGE);
  const name = cli.opt("--name", "");
  const revision = cli.opt("--revision", "");
  const out = cli.opt("--out", "");
  const generatedAt = cli.opt("--generated-at", "");

  const missing = [];
  if (!name) missing.push("--name");
  if (!revision) missing.push("--revision");
  if (!out) missing.push("--out");
  if (missing.length) {
    console.error(`${LABEL}: missing required argument(s): ${missing.join(", ")}\n\n${USAGE}`);
    process.exit(2);
  }

  const repositoryModel = requireBuilt(path.join(__dirname, "..", "dist", "public", "repository_model.js"), LABEL);
  const { version } = require(path.join(__dirname, "..", "package.json"));

  let result, packet;
  try {
    packet = repositoryModel.observeRepositoryModel({
      root: cli.root,
      repositoryName: name,
      sourceRevision: revision,
      producerVersion: version,
      ...(generatedAt ? { generatedAt } : {}),
    });
    result = repositoryModel.emitRepositoryModelBundle(packet, { outDir: out });
  } catch (error) {
    console.error(`${LABEL}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  console.log(`${LABEL}: OK`);
  console.log(`  bundle        ${result.bundleRoot}`);
  console.log(`  packet_id     ${result.packetId}`);
  console.log(`  semantic_hash ${result.semanticHash}`);
  console.log(`  artifacts     ${packet.payload.artifacts.length}`);
  console.log(`  evidence      ${packet.payload.evidence.length}`);
  console.log(`  diagnostics   ${packet.payload.diagnostics.length}`);
}

main();
