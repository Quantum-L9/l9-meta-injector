#!/usr/bin/env node
"use strict";
// Read-only observation of an arbitrary local source.
//
//   node scripts/local-source-cli.js <path> [--name NAME] [--out DIR] [options]
//
// The source may be a single file, an ordinary folder, an external-drive tree, a
// synced folder, or a ZIP archive. It does not have to be a Git repository, and
// it is never modified: archives are staged into tool-owned scratch outside the
// source tree, and nothing is written beside the source.
//
// Output layout under --out:
//   bundle/                        canonical Repository Model Packet bundle
//   local-source-manifest.json     acquisition manifest (never written in-source)
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LABEL = "local-source";
const USAGE = [
  "usage: local-source <path> [--name NAME] [--out DIR] [options]",
  "",
  "  <path>                     file, folder, external drive tree, or .zip to observe",
  "  --name NAME                canonical source name (default: basename of <path>)",
  "  --source-kind KIND         auto|file|directory|archive (default: auto)",
  "  --out DIR                  output directory (default: <tmpdir>/l9-local-source-out)",
  "  --generated-at ISO         timestamp recorded in the bundle (default: deterministic epoch)",
  "  --no-expand-archives       hash archives but do not observe their members",
  "  --no-interpret             skip the deterministic interpretation pass",
  "  --omit PATTERN             gitignore-style omit pattern (repeatable)",
  "  --omit-file PATH           load additional omit patterns from a file",
  "  --hash-max-bytes N         refuse to hash files above N bytes (default: no limit)",
  "",
  "archive budget (all optional; conservative defaults apply):",
  "  --max-archive-bytes N      largest archive file that will be staged",
  "  --max-members N            largest member count for one archive",
  "  --max-member-bytes N       largest uncompressed size for one member",
  "  --max-expanded-bytes N     largest total uncompressed size for one archive",
  "  --max-session-bytes N      largest total uncompressed size for the whole run",
  "  --max-compression-ratio N  largest uncompressed:compressed ratio",
  "  --max-archive-depth N      nested-archive depth ceiling",
  "",
  "The source is never modified. Archive members are observed as virtual",
  "artifacts named <archive>!/<member>; nothing is extracted beside the source.",
].join("\n");

function fail(message, code = 1) {
  console.error(`${LABEL}: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  if (argv.length === 0 || argv[0].startsWith("-")) {
    console.error(USAGE);
    process.exit(2);
  }
  const flag = (name) => argv.includes(name);
  const opt = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const optAll = (name) => {
    const out = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
    return out;
  };
  return { argv, flag, opt, optAll, target: argv[0] };
}

/** Parse a positive-integer budget flag, or exit with a precise message. */
function numericOpt(cli, name) {
  const raw = cli.opt(name, null);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative integer, got '${raw}'`, 2);
  return value;
}

function requireBuilt(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    fail(`run "npm run build" first (${error.message})`, 2);
    return undefined;
  }
}

function collectPolicy(cli) {
  const policy = {};
  const map = {
    maxArchiveCompressedBytes: "--max-archive-bytes",
    maxMemberCount: "--max-members",
    maxSingleMemberUncompressedBytes: "--max-member-bytes",
    maxTotalUncompressedBytesPerArchive: "--max-expanded-bytes",
    maxTotalUncompressedBytesPerSession: "--max-session-bytes",
    maxCompressionRatio: "--max-compression-ratio",
    maxNestedDepth: "--max-archive-depth",
  };
  for (const [key, flagName] of Object.entries(map)) {
    const value = numericOpt(cli, flagName);
    if (value !== undefined) policy[key] = value;
  }
  return policy;
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  const target = path.resolve(cli.target);
  if (!fs.existsSync(target)) fail(`path does not exist: ${target}`, 2);

  const repo = path.resolve(__dirname, "..");
  const model = requireBuilt(path.join(repo, "dist", "local_source_model.js"));
  const { version } = require(path.join(repo, "package.json"));
  const repositoryModel = requireBuilt(path.join(repo, "dist", "public", "repository_model.js"));

  const outDir = path.resolve(cli.opt("--out", path.join(os.tmpdir(), "l9-local-source-out")));
  const bundleDir = path.join(outDir, "bundle");
  const generatedAt = cli.opt("--generated-at", "");
  const hashMaxBytes = numericOpt(cli, "--hash-max-bytes");
  const sourceKind = cli.opt("--source-kind", "auto");
  const omitPatterns = cli.optAll("--omit");
  const omitFile = cli.opt("--omit-file", undefined);

  let result;
  try {
    result = model.observeLocalSourceModel({
      path: target,
      sourceKind,
      name: cli.opt("--name", ""),
      expandArchives: !cli.flag("--no-expand-archives"),
      interpret: !cli.flag("--no-interpret"),
      archivePolicy: collectPolicy(cli),
      ...(omitPatterns.length ? { omitPatterns } : {}),
      ...(omitFile !== undefined ? { omitFile } : {}),
      ...(hashMaxBytes !== undefined ? { hashMaxBytes } : {}),
      producerVersion: version,
      ...(generatedAt ? { generatedAt } : {}),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const { packet, observation } = result;
  try {
    const emitted = repositoryModel.emitRepositoryModelBundle(packet, {
      outDir: bundleDir,
      ...(generatedAt ? { generatedAt } : {}),
    });
    const manifest = model.buildLocalSourceManifest(observation, {
      // Operational only. Never part of any identity this package computes.
      observedAt: new Date().toISOString(),
    });
    const manifestPath = model.writeLocalSourceManifest(
      manifest,
      path.join(outDir, "local-source-manifest.json"),
      target,
    );

    const held = observation.archives.filter((archive) => !archive.expanded);
    const unsupportedEncodings = observation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "local-source.unsupported_encoding",
    ).length;
    const symlinks = observation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "local-source.symlink_not_traversed",
    ).length;

    console.log(`${LABEL}: OK`);
    console.log("  the source was NOT modified: no file was written, renamed, or removed under it");
    console.log(`  source_kind      ${observation.sourceKind}`);
    console.log(`  source_revision  ${observation.sourceRevision}`);
    console.log(`  snapshot_hash    ${observation.physicalSnapshotHash}`);
    console.log(`  archives         ${observation.archives.length} observed, ${held.length} held (not expanded)`);
    console.log(`  archive members  ${observation.virtualArtifacts.length} observed`);
    console.log(`  symlinks         ${symlinks} observed, 0 followed`);
    console.log(`  encodings        ${unsupportedEncodings} file(s) not valid UTF-8 (hashed, not interpreted)`);
    console.log(`  artifacts        ${packet.payload.artifacts.length}`);
    console.log(`  relationships    ${packet.payload.relationships.length}`);
    console.log(`  assertions       ${packet.payload.assertions.length}`);
    console.log(`  diagnostics      ${packet.payload.diagnostics.length}`);
    console.log(`  packet_id        ${emitted.packetId}`);
    console.log(`  semantic_hash    ${emitted.semanticHash}`);
    console.log(`  bundle           ${emitted.bundleRoot}`);
    console.log(`  manifest         ${manifestPath}`);
    for (const archive of held) {
      console.log(`  held: ${archive.sourcePath} — ${archive.holds.map((hold) => hold.code).join(", ")}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    observation.dispose();
  }
}

main();
