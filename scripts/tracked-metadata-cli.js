#!/usr/bin/env node
"use strict";

// This adapter selects the versioned producer operation; it owns no carrier policy,
// identity compiler, index serializer, source annotation, or recovery engine.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { parseOptionArgv, CliArgsError } = require("./lib/cli-args");
const { hasControlChar, isWithin, resolveExistingContainedDirectory } = require("./lib/operation-dispatch");

const TRACKED_MODES = Object.freeze(["tracked-coverage", "tracked-check", "tracked-apply"]);
const TRACKED_HELP_TEXT = `\nTracked metadata v2 (explicit, index-only candidate contract):\n  l9-meta-injector tracked-coverage <root> --repository <owner/repo> --revision <commit> [--out <external-json>]\n  l9-meta-injector tracked-check <root> --repository <owner/repo> --revision <commit> [--migrate-v1] [--out <external-json>]\n  l9-meta-injector tracked-apply <root> --repository <owner/repo> --revision <commit> [--migrate-v1] [--writer-ref <ref>] [--out <external-json>]\n  All modes: [--timeout-ms <positive-integer>] [--max-output-bytes <positive-integer>]\n  Coverage never reads subject payloads. Check/apply inspect repository authority.\n  Sources are never rewritten. Apply writes only the canonical index transactionally.\n  Roots are relative and contained; exports must be outside the source repository.\n`;

function text(name, value) {
  if (typeof value !== "string" || value.trim() === "" || hasControlChar(value)) {
    throw new CliArgsError(`${name} requires nonempty text without control characters`);
  }
  return value;
}

function positiveInteger(name, value) {
  if (value === undefined) return undefined;
  if (!/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new CliArgsError(`${name} requires a positive safe integer`);
  }
  return Number(value);
}

function parseTrackedArguments(argv, cwd = process.cwd()) {
  const [mode, rootArgument, ...options] = argv;
  if (!TRACKED_MODES.includes(mode)) throw new CliArgsError("unknown tracked operation");
  if (!rootArgument || rootArgument.startsWith("-")) throw new CliArgsError("tracked operation requires positional <root>");
  const parsed = parseOptionArgv(options, {
    boolean: mode === "tracked-coverage" ? [] : ["--migrate-v1"],
    value: ["--repository", "--revision", "--out", "--timeout-ms", "--max-output-bytes", ...(mode === "tracked-apply" ? ["--writer-ref"] : [])],
    repeatable: [],
  });
  const root = resolveExistingContainedDirectory(fs.realpathSync(cwd), rootArgument, "root");
  const repositoryId = text("--repository", parsed.values.get("--repository"));
  const revision = text("--revision", parsed.values.get("--revision"));
  const exportPath = parsed.values.has("--out") ? text("--out", parsed.values.get("--out")) : undefined;
  const expectedWriterRef = parsed.values.has("--writer-ref") ? text("--writer-ref", parsed.values.get("--writer-ref")) : undefined;
  if (exportPath) validateExternalReportPath(root, exportPath);
  return {
    mode, root, repositoryId, revision, exportPath, expectedWriterRef,
    migrateV1: parsed.values.get("--migrate-v1") === "true",
    timeoutMs: positiveInteger("--timeout-ms", parsed.values.get("--timeout-ms")),
    maxOutputBytes: positiveInteger("--max-output-bytes", parsed.values.get("--max-output-bytes")),
  };
}

/** Input admission only: invalid report requests fail before an index operation. */
function validateExternalReportPath(root, requested) {
  const source = fs.realpathSync(root);
  const destination = path.resolve(text("--out", requested));
  if (isWithin(source, destination)) throw new CliArgsError("report export must be outside the source repository");
  const parent = path.dirname(destination);
  const actualParent = fs.realpathSync(parent);
  if (actualParent !== parent || isWithin(source, actualParent)) {
    throw new CliArgsError("report export ancestry must be canonical and outside the source repository");
  }
  const name = path.basename(destination);
  if (name === "." || name === ".." || hasControlChar(name)) throw new CliArgsError("invalid report filename");
  try {
    fs.lstatSync(destination);
    throw new CliArgsError("report destination must be absent; choose a new external filename");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!fs.existsSync("/proc/self/fd")) throw new CliArgsError("descriptor-anchored report export is unavailable on this platform; use the in-memory API");
  return { source, destination, parent, actualParent, name };
}

