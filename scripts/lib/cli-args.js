"use strict";
/**
 * Shared CLI-argument helpers for the l9-meta-injector direct entrypoints
 * (scripts/inventory.js, pipeline-cli.js, check-cli.js, apply-cli.js,
 * skills-cli.js, repository-model-cli.js) and the strict option core the
 * governed dispatcher (scripts/lib/operation-dispatch.js) also uses.
 *
 * Every direct CLI takes a positional <root> directory plus `--flag` /
 * `--opt value` options. Parsing is strict (ADR-069): each script's options
 * are declared in CLI_OPTION_SPECS, and before any work an unknown token, an
 * extra positional, a value option without a value (or whose value is a known
 * option token), a duplicated single-value option, an out-of-range threshold,
 * or a malformed namespace-glob exits 2 with the usage. Valid invocations
 * behave exactly as before.
 */
const fs = require("node:fs");
const path = require("node:path");

class CliArgsError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliArgsError";
  }
}

function defaultFail(message) {
  throw new CliArgsError(message);
}

/**
 * Option bounds shared by the direct CLIs and the dispatcher, so a threshold
 * the Action refuses is refused by `npm run check` too.
 */
const NUMERIC_OPTION_BOUNDS = Object.freeze({
  "--near-dup": Object.freeze({
    predicate: (n) => n >= 0 && n <= 1,
    expectation: "between 0 and 1",
  }),
  "--hash-prefix-length": Object.freeze({
    predicate: (n) => Number.isInteger(n) && n >= 8 && n <= 64,
    expectation: "an integer from 8 to 64",
  }),
});

/** A glob=namespace pair needs a non-empty glob and a non-empty namespace. */
function isNamespaceGlobPair(pair) {
  const eq = pair.indexOf("=");
  return eq >= 1 && eq !== pair.length - 1;
}

/** Per-option value validators, applied wherever the option is declared. */
const VALUE_VALIDATORS = Object.freeze({
  "--near-dup": (value) => boundedNumberMessage("--near-dup", value),
  "--hash-prefix-length": (value) => boundedNumberMessage("--hash-prefix-length", value),
  "--namespace-glob": (value) => (isNamespaceGlobPair(value)
    ? null
    : `bad --namespace-glob "${value}" (expected glob=namespace)`),
});

function boundedNumberMessage(option, raw) {
  // An empty value keeps the reader's default, exactly as opt() always did.
  if (raw === "") return null;
  const value = Number(raw);
  const bounds = NUMERIC_OPTION_BOUNDS[option];
  if (raw.trim() === "" || !Number.isFinite(value) || !bounds.predicate(value)) {
    return `${option} must be ${bounds.expectation}, got '${raw}'`;
  }
  return null;
}

const LLM_BOOLEANS = ["--llm", "--llm-allow-insecure"];
const LLM_VALUES = ["--llm-base-url", "--llm-api-key", "--llm-model"];

/**
 * The option declaration of every direct CLI, keyed by the label it passes to
 * parseCli(). Each list mirrors that script's usage string; a token outside
 * it is an error, never silently ignored.
 */
const CLI_OPTION_SPECS = Object.freeze({
  inventory: Object.freeze({
    boolean: ["--dry-run", "--no-inject", "--no-folder-sidecars"],
    value: ["--out", "--source", "--ignore", "--omit-file", "--schema"],
    repeatable: ["--omit"],
  }),
  "pipeline-cli": Object.freeze({
    boolean: [
      "--dry-run", "--fail-on-issues", "--no-fail-on-issues", "--normalize-filenames",
      "--write-inject-log", "--local-files", "--verbose", ...LLM_BOOLEANS,
    ],
    value: [
      "--glob", "--out", "--index-dir", "--namespace", "--authority", "--near-dup",
      "--hash-prefix-length", "--schema", "--omit-file", ...LLM_VALUES,
    ],
    repeatable: ["--namespace-glob", "--omit"],
  }),
  "check-cli": Object.freeze({
    boolean: ["--local-files", "--verbose"],
    value: [
      "--glob", "--report", "--namespace", "--authority", "--near-dup",
      "--hash-prefix-length", "--schema", "--omit-file",
    ],
    repeatable: ["--namespace-glob", "--omit"],
  }),
  "apply-cli": Object.freeze({
    boolean: ["--verbose", ...LLM_BOOLEANS],
    value: [
      "--glob", "--out", "--namespace", "--authority", "--near-dup",
      "--hash-prefix-length", "--schema", "--omit-file", ...LLM_VALUES,
    ],
    repeatable: ["--namespace-glob", "--omit"],
  }),
  "skills-cli": Object.freeze({
    boolean: ["--dry-run", "--verbose", ...LLM_BOOLEANS],
    value: ["--authority", "--out", "--omit-file", ...LLM_VALUES],
    repeatable: ["--omit"],
  }),
  "repository-model": Object.freeze({
    boolean: [],
    value: ["--name", "--revision", "--out", "--generated-at"],
    repeatable: [],
  }),
});

