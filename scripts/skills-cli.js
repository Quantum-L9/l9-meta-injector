#!/usr/bin/env node
/*
 * skills-cli.js — Cursor-native skills mode (ADR-017).
 * Selects skill artifacts only; material-improves description (Use when …);
 * optionally fills activation_signals; never invents a triggers: key;
 * writes only when material diffs exist. Skills mode requires repository
 * authority and commits through the governed transaction (ADR-033 / INV-018).
 *
 *   node scripts/skills-cli.js <root> --authority ID [options]
 *   npm run skills -- <root> --authority ID [options]
 */
"use strict";
const path = require("node:path");
const { requireBuilt, parseCli } = require("./lib/cli-args");

const REPO = path.resolve(__dirname, "..");
const pkg = requireBuilt(path.join(REPO, "dist", "index.js"), "skills-cli");

const usage = "usage: node scripts/skills-cli.js <root> --authority ID [--out DIR] [--dry-run] [--verbose] [--omit PATTERN] [--omit-file PATH] [--llm] [--llm-base-url URL] [--llm-api-key KEY] [--llm-model NAME] [--llm-allow-insecure]";
const { root, flag, opt, optAll } = parseCli("skills-cli", usage);
const outDir = path.resolve(opt("--out", `${root}.l9skills`));
const authority = opt("--authority", null);
if (!authority?.trim()) {
  console.error("skills-cli: --authority is required; skills mode must not bypass repository authority");
  process.exit(2);
}
// NUL, CR and LF are rejected because --authority is interpolated into paths and
// into log lines; a newline there forges a second record and a NUL truncates a
// path. Expressed as an explicit code-point test rather than a regex character
// class holding those control characters: the check is the point, and a linter
// reading the class says "remove this control character", which would delete the
// validation rather than the risk.
const FORBIDDEN_AUTHORITY_CODES = new Set([0x00, 0x0d, 0x0a]);
if ([...authority].some((ch) => FORBIDDEN_AUTHORITY_CODES.has(ch.codePointAt(0)))) {
  console.error("skills-cli: --authority contains a forbidden control character");
  process.exit(2);
}
const llmEnabled = flag("--llm");

const config = {
  root,
  authority: authority.trim(),
  dryRun: flag("--dry-run"),
  outDir,
  verbose: flag("--verbose"),
  llmEnabled,
  llmBaseUrl: opt("--llm-base-url", undefined),
  llmApiKey: opt("--llm-api-key", process.env.LLM_API_KEY),
  llmModel: opt("--llm-model", undefined),
  llmAllowInsecure: flag("--llm-allow-insecure"),
  omitPatterns: optAll("--omit"),
  omitFile: opt("--omit-file", undefined),
};

if (llmEnabled && !(config.llmBaseUrl && config.llmApiKey && config.llmModel)) {
  console.error("skills-cli: --llm requires --llm-base-url, --llm-model, and an API key (--llm-api-key or LLM_API_KEY); falling back to local (no-op) assist.");
}

console.error(`skills-cli: running skills mode over ${root}${config.dryRun ? " (dry-run)" : ""}${llmEnabled ? ", llm-assisted" : ""} …`);

pkg.runSkillsPipelineAsync(config).then((result) => {
  console.log(`skills-cli: considered=${result.considered} changed=${result.changed} unchanged=${result.unchanged} authorityResolved=${result.authorityResolved} repositoryMutated=${result.repositoryMutated}`);
  console.log(`skills-cli: report written to ${path.relative(process.cwd(), path.join(outDir, "skills-report.json"))}`);
  if (!result.authorityResolved) {
    console.error(`skills-cli: repository authority unresolved; ${result.authorityConflicts.length} conflict(s); no SKILL.md was modified`);
    process.exit(1);
  }
  if (config.dryRun) console.log("skills-cli: (dry-run: no files were modified)");
}).catch((e) => {
  console.error(`skills-cli: threw: ${e?.stack ?? e}`);
  process.exit(2);
});
