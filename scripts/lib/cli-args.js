"use strict";
/**
 * Shared CLI-argument helpers for the l9-meta-injector wrapper scripts
 * (scripts/inventory.js, scripts/pipeline-cli.js). Both take a positional
 * <root> directory plus `--flag`/`--opt value` style options; this module
 * is the single place that parses that shape.
 */
const fs = require("node:fs");
const path = require("node:path");

function flag(argv, name) {
  return argv.includes(name);
}

function opt(argv, name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}

/** Like opt(), but collects every occurrence of a repeatable flag (e.g. multiple
 * `--namespace-glob a=b --namespace-glob c=d`) instead of only the first. */
function optAll(argv, name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
  }
  return out;
}

/** Resolve argv[0] to an absolute directory, or print `usage` and exit(2). */
function resolveRootDir(argv, label, usage) {
  if (!argv.length || argv[0].startsWith("-")) {
    console.error(usage);
    process.exit(2);
  }
  const root = path.resolve(argv[0]);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    console.error(`${label}: not a directory: ${root}`);
    process.exit(2);
  }
  return root;
}

/** require() a compiled dist module, or exit(2) with a "run npm run build first" hint. */
function requireBuilt(modulePath, label) {
  try {
    return require(modulePath);
  } catch (e) {
    console.error(`${label}: run "npm run build" first (${e.message})`);
    process.exit(2);
  }
}

/**
 * Parse `process.argv` for the <root> [options] shape shared by every
 * l9-meta-injector CLI wrapper: resolves and validates the positional root
 * directory, and returns bound flag()/opt() readers over the remaining argv.
 */
function parseCli(label, usage) {
  const argv = process.argv.slice(2);
  const root = resolveRootDir(argv, label, usage);
  return {
    argv,
    root,
    flag: (name) => flag(argv, name),
    opt: (name, def) => opt(argv, name, def),
    optAll: (name) => optAll(argv, name),
  };
}

module.exports = { flag, opt, optAll, resolveRootDir, requireBuilt, parseCli };
