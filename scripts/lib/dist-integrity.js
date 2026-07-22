"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

function fail(message) {
  const error = new Error(message);
  error.code = "L9_DIST_INTEGRITY";
  throw error;
}
function posix(value) { return value.split(path.sep).join("/"); }
function isPlainObject(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function listRegularFiles(root) {
  const base = path.resolve(root);
  if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) fail(`directory missing: ${base}`);
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const stat = fs.lstatSync(abs);
      const rel = posix(path.relative(base, abs));
      if (stat.isSymbolicLink()) fail(`symlink is not allowed: ${rel}`);
      if (stat.isDirectory()) walk(abs);
      else if (stat.isFile()) files.push(rel);
      else fail(`unsupported filesystem entry: ${rel}`);
    }
  }
  walk(base);
  return files.sort();
}
function compareDirectories(committedDir, generatedDir) {
  const committed = listRegularFiles(committedDir);
  const generated = listRegularFiles(generatedDir);
  const committedSet = new Set(committed);
  const generatedSet = new Set(generated);
  const missingFromCommitted = generated.filter((p) => !committedSet.has(p));
  const staleInCommitted = committed.filter((p) => !generatedSet.has(p));
  const changed = [];
  for (const rel of committed.filter((p) => generatedSet.has(p))) {
    const committedSha256 = sha256File(path.join(committedDir, rel));
    const generatedSha256 = sha256File(path.join(generatedDir, rel));
    if (committedSha256 !== generatedSha256) changed.push({ path: rel, committedSha256, generatedSha256 });
  }
  return {
    ok: missingFromCommitted.length === 0 && staleInCommitted.length === 0 && changed.length === 0,
    committedFiles: committed.length,
    generatedFiles: generated.length,
    missingFromCommitted,
    staleInCommitted,
    changed,
  };
}
function run(command, args, options = {}) {
  return cp.spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}
