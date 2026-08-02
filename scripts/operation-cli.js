#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const {
  ActionInputError,
  buildInvocation,
  normalizeEnvironment,
  parseCommandLine,
  parseSummary,
} = require("./lib/operation-dispatch");

function appendOutput(file, key, value) {
  if (!file) return;
  fs.appendFileSync(file, `${key}=${String(value)}\n`, "utf8");
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

  const combined = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
  const summary = parseSummary(config.mode, combined);
  const outputFile = process.env.GITHUB_OUTPUT;
  appendOutput(outputFile, "scanned", summary.scanned);
  appendOutput(outputFile, "injected", summary.injected);
  appendOutput(outputFile, "verification_passed", summary.verificationPassed);
  appendOutput(outputFile, "artifact_path", invocation.artifactPath);
  appendOutput(outputFile, "resolved_mode", config.mode);
  appendOutput(outputFile, "upload_artifact", config.uploadArtifact === false ? "false" : "true");

  const status = child.status === null ? 2 : child.status;
  process.exit(status);
}

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