/** A source-safe report export, not a second index writer. Parent must already exist. */
function writeExternalReport(root, requested, bytes) {
  const { source, destination, parent, actualParent, name } = validateExternalReportPath(root, requested);
  // Pin the parent directory rather than reopen a symlink-swappable pathname.
  // Platforms without this descriptor path fail before creating a report; the
  // in-memory API remains portable and never needs an export destination.
  const directory = fs.openSync(parent, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  const anchored = `/proc/self/fd/${directory}`;
  let temporary;
  let installed = false;
  let writtenStat;
  const anchoredTarget = path.join(anchored, name);
  try {
    if (!fs.existsSync(anchored)) throw new CliArgsError("descriptor-anchored report export is unavailable on this platform; use the in-memory API");
    if (fs.realpathSync(anchored) !== actualParent) throw new CliArgsError("report parent changed during admission");
    temporary = path.join(anchored, `.l9-coverage-${crypto.randomBytes(12).toString("hex")}.tmp`);
    const fd = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
      fs.writeFileSync(fd, bytes, "utf8");
      fs.fsyncSync(fd);
      writtenStat = fs.fstatSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    const currentParent = fs.realpathSync(anchored);
    if (currentParent !== actualParent || isWithin(source, currentParent)) throw new CliArgsError("report parent moved during export");
    // Atomic no-replace installation: a raced-in file, directory or symlink holds.
    fs.linkSync(temporary, anchoredTarget);
    installed = true;
    if (fs.realpathSync(anchored) !== actualParent) throw new CliArgsError("report parent moved at export commit");
    fs.fsyncSync(directory);
  } catch (error) {
    if (installed && writtenStat) {
      const actual = fs.lstatSync(anchoredTarget);
      if (actual.dev === writtenStat.dev && actual.ino === writtenStat.ino) fs.unlinkSync(anchoredTarget);
    }
    throw error;
  } finally {
    try {
      if (temporary) {
        try { fs.unlinkSync(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    } finally {
      fs.closeSync(directory);
    }
  }
  return destination;
}

async function main(argv = process.argv.slice(2)) {
  if (argv.length === 1 && ["--help", "-h"].includes(argv[0])) {
    process.stdout.write(TRACKED_HELP_TEXT);
    return 0;
  }
  try {
    const config = parseTrackedArguments(argv);
    // The public experimental facade is the only composition surface used here.
    const producer = require("../dist/public/advanced.js");
    const input = {
      root: config.root, revision: config.revision, repositoryId: config.repositoryId,
      contract: "l9.tracked-carrier-policy/v2",
      producerVersion: require("../package.json").version,
      ...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
      ...(config.maxOutputBytes === undefined ? {} : { maxOutputBytes: config.maxOutputBytes }),
    };
    let compilation, result;
    if (config.mode === "tracked-coverage") {
      compilation = producer.runTrackedCoverage(input);
      result = { mode: config.mode, passed: true, repositoryMutated: false, sourceMutated: false, authorityInspection: "not_performed" };
    } else if (config.mode === "tracked-check") {
      result = await producer.runTrackedCheckAsync({ ...input, migrateV1: config.migrateV1 });
      compilation = result.metadataIndex;
    } else {
      result = await producer.runTrackedApplyAsync({ ...input, migrateV1: config.migrateV1, ...(config.expectedWriterRef ? { expectedWriterRef: config.expectedWriterRef } : {}) });
      compilation = result.metadataIndex;
    }
    const totals = compilation.coverage.totals;
    // The external export is not part of the source carrier transaction. An
    // export failure must not hide a successful index commit from the caller.
    process.stdout.write(`${config.mode}: passed=${result.passed} tree_leaves=${totals.tree_leaves} indexed=${totals.indexed} protected=${totals.protected} unsupported=${totals.unsupported} repository_mutated=${result.repositoryMutated} source_mutated=false\n`);
    if (config.exportPath) {
      const report = config.mode === "tracked-coverage" ? compilation.coverageBytes : `${JSON.stringify({
        operation: { mode: result.mode, passed: result.passed, repositoryMutated: result.repositoryMutated, sourceMutated: result.sourceMutated, authorityInspection: result.authorityInspection },
        authorityConflicts: result.authorityConflicts, drift: result.drift,
        migrationEvidence: result.migrationEvidence,
        coverage: compilation.coverage,
      }, null, 2)}\n`;
      writeExternalReport(config.root, config.exportPath, report);
    }
    if (result.drift?.length) process.stderr.write(`tracked-metadata: ${JSON.stringify(result.drift)}\n`);
    if (result.authorityConflicts?.length) process.stderr.write(`tracked-metadata: ${JSON.stringify(result.authorityConflicts)}\n`);
    return result.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`tracked-metadata: failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

if (require.main === module) main().then(code => { process.exitCode = code; });
module.exports = { main, parseTrackedArguments, writeExternalReport, TRACKED_MODES, TRACKED_HELP_TEXT };