function gitStatusUnder(repo, rel) {
  const result = run("git", ["status", "--porcelain=v1", "--untracked-files=all", "--", rel], { cwd: repo });
  if (result.status !== 0) fail(`git status failed: ${result.stderr || result.stdout}`);
  return result.stdout.split(/\r?\n/).filter(Boolean);
}
function resolveTsc(repo) {
  if (process.env.L9_TSC) return path.resolve(process.env.L9_TSC);
  const name = process.platform === "win32" ? "tsc.cmd" : "tsc";
  const local = path.join(repo, "node_modules", ".bin", name);
  if (!fs.existsSync(local)) fail(`repository-pinned TypeScript compiler missing: ${local}; run npm ci`);
  return local;
}
function copyBuildInputs(repo, sandbox) {
  fs.cpSync(path.join(repo, "src"), path.join(sandbox, "src"), { recursive: true, dereference: false });
  fs.copyFileSync(path.join(repo, "tsconfig.json"), path.join(sandbox, "tsconfig.json"));
  if (fs.existsSync(path.join(repo, "package.json"))) fs.copyFileSync(path.join(repo, "package.json"), path.join(sandbox, "package.json"));
  const sourceModules = path.join(repo, "node_modules");
  if (!fs.existsSync(sourceModules)) fail("node_modules missing; run npm ci before distribution validation");
  fs.symlinkSync(sourceModules, path.join(sandbox, "node_modules"), process.platform === "win32" ? "junction" : "dir");
}
function checkDistSync(repoRoot) {
  const repo = path.resolve(repoRoot);
  const report = {
    schema: "l9.dist-integrity-report/v1",
    repositoryRoot: repo,
    status: "failed",
    preexistingDistStatus: [],
    postBuildDistStatus: [],
    build: null,
    comparison: null,
  };
  report.preexistingDistStatus = gitStatusUnder(repo, "dist");
  if (report.preexistingDistStatus.length) {
    report.reason = "dist is dirty before validation";
    return report;
  }
  for (const rel of ["src", "dist", "tsconfig.json"]) {
    if (!fs.existsSync(path.join(repo, rel))) { report.reason = `required build input missing: ${rel}`; return report; }
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "l9-dist-integrity-"));
  try {
    copyBuildInputs(repo, temp);
    const tsc = resolveTsc(repo);
    const build = run(tsc, ["-p", "tsconfig.json"], { cwd: temp, env: { CI: "true" } });
    report.build = { command: `${tsc} -p tsconfig.json`, exitCode: build.status, stdout: build.stdout, stderr: build.stderr };
    if (build.status !== 0) { report.reason = "isolated TypeScript build failed"; return report; }
    const generated = path.join(temp, "dist");
    if (!fs.existsSync(generated)) { report.reason = "isolated build produced no dist directory"; return report; }
    report.comparison = compareDirectories(path.join(repo, "dist"), generated);
    report.postBuildDistStatus = gitStatusUnder(repo, "dist");
    if (report.postBuildDistStatus.length) { report.reason = "isolated validation changed repository dist"; return report; }
    if (!report.comparison.ok) { report.reason = "committed dist differs from isolated source build"; return report; }
    report.status = "passed";
    report.reason = null;
    return report;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
function exactKeys(value, keys, label, errors) {
  if (!isPlainObject(value)) { errors.push(`${label} must be an object`); return; }
  const expected = new Set(keys);
  for (const key of keys) if (!(key in value)) errors.push(`${label}.${key} is required`);
  for (const key of Object.keys(value)) if (!expected.has(key)) errors.push(`${label}.${key} is not allowed`);
}
function stringArray(value, label, errors) {
  if (!Array.isArray(value) || value.length === 0 || value.some((x) => typeof x !== "string" || !x)) errors.push(`${label} must be a non-empty string array`);
  else if (new Set(value).size !== value.length) errors.push(`${label} contains duplicates`);
}
function validatePackageContract(contract) {
  const errors = [];
  exactKeys(contract, ["schema","repository","package_name","entrypoints","required_files","allowed_top_level","forbidden_paths","forbidden_prefixes","dist_policy","public_schema_policy","consumer_tests"], "packageContract", errors);
  if (!isPlainObject(contract)) return errors;
  if (contract.schema !== "l9.package-contract/v1") errors.push("packageContract.schema is invalid");
  if (contract.repository !== "Quantum-L9/l9-meta-injector") errors.push("packageContract.repository is invalid");
  if (contract.package_name !== "l9-meta-injector") errors.push("packageContract.package_name is invalid");
  exactKeys(contract.entrypoints, ["runtime","types"], "packageContract.entrypoints", errors);
  exactKeys(contract.consumer_tests, ["runtime","types","tsconfig"], "packageContract.consumer_tests", errors);
  for (const [obj, label] of [[contract.entrypoints,"entrypoints"],[contract.consumer_tests,"consumer_tests"]]) {
    if (isPlainObject(obj)) for (const [key, value] of Object.entries(obj)) if (typeof value !== "string" || !value) errors.push(`packageContract.${label}.${key} must be a non-empty string`);
  }
  for (const key of ["required_files","allowed_top_level","forbidden_paths","forbidden_prefixes"]) stringArray(contract[key], `packageContract.${key}`, errors);
  for (const key of ["dist_policy","public_schema_policy"]) if (typeof contract[key] !== "string" || !contract[key]) errors.push(`packageContract.${key} must be a non-empty string`);
  if (Array.isArray(contract.forbidden_prefixes) && contract.forbidden_prefixes.some((p) => !p.endsWith("/"))) errors.push("packageContract.forbidden_prefixes entries must end with /");
  return errors;
}
function validatePackedFiles(packedPaths, contract, repositoryDistPaths) {
  const errors = [...validatePackageContract(contract)];
  const paths = packedPaths.map((p) => p.replace(/\\/g, "/"));
  if (new Set(paths).size !== paths.length) errors.push("packed file list contains duplicates");
  const set = new Set(paths);
  for (const rel of contract.required_files || []) if (!set.has(rel)) errors.push(`required packed file missing: ${rel}`);
  for (const rel of contract.forbidden_paths || []) if (set.has(rel)) errors.push(`forbidden packed file present: ${rel}`);
  for (const prefix of contract.forbidden_prefixes || []) for (const rel of paths) if (rel.startsWith(prefix)) errors.push(`forbidden packed prefix present: ${rel}`);
  const allowed = new Set(contract.allowed_top_level || []);
  for (const rel of paths) {
    const top = rel.includes("/") ? rel.split("/", 1)[0] : rel;
    if (!allowed.has(top) && !allowed.has(rel)) errors.push(`packed top-level path is not allowed: ${rel}`);
  }
  const expectedDist = repositoryDistPaths.map((p) => p.startsWith("dist/") ? p : `dist/${p}`).sort();
  const actualDist = paths.filter((p) => p.startsWith("dist/")).sort();
  const expectedSet = new Set(expectedDist), actualSet = new Set(actualDist);
  for (const rel of expectedDist) if (!actualSet.has(rel)) errors.push(`packed dist file missing: ${rel}`);
  for (const rel of actualDist) if (!expectedSet.has(rel)) errors.push(`packed dist contains unexpected file: ${rel}`);
  return [...new Set(errors)];
}
function parseNpmPackJson(output) {
  const text = String(output).trim();
  const starts = [];
  for (let i = 0; i < text.length; i++) if (text[i] === "[") starts.push(i);
  for (let i = starts.length - 1; i >= 0; i--) {
    try {
      const value = JSON.parse(text.slice(starts[i]));
      if (Array.isArray(value) && value[0] && typeof value[0].filename === "string") return value;
    } catch { /* keep scanning */ }
  }
  fail("could not parse npm pack --json output");
}
function stableJson(value) { return JSON.stringify(value, null, 2) + "\n"; }
module.exports = {
  fail, posix, sha256File, listRegularFiles, compareDirectories, run, gitStatusUnder,
  resolveTsc, checkDistSync, validatePackageContract, validatePackedFiles,
  parseNpmPackJson, stableJson,
};
