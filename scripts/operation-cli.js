#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const {
  ActionInputError,
  buildInvocation,
  hasControlChar,
  normalizeEnvironment,
  parseCommandLine,
  parseSummary,
} = require("./lib/operation-dispatch");

/** One `key=value` GITHUB_OUTPUT line; a key or value with NUL/CR/LF would forge extra lines. */
function outputLine(key, value) {
  const text = String(value);
  if (hasControlChar(key) || hasControlChar(text)) {
    throw new ActionInputError(`output '${JSON.stringify(key)}' contains a forbidden control character`);
  }
  return `${key}=${text}\n`;
}

function appendOutput(file, key, value) {
  if (!file) return;
  fs.appendFileSync(file, outputLine(key, value), "utf8");
}

/** Validate every output before writing any, so a refused value leaves GITHUB_OUTPUT untouched. */
function writeOutputs(file, entries) {
  if (!file) return;
  const text = entries.map(([key, value]) => outputLine(key, value)).join("");
  fs.appendFileSync(file, text, "utf8");
}

function execute(config) {
  for (const warning of config.warnings) process.stderr.write(`operation-cli: warning: ${warning}\n`);
  const invocation = buildInvocation(config);
  process.stderr.write(`operation-cli: mode=${config.mode} target=${config.targetRoot}\n`);
  const child = spawnSync(invocation.command, invocation.args, {
    cwd: invocation.cwd,
    env: invocation.env,
    encoding: "utf8",
    shell: invocation.shell,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (child.stdout) process.stdout.write(child.stdout);
  if (child.stderr) process.stderr.write(child.stderr);
  if (child.error) throw child.error;

  // Child stdout only: stderr carries repository-influenced diagnostics (RC-100).
  const summary = parseSummary(config.mode, child.stdout ?? "");
  writeOutputs(process.env.GITHUB_OUTPUT, [
    ["scanned", summary.scanned],
    ["injected", summary.injected],
    ["verification_passed", summary.verificationPassed],
    ["artifact_path", invocation.artifactPath],
    ["resolved_mode", config.mode],
    ["upload_artifact", config.uploadArtifact === false ? "false" : "true"],
  ]);

  const status = child.status === null ? 2 : child.status;
  process.exit(status);
}

function main() {
  try {
    const actionEnv = process.argv.slice(2).includes("--action-env");
    if (actionEnv && process.argv.slice(2).length !== 1) {
      throw new ActionInputError("--action-env cannot be combined with CLI arguments");
    }
    const config = actionEnv
      ? normalizeEnvironment(process.env)
      : parseCommandLine(process.argv.slice(2), process.env);
    execute(config);
  } catch (error) {
    const prefix = error instanceof ActionInputError ? "invalid input" : "failed";
    process.stderr.write(`operation-cli: ${prefix}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(2);
  }
}

if (require.main === module) main();

module.exports = { appendOutput, outputLine, writeOutputs };
