"use strict";
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "../..");
const CONTRACT_PATH = "docs/public-api-contract.json";
const ALLOWED_STABILITY = new Set(["stable", "experimental"]);

function isObject(value) { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }
function uniqueSorted(values) { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
function packageSubpath(subpath) { return subpath === "." ? "." : subpath; }
function importSpecifier(packageName, subpath) {
  if (subpath === ".") return packageName;
  return packageName + subpath.slice(1);
}
function sourceHasWildcardExport(source) {
  return /^\s*export\s+\*\s+from\s+/m.test(source);
}
function sourceRuntimeNames(source) {
  const names = [];
  const patterns = [
    /export\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["']/g,
    /export\s+(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g,
  ];
  let m;
  while ((m = patterns[0].exec(source))) {
    for (const part of m[1].split(",")) {
      const clean = part.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!clean || clean.startsWith("type ")) continue;
      const alias = clean.split(/\s+as\s+/).map((x) => x.trim());
      names.push(alias[1] || alias[0]);
    }
  }
  while ((m = patterns[1].exec(source))) names.push(m[1]);
  return uniqueSorted(names);
}
function sourceTypeNames(source) {
  const names = [];
  const re = /export\s+type\s*\{([\s\S]*?)\}\s*from\s*["'][^"']+["']/g;
  let m;
  while ((m = re.exec(source))) {
    for (const part of m[1].split(",")) {
      const clean = part.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!clean) continue;
      const alias = clean.split(/\s+as\s+/).map((x) => x.trim());
      names.push(alias[1] || alias[0]);
    }
  }
  return uniqueSorted(names);
}
function expectedExportsMap(contract) {
  const result = {};
  for (const entry of contract.entrypoints) {
    result[packageSubpath(entry.subpath)] = {
      types: `./${entry.types}`,
      require: `./${entry.runtime}`,
      default: `./${entry.runtime}`,
    };
  }
  result[contract.package_metadata_subpath] = "./package.json";
  return result;
}
function expectedTypesVersions(contract) {
  const mapping = {};
  for (const entry of contract.entrypoints) {
    if (entry.subpath === ".") continue;
    mapping[entry.subpath.slice(2)] = [entry.types];
  }
  return { "*": mapping };
}
function validateContract(contract, repoRoot=REPO) {
  const errors=[];
  if (!isObject(contract)) return ["public API contract must be an object"];
  const allowedRoot = new Set(["schema","repository","package_name","package_version","policy","entrypoints","package_metadata_subpath","approved_shared_runtime_exports","forbidden_root_runtime_exports","forbidden_deep_import_examples","caller_obligations_for_experimental_composition"]);
  for (const key of Object.keys(contract)) if (!allowedRoot.has(key)) errors.push(`contract.${key} is not allowed`);
  for (const key of ["schema","repository","package_name","package_version","policy","entrypoints","package_metadata_subpath","approved_shared_runtime_exports","forbidden_root_runtime_exports","forbidden_deep_import_examples","caller_obligations_for_experimental_composition"]) if (!(key in contract)) errors.push(`contract.${key} is required`);
  if (contract.schema !== "l9.public-api-contract/v1") errors.push("contract.schema is invalid");
  if (contract.repository !== "Quantum-L9/l9-meta-injector") errors.push("contract.repository is invalid");
  if (contract.package_name !== "l9-meta-injector") errors.push("contract.package_name is invalid");
  if (!/^\d+\.\d+\.\d+$/.test(contract.package_version || "")) errors.push("contract.package_version must be semver");
  if (!isObject(contract.policy) || contract.policy.root_model !== "orchestration_first" || contract.policy.deep_imports !== "deny_unlisted" || contract.policy.runtime_and_declarations_are_separate_contracts !== true) errors.push("contract.policy is invalid");
  if (!Array.isArray(contract.entrypoints) || contract.entrypoints.length === 0) errors.push("contract.entrypoints must be non-empty");
  const subpaths=[];
  for (const [i, entry] of (contract.entrypoints || []).entries()) {
    const label=`contract.entrypoints[${i}]`;
    if (!isObject(entry)) { errors.push(`${label} must be an object`); continue; }
    const keys=["subpath","stability","source","runtime","types","runtime_exports","declaration_exports"];
    for (const key of keys) if (!(key in entry)) errors.push(`${label}.${key} is required`);
    for (const key of Object.keys(entry)) if (!keys.includes(key)) errors.push(`${label}.${key} is not allowed`);
    if (typeof entry.subpath !== "string" || !(entry.subpath === "." || entry.subpath.startsWith("./"))) errors.push(`${label}.subpath is invalid`);
    else subpaths.push(entry.subpath);
    if (!ALLOWED_STABILITY.has(entry.stability)) errors.push(`${label}.stability is invalid`);
    for (const key of ["source","runtime","types"]) {
      if (typeof entry[key] !== "string" || entry[key].startsWith("/") || entry[key].includes("..")) errors.push(`${label}.${key} is unsafe`);
    }
    for (const key of ["runtime_exports","declaration_exports"]) {
      if (!Array.isArray(entry[key]) || entry[key].some((x)=>typeof x!=="string" || !/^[A-Za-z_$][\w$]*$/.test(x))) errors.push(`${label}.${key} must contain identifiers`);
      else if (JSON.stringify(entry[key]) !== JSON.stringify(uniqueSorted(entry[key]))) errors.push(`${label}.${key} must be unique and sorted`);
    }
    const sourcePath=path.join(repoRoot,entry.source || "");
    if (!fs.existsSync(sourcePath)) errors.push(`${label}.source does not exist: ${entry.source}`);
    else {
      const source=fs.readFileSync(sourcePath,"utf8");
      if (sourceHasWildcardExport(source)) errors.push(`${entry.source} contains a wildcard export`);
      const actualRuntime=sourceRuntimeNames(source);
      const actualTypes=sourceTypeNames(source);
      if (JSON.stringify(actualRuntime)!==JSON.stringify(entry.runtime_exports)) errors.push(`${entry.source} runtime export inventory differs: expected ${JSON.stringify(entry.runtime_exports)}, got ${JSON.stringify(actualRuntime)}`);
      if (JSON.stringify(actualTypes)!==JSON.stringify(entry.declaration_exports)) errors.push(`${entry.source} declaration export inventory differs: expected ${JSON.stringify(entry.declaration_exports)}, got ${JSON.stringify(actualTypes)}`);
    }
  }
  if (new Set(subpaths).size !== subpaths.length) errors.push("contract entrypoint subpaths must be unique");
  if (!subpaths.includes(".")) errors.push("contract must define the root entrypoint");
  const forbidden=contract.forbidden_root_runtime_exports;
  if (!Array.isArray(forbidden) || forbidden.some((x)=>typeof x!=="string")) errors.push("contract.forbidden_root_runtime_exports must be strings");
  const root=(contract.entrypoints || []).find((e)=>e.subpath===".");
  if (root && Array.isArray(forbidden)) for (const name of forbidden) if (root.runtime_exports.includes(name)) errors.push(`forbidden root runtime export is present: ${name}`);
  return errors;
}
function validatePackageAgainstContract(pkg, contract) {
  const errors=[];
  if (pkg.name !== contract.package_name) errors.push("package name differs from API contract");
  if (pkg.version !== contract.package_version) errors.push("package version differs from API contract");
  const expected=expectedExportsMap(contract);
  if (JSON.stringify(pkg.exports)!==JSON.stringify(expected)) errors.push("package exports map differs from API contract");
  const expectedTypes=expectedTypesVersions(contract);
  if (JSON.stringify(pkg.typesVersions)!==JSON.stringify(expectedTypes)) errors.push("package typesVersions differs from API contract");
  if (pkg.main !== contract.entrypoints.find((e)=>e.subpath===".").runtime) errors.push("package main differs from root runtime");
  if (pkg.types !== contract.entrypoints.find((e)=>e.subpath===".").types) errors.push("package types differs from root declarations");
  return errors;
}
function validateRuntimeModule(moduleValue, entry) {
  const actual=Object.keys(moduleValue).sort((a, b) => a.localeCompare(b));
  const expected=[...entry.runtime_exports].sort((a, b) => a.localeCompare(b));
  return JSON.stringify(actual)===JSON.stringify(expected) ? [] : [`${entry.subpath} runtime exports differ: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`];
}
function validateRepository(repoRoot=REPO) {
  const contract=readJson(path.join(repoRoot,CONTRACT_PATH));
  const pkg=readJson(path.join(repoRoot,"package.json"));
  return [...validateContract(contract,repoRoot),...validatePackageAgainstContract(pkg,contract)];
}
module.exports={REPO,CONTRACT_PATH,readJson,uniqueSorted,importSpecifier,sourceRuntimeNames,sourceTypeNames,expectedExportsMap,expectedTypesVersions,validateContract,validatePackageAgainstContract,validateRuntimeModule,validateRepository};
