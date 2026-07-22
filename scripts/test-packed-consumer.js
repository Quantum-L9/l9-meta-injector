#!/usr/bin/env node
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const {
  run, listRegularFiles, validatePackageContract, validatePackedFiles,
  parseNpmPackJson, resolveTsc, stableJson,
} = require("./lib/dist-integrity");

const REPO = path.resolve(__dirname, "..");
const KEEP = process.argv.includes("--keep-temp");
const JSON_MODE = process.argv.includes("--json");
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
function die(message, details) {
  const error = new Error(message);
  error.details = details;
  throw error;
}
function command(command, args, cwd, env = {}) {
  const result = run(command, args, { cwd, env });
  if (result.status !== 0) die(`${command} ${args.join(" ")} failed`, result);
  return result;
}
function sha256(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); }
function copyFixture(target) {
  const source = path.join(REPO, "fixtures", "package-consumer");
  fs.cpSync(source, target, { recursive: true });
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "l9-packed-consumer-"));
const report = {
  schema: "l9.packed-consumer-report/v1",
  status: "failed",
  packageName: null,
  packageVersion: null,
  tarball: null,
  tarballSha256: null,
  packedFileCount: 0,
  runtime: null,
  declarations: null,
};
try {
  const contract = JSON.parse(fs.readFileSync(path.join(REPO, "docs", "package-contract.json"), "utf8"));
  const contractErrors = validatePackageContract(contract);
  if (contractErrors.length) die("package contract is invalid", contractErrors);
  const packageJson = JSON.parse(fs.readFileSync(path.join(REPO, "package.json"), "utf8"));
  report.packageName = packageJson.name;
  report.packageVersion = packageJson.version;
  if (contract.package_name !== packageJson.name) die("package contract name disagrees with package.json");
  if (contract.entrypoints.runtime !== packageJson.main || contract.entrypoints.types !== packageJson.types) die("package contract entrypoints disagree with package.json");

  const pack = command(npm, ["pack", "--json", "--pack-destination", temp], REPO, { npm_config_loglevel: "silent" });
  const packed = parseNpmPackJson(pack.stdout);
  const metadata = packed[0];
  const tarball = path.join(temp, metadata.filename);
  if (!fs.existsSync(tarball)) die(`npm reported a missing tarball: ${metadata.filename}`);
  const packedPaths = (metadata.files || []).map((item) => item.path);
  const distPaths = listRegularFiles(path.join(REPO, "dist")).map((rel) => `dist/${rel}`);
  const packageErrors = validatePackedFiles(packedPaths, contract, distPaths);
  if (packageErrors.length) die("packed file contract failed", packageErrors);
  report.tarball = metadata.filename;
  report.tarballSha256 = sha256(tarball);
  report.packedFileCount = packedPaths.length;

  const consumer = path.join(temp, "consumer");
  copyFixture(consumer);
  command(npm, ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--package-lock=false", tarball], consumer, { npm_config_loglevel: "silent" });
  const runtime = command(process.execPath, ["runtime.cjs"], consumer);
  report.runtime = JSON.parse(runtime.stdout.trim());

  const tsc = resolveTsc(REPO);
  const typeRoots = path.join(REPO, "node_modules", "@types");
  const typecheck = command(tsc, ["-p", "tsconfig.json", "--typeRoots", typeRoots], consumer);
  report.declarations = { command: `${tsc} -p tsconfig.json`, exitCode: typecheck.status };
  const installed = JSON.parse(fs.readFileSync(path.join(consumer, "node_modules", packageJson.name, "package.json"), "utf8"));
  if (installed.version !== packageJson.version) die("installed package version disagrees with source package.json");
  report.status = "passed";
  if (JSON_MODE) process.stdout.write(stableJson(report));
  else console.log(`packed-consumer: OK (${report.tarball}, sha256=${report.tarballSha256}, files=${report.packedFileCount})`);
} catch (error) {
  if (JSON_MODE) {
    report.reason = error && error.message ? error.message : String(error);
    report.details = error && error.details ? error.details : null;
    process.stdout.write(stableJson(report));
  } else {
    console.error(`packed-consumer: FAILED: ${error && error.message ? error.message : error}`);
    if (error && error.details) console.error(typeof error.details === "string" ? error.details : JSON.stringify(error.details, null, 2));
    if (KEEP) console.error(`temporary directory retained: ${temp}`);
  }
  process.exitCode = 1;
} finally {
  if (!KEEP) fs.rmSync(temp, { recursive: true, force: true });
}