/**
 * The strict option core shared by the direct CLIs and the dispatcher.
 *
 * Boolean options are bare presence flags and consume nothing. With
 * `spec.negatable`, `--no-<flag>` is the explicit false form of every declared
 * boolean (dispatcher semantics); otherwise a `--no-*` token is only accepted
 * when it is itself declared. Value and repeatable options require a value
 * that is not a known option token. A non-repeatable option may appear once.
 *
 * @param {string[]} args argv after the positional root (not mutated)
 * @param {{boolean: string[], value: string[], repeatable: string[], negatable?: boolean, validateValues?: boolean}} spec
 * @param {(message: string) => never} [fail] error sink; throws CliArgsError by default
 * @returns {{values: Map<string, string>, repeated: Map<string, string[]>}} booleans
 *   are stored in `values` as "true" / "false".
 */
function parseOptionArgv(args, spec, fail = defaultFail) {
  if (!spec) throw new Error("parseOptionArgv requires an option declaration");
  const booleans = new Set(spec.boolean);
  const singles = new Set(spec.value);
  const repeatables = new Set(spec.repeatable);
  const negated = new Map(
    spec.negatable ? spec.boolean.map((option) => [`--no-${option.slice(2)}`, option]) : [],
  );
  const isKnown = (token) => booleans.has(token) || singles.has(token) || repeatables.has(token) || negated.has(token);

  const values = new Map();
  const repeated = new Map();
  const queue = [...args];
  while (queue.length) {
    const option = queue.shift();

    if (booleans.has(option)) {
      if (values.has(option)) fail(`${option} may be specified only once`);
      values.set(option, "true");
      continue;
    }
    const negatedOf = negated.get(option);
    if (negatedOf !== undefined) {
      if (values.has(negatedOf)) fail(`${negatedOf} may be specified only once`);
      values.set(negatedOf, "false");
      continue;
    }

    if (!(singles.has(option) || repeatables.has(option))) fail(`unknown option '${option}'`);
    if (!queue.length) fail(`${option} requires a value`);
    if (isKnown(queue[0])) fail(`${option} requires a value, got option '${queue[0]}'`);
    const value = queue.shift();
    const validator = spec.validateValues === false ? undefined : VALUE_VALIDATORS[option];
    const invalid = validator ? validator(value) : null;
    if (invalid) fail(invalid);
    if (repeatables.has(option)) {
      const list = repeated.get(option) ?? [];
      list.push(value);
      repeated.set(option, list);
    } else {
      if (values.has(option)) fail(`${option} may be specified only once`);
      values.set(option, value);
    }
  }
  return { values, repeated };
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
 * directory, parses the remaining argv strictly against the script's option
 * declaration, and returns flag()/opt()/optAll() readers over the result.
 *
 * Reading an option the declaration does not name is a programming error and
 * throws, so a declaration cannot silently drift from its call sites.
 *
 * @param {string} label the script label (also the CLI_OPTION_SPECS key)
 * @param {string} usage printed on any argument error
 * @param {object} [spec] option declaration; defaults to CLI_OPTION_SPECS[label]
 */
function parseCli(label, usage, spec = CLI_OPTION_SPECS[label]) {
  if (!spec) throw new Error(`${label}: no option declaration (CLI_OPTION_SPECS)`);
  const argv = process.argv.slice(2);
  const root = resolveRootDir(argv, label, usage);
  let parsed;
  try {
    parsed = parseOptionArgv(argv.slice(1), spec);
  } catch (error) {
    if (!(error instanceof CliArgsError)) throw error;
    console.error(`${label}: ${error.message}\n${usage}`);
    process.exit(2);
  }
  const { values, repeated } = parsed;
  const declared = (kind, name) => {
    if (!spec[kind].includes(name)) throw new Error(`${label}: '${name}' is not a declared ${kind} option`);
  };
  return {
    argv,
    root,
    flag: (name) => {
      declared("boolean", name);
      return values.get(name) === "true";
    },
    opt: (name, def) => {
      declared("value", name);
      const value = values.get(name);
      return value ? value : def;
    },
    optAll: (name) => {
      declared("repeatable", name);
      return [...(repeated.get(name) ?? [])];
    },
  };
}

module.exports = {
  CLI_OPTION_SPECS,
  CliArgsError,
  NUMERIC_OPTION_BOUNDS,
  isNamespaceGlobPair,
  parseCli,
  parseOptionArgv,
  requireBuilt,
  resolveRootDir,
};
