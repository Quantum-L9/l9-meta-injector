"use strict";

const fs = require("node:fs");
const path = require("node:path");

const OPERATION_MODES = Object.freeze(["inventory", "check", "apply", "skills"]);
const LEGACY_OPERATION_ALIASES = Object.freeze({ pipeline: "apply" });
const CONTROL_RE = /[\u0000\r\n]/;

class ActionInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "ActionInputError";
    this.code = "L9_ACTION_INPUT_INVALID";
  }
}

function fail(message) {
  throw new ActionInputError(message);
}

function assertText(name, value, options = {}) {
  const { allowEmpty = false } = options;
  if (typeof value !== "string") fail(`${name} must be a string`);
  if (CONTROL_RE.test(value)) fail(`${name} contains a forbidden control character`);
  if (!allowEmpty && value.trim().length === 0) fail(`${name} must not be empty`);
  return value;
}

function parseBoolean(name, raw, defaultValue) {
  const value = raw === undefined || raw === null ? "" : String(raw).trim();
  if (value === "") return defaultValue;
  if (value === "true") return true;
  if (value === "false") return false;
  fail(`${name} must be exactly 'true' or 'false', got '${value}'`);
}

function parseNumber(name, raw, defaultValue, predicate, expectation) {
  const value = raw === undefined || raw === null || String(raw).trim() === ""
    ? defaultValue
    : Number(String(raw).trim());
  if (!Number.isFinite(value) || !predicate(value)) {
    fail(`${name} must be ${expectation}, got '${raw}'`);
  }
  return value;
}

function resolveMode(raw) {
  const requested = String(raw ?? "").trim();
  if (OPERATION_MODES.includes(requested)) return { requested, mode: requested, warnings: [] };
  if (Object.prototype.hasOwnProperty.call(LEGACY_OPERATION_ALIASES, requested)) {
    const mode = LEGACY_OPERATION_ALIASES[requested];
    return {
      requested,
      mode,
      warnings: [`operation mode '${requested}' is deprecated; use '${mode}'`],
    };
  }
  fail(`unsupported operation mode '${requested || "<empty>"}'; expected one of ${OPERATION_MODES.join(", ")}`);
}

function isWithin(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}


function assertNotGitInternals(parent, candidate, label) {
  const rel = path.relative(parent, candidate).split(path.sep);
  if (rel[0] === ".git") fail(`${label} must not target Git internal state`);
}

function realDirectory(label, candidate) {
  let resolved;
  try {
    resolved = fs.realpathSync(candidate);
  } catch (error) {
    fail(`${label} does not exist or cannot be resolved: ${candidate}`);
  }
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    fail(`${label} cannot be inspected: ${resolved}`);
  }
  if (!stat.isDirectory()) fail(`${label} must be a directory: ${resolved}`);
  return resolved;
}

function rejectAbsolute(label, input) {
  if (path.isAbsolute(input)) fail(`${label} must be relative, got absolute path '${input}'`);
}

function resolveExistingContainedDirectory(parent, input, label) {
  assertText(label, input);
  rejectAbsolute(label, input);
  const lexical = path.resolve(parent, input);
  if (!isWithin(parent, lexical)) fail(`${label} escapes its containment root: ${input}`);
  assertNotGitInternals(parent, lexical, label);
  const actual = realDirectory(label, lexical);
  if (!isWithin(parent, actual)) fail(`${label} resolves outside its containment root: ${input}`);
  return actual;
}

function nearestExistingAncestor(candidate) {
  let cursor = candidate;
  while (!fs.existsSync(cursor)) {
    const next = path.dirname(cursor);
    if (next === cursor) break;
    cursor = next;
  }
  return cursor;
}

function resolveFutureContainedPath(parent, input, label) {
  assertText(label, input);
  rejectAbsolute(label, input);
  const lexical = path.resolve(parent, input);
  if (!isWithin(parent, lexical)) fail(`${label} escapes its containment root: ${input}`);
  if (lexical === parent) fail(`${label} must be a child path, not the containment root itself`);
  assertNotGitInternals(parent, lexical, label);

  const ancestor = nearestExistingAncestor(lexical);
  const actualAncestor = realDirectory(`${label} ancestor`, ancestor);
  if (!isWithin(parent, actualAncestor)) {
    fail(`${label} traverses a symlink outside its containment root: ${input}`);
  }

  if (fs.existsSync(lexical)) {
    const actual = fs.realpathSync(lexical);
    if (!isWithin(parent, actual)) fail(`${label} resolves outside its containment root: ${input}`);
    if (!fs.statSync(actual).isDirectory()) fail(`${label} must be a directory path: ${input}`);
  }
  return lexical;
}

