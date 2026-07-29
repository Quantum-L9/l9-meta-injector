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

/** True when argv asks for help (`-h` or `--help`). */
function isHelpRequested(argv) {
  return argv.includes("-h") || argv.includes("--help");
}

/**
 * Return the argv tokens this CLI does not recognize, so callers can reject a
 * mistyped flag instead of silently ignoring it (e.g. `--dryrun` swallowed while
 * the injector writes for real). `known` is `{ flags: [...], opts: [...] }` where
 * `opts` take a following value. argv[0] is the positional <root> and is skipped;
 * value tokens after a known `opt` are skipped; `-h`/`--help` and a bare `--`
 * separator are always accepted.
 */
function findUnknownArgs(argv, known) {
  const flags = new Set([...(known.flags || []), "-h", "--help"]);
  const opts = new Set(known.opts || []);
  const unknown = [];
  for (let i = 1; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === "--") continue;         // conventional end-of-options separator
    if (opts.has(tok)) { i++; continue; } // consume this option's value token
    if (flags.has(tok)) continue;
    unknown.push(tok);                  // unknown flag OR unexpected extra positional
  }
  return unknown;
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
 *
 * When `known` (`{ flags, opts }`) is supplied, the wrapper also gets `-h`/`--help`
 * (prints `usage` to stdout, exits 0) and rejects any unrecognized argument with a
 * usage hint and exit 2 — so a mistyped flag fails loudly instead of being ignored.
 */
function parseCli(label, usage, known) {
  const argv = process.argv.slice(2);
  if (known && isHelpRequested(argv)) {
    process.stdout.write(usage + "\n");
    process.exit(0);
  }
  const root = resolveRootDir(argv, label, usage);
  if (known) {
    const unknown = findUnknownArgs(argv, known);
    if (unknown.length) {
      console.error(`${label}: unrecognized argument(s): ${unknown.join(", ")}\n${usage}`);
      process.exit(2);
    }
  }
  return {
    argv,
    root,
    flag: (name) => flag(argv, name),
    opt: (name, def) => opt(argv, name, def),
    optAll: (name) => optAll(argv, name),
  };
}

module.exports = { flag, opt, optAll, resolveRootDir, requireBuilt, parseCli, isHelpRequested, findUnknownArgs };
