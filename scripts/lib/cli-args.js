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

module.exports = { flag, opt, resolveRootDir };