function parseCsvPatterns(raw) {
  const value = String(raw ?? "");
  if (value === "") return [];
  if (CONTROL_RE.test(value)) fail("omit contains a forbidden control character");
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function parseRepeatedValues(raw) {
  if (raw === undefined || raw === null || raw === "") return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return values.map((item) => assertText("repeated option", String(item)));
}

function assertNamespaceGlob(pair) {
  const value = assertText("namespace-glob", pair);
  const index = value.indexOf("=");
  if (index < 1 || index === value.length - 1) {
    fail(`namespace-glob '${value}' must use glob=namespace`);
  }
  return value;
}

function sanitizeSegment(value, fallback) {
  const clean = String(value ?? "").replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return clean || fallback;
}

function enforceModeRules(config) {
  const { mode } = config;
  if ((mode === "check" || mode === "apply") && config.authority.length === 0) {
    fail(`${mode} requires an explicit authority input; no repository-generic authority is assumed`);
  }
  if (mode === "check") {
    if (config.dryRun === false) fail("check is intrinsically read-only; dry-run=false is forbidden");
    if (config.failOnIssues === false) fail("check is a drift gate; fail-on-issues=false is forbidden");
    if (config.llmEnabled) fail("check forbids LLM assistance because expected state must be deterministic");
  }
  if (mode === "apply" && config.dryRun) {
    fail("apply does not accept dry-run=true; use check for read-only drift evaluation");
  }
  if ((mode === "inventory" || mode === "skills") && config.failOnIssues === false) {
    fail(`fail-on-issues is not supported for ${mode}`);
  }
  if (config.llmEnabled && mode !== "apply" && mode !== "skills") {
    fail(`LLM assistance is not supported for ${mode}`);
  }
  if (config.llmEnabled) {
    if (!config.llmBaseUrl || !config.llmModel || !config.llmApiKey) {
      fail("llm=true requires llm-base-url, llm-model, and llm-api-key");
    }
    let url;
    try { url = new URL(config.llmBaseUrl); }
    catch { fail("llm-base-url must be an absolute URL"); }
    if (url.protocol !== "https:" && !config.llmAllowInsecure) {
      fail("non-https llm-base-url requires llm-allow-insecure=true");
    }
  }
}

function normalizeEnvironment(rawEnv) {
  const env = rawEnv ?? process.env;
  const workspace = realDirectory("GITHUB_WORKSPACE", assertText("GITHUB_WORKSPACE", String(env.GITHUB_WORKSPACE ?? "")));
  const actionPath = realDirectory("GITHUB_ACTION_PATH", assertText("GITHUB_ACTION_PATH", String(env.GITHUB_ACTION_PATH ?? "")));
  const modeResolution = resolveMode(env.L9_INPUT_MODE);
  const rootInput = String(env.L9_INPUT_ROOT ?? ".").trim() || ".";
  const targetRoot = resolveExistingContainedDirectory(workspace, rootInput, "root");
  const outInput = String(env.L9_INPUT_OUT ?? ".l9-meta-injector-out").trim() || ".l9-meta-injector-out";
  const outDir = resolveFutureContainedPath(targetRoot, outInput, "out");

  const defaultDryRun = modeResolution.mode === "inventory" || modeResolution.mode === "check";
  const dryRun = parseBoolean("dry-run", env.L9_INPUT_DRY_RUN, defaultDryRun);
  const failOnIssues = parseBoolean("fail-on-issues", env.L9_INPUT_FAIL_ON_ISSUES, true);
  const llmEnabled = parseBoolean("llm", env.L9_INPUT_LLM, false);
  const uploadArtifact = parseBoolean("upload-artifact", env.L9_INPUT_UPLOAD_ARTIFACT, true);
  const llmAllowInsecure = parseBoolean("llm-allow-insecure", env.L9_INPUT_LLM_ALLOW_INSECURE, false);

  const namespaceRaw = String(env.L9_INPUT_NAMESPACE ?? "").trim();
  const namespace = assertText("namespace", namespaceRaw || path.basename(targetRoot));
  const authority = assertText("authority", String(env.L9_INPUT_AUTHORITY ?? "").trim(), { allowEmpty: true }).trim();
  const glob = assertText("glob", String(env.L9_INPUT_GLOB ?? "**/*").trim() || "**/*");
  const omitPatterns = parseCsvPatterns(env.L9_INPUT_OMIT);
  const namespaceGlobs = parseRepeatedValues(env.L9_INPUT_NAMESPACE_GLOBS).map(assertNamespaceGlob);
  const nearDupThreshold = parseNumber("near-dup", env.L9_INPUT_NEAR_DUP, 0.9, (n) => n >= 0 && n <= 1, "between 0 and 1");
  const hashPrefixLength = parseNumber("hash-prefix-length", env.L9_INPUT_HASH_PREFIX_LENGTH, 16, (n) => Number.isInteger(n) && n >= 8 && n <= 64, "an integer from 8 to 64");

  const runnerTempRaw = String(env.RUNNER_TEMP ?? "").trim();
  let reportPath;
  if (modeResolution.mode === "check") {
    const runnerTemp = realDirectory("RUNNER_TEMP", assertText("RUNNER_TEMP", runnerTempRaw));
    const runId = sanitizeSegment(env.GITHUB_RUN_ID, "local");
    const actionId = sanitizeSegment(env.GITHUB_ACTION, "run");
    const reportDir = resolveFutureContainedPath(runnerTemp, `l9-meta-injector-check-${runId}-${actionId}`, "check report directory");
    reportPath = path.join(reportDir, "check-report.json");
  }

  const config = {
    source: "action-env",
    requestedMode: modeResolution.requested,
    mode: modeResolution.mode,
    warnings: modeResolution.warnings,
    workspace,
    actionPath,
    targetRoot,
    outDir,
    reportPath,
    glob,
    namespace,
    namespaceGlobs,
    authority,
    dryRun,
    failOnIssues,
    nearDupThreshold,
    hashPrefixLength,
    omitPatterns,
    llmEnabled,
    uploadArtifact,
    llmBaseUrl: assertText("llm-base-url", String(env.L9_INPUT_LLM_BASE_URL ?? "").trim(), { allowEmpty: true }).trim(),
    llmModel: assertText("llm-model", String(env.L9_INPUT_LLM_MODEL ?? "").trim(), { allowEmpty: true }).trim(),
    llmApiKey: String(env.L9_INPUT_LLM_API_KEY ?? ""),
    llmAllowInsecure,
  };
  if (CONTROL_RE.test(config.llmApiKey)) fail("llm-api-key contains a forbidden control character");
  enforceModeRules(config);
  return config;
}

function parseCommandLine(argv, env = process.env) {
  const args = [...argv];
  if (args.length < 2) {
    fail("usage: operation-cli.js <inventory|check|apply|skills|pipeline> <root> [options]");
  }
  const requestedMode = args.shift();
  const rootInput = args.shift();
  const values = new Map();
  const repeated = new Map();
  const booleans = new Set(["--dry-run", "--fail-on-issues", "--llm", "--llm-allow-insecure"]);
  const repeatable = new Set(["--omit", "--namespace-glob"]);
  const valueOptions = new Set([
    "--out", "--glob", "--namespace", "--authority", "--near-dup", "--hash-prefix-length",
    "--llm-base-url", "--llm-model", "--llm-api-key",
  ]);
  while (args.length) {
    const option = args.shift();
    if (booleans.has(option) || valueOptions.has(option) || repeatable.has(option)) {
      if (!args.length) fail(`${option} requires a value`);
      const value = args.shift();
      if (repeatable.has(option)) {
        const list = repeated.get(option) ?? [];
        list.push(value);
        repeated.set(option, list);
      } else {
        if (values.has(option)) fail(`${option} may be specified only once`);
        values.set(option, value);
      }
      continue;
    }
    fail(`unknown option '${option}'`);
  }

  const workspace = realDirectory("working directory", process.cwd());
  const targetRoot = resolveExistingContainedDirectory(workspace, String(rootInput), "root");
  const modeResolution = resolveMode(requestedMode);
  const outInput = values.get("--out") ?? ".l9-meta-injector-out";
  const outDir = resolveFutureContainedPath(targetRoot, outInput, "out");
  const defaultDryRun = modeResolution.mode === "inventory" || modeResolution.mode === "check";
  const dryRun = parseBoolean("dry-run", values.get("--dry-run"), defaultDryRun);
  const failOnIssues = parseBoolean("fail-on-issues", values.get("--fail-on-issues"), true);
  const llmEnabled = parseBoolean("llm", values.get("--llm"), false);
  const llmAllowInsecure = parseBoolean("llm-allow-insecure", values.get("--llm-allow-insecure"), false);
  const namespace = assertText("namespace", values.get("--namespace") ?? path.basename(targetRoot));
  const authority = assertText("authority", values.get("--authority") ?? "", { allowEmpty: true }).trim();
  const glob = assertText("glob", values.get("--glob") ?? "**/*");
  const namespaceGlobs = (repeated.get("--namespace-glob") ?? []).map(assertNamespaceGlob);
  const nearDupThreshold = parseNumber("near-dup", values.get("--near-dup"), 0.9, (n) => n >= 0 && n <= 1, "between 0 and 1");
  const hashPrefixLength = parseNumber("hash-prefix-length", values.get("--hash-prefix-length"), 16, (n) => Number.isInteger(n) && n >= 8 && n <= 64, "an integer from 8 to 64");
  let reportPath;
  if (modeResolution.mode === "check") {
    const temp = realDirectory("temporary directory", env.RUNNER_TEMP || require("node:os").tmpdir());
    reportPath = path.join(temp, `l9-meta-injector-check-${process.pid}.json`);
  }
  const config = {
    source: "cli",
    requestedMode: modeResolution.requested,
    mode: modeResolution.mode,
    warnings: modeResolution.warnings,
    workspace,
    actionPath: path.resolve(__dirname, ".."),
    targetRoot,
    outDir,
    reportPath,
    glob,
    namespace,
    namespaceGlobs,
    authority,
    dryRun,
    failOnIssues,
    nearDupThreshold,
    hashPrefixLength,
    omitPatterns: repeated.get("--omit") ?? [],
    llmEnabled,
    uploadArtifact: false,
    llmBaseUrl: values.get("--llm-base-url") ?? "",
    llmModel: values.get("--llm-model") ?? "",
    llmApiKey: values.get("--llm-api-key") ?? env.LLM_API_KEY ?? "",
    llmAllowInsecure,
  };
  for (const pattern of config.omitPatterns) assertText("omit", pattern);
  enforceModeRules(config);
  return config;
}

function commonArgs(config) {
  const args = [config.targetRoot, "--glob", config.glob, "--namespace", config.namespace];
  for (const pair of config.namespaceGlobs) args.push("--namespace-glob", pair);
  for (const pattern of config.omitPatterns) args.push("--omit", pattern);
  return args;
}

function llmArgs(config) {
  if (!config.llmEnabled) return [];
  const args = ["--llm", "--llm-base-url", config.llmBaseUrl, "--llm-model", config.llmModel];
  if (config.llmAllowInsecure) args.push("--llm-allow-insecure");
  return args;
}

function buildInvocation(config) {
  const scripts = path.join(config.actionPath, "scripts");
  let script;
  let args;
  if (config.mode === "inventory") {
    script = path.join(scripts, "inventory.js");
    args = [config.targetRoot, "--source", "github", "--out", config.outDir];
    for (const pattern of config.omitPatterns) args.push("--omit", pattern);
    if (config.dryRun) args.push("--dry-run");
  } else if (config.mode === "check") {
    script = path.join(scripts, "check-cli.js");
    args = [...commonArgs(config), "--authority", config.authority, "--report", config.reportPath,
      "--near-dup", String(config.nearDupThreshold), "--hash-prefix-length", String(config.hashPrefixLength)];
  } else if (config.mode === "apply") {
    script = path.join(scripts, "apply-cli.js");
    args = [...commonArgs(config), "--authority", config.authority, "--out", config.outDir,
      "--near-dup", String(config.nearDupThreshold), "--hash-prefix-length", String(config.hashPrefixLength),
      ...llmArgs(config)];
    if (!config.failOnIssues) args.push("--no-fail-on-issues");
  } else {
    script = path.join(scripts, "skills-cli.js");
    args = [config.targetRoot, "--out", config.outDir, ...llmArgs(config)];
    for (const pattern of config.omitPatterns) args.push("--omit", pattern);
    if (config.dryRun) args.push("--dry-run");
  }
  const childEnv = { ...process.env };
  for (const key of Object.keys(childEnv)) {
    if (key.startsWith("L9_INPUT_")) delete childEnv[key];
  }
  if (config.llmApiKey) childEnv.LLM_API_KEY = config.llmApiKey;
  else delete childEnv.LLM_API_KEY;
  return {
    command: process.execPath,
    args: [script, ...args],
    cwd: config.actionPath,
    shell: false,
    env: childEnv,
    artifactPath: config.mode === "check" ? config.reportPath : config.outDir,
  };
}

function parseSummary(mode, text) {
  const inventoryMatch = text.match(/(?:^|\n)inventory:\s+([0-9]+)\s+entries/m);
  const scan = /(?:scanned|considered)=([0-9]+)/g;
  let match;
  let scanned = inventoryMatch ? inventoryMatch[1] : "0";
  while ((match = scan.exec(text)) !== null) scanned = match[1];
  const change = /(?:injected|changed)=([0-9]+)/g;
  let injected = mode === "inventory" || mode === "check" ? "0" : "0";
  while ((match = change.exec(text)) !== null) injected = match[1];
  const passedMatches = [...text.matchAll(/passed=(true|false)/g)];
  const verificationPassed = passedMatches.length
    ? passedMatches[passedMatches.length - 1][1]
    : "n-a";
  return { scanned, injected, verificationPassed };
}

module.exports = {
  ActionInputError,
  LEGACY_OPERATION_ALIASES,
  OPERATION_MODES,
  buildInvocation,
  isWithin,
  normalizeEnvironment,
  parseBoolean,
  parseCommandLine,
  parseSummary,
  resolveExistingContainedDirectory,
  resolveFutureContainedPath,
  resolveMode,
};
