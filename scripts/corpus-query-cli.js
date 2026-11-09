#!/usr/bin/env node
"use strict";
// corpus-query-cli.js — ask one bounded evidence question of a completed corpus generation.
//
//   node scripts/corpus-query-cli.js --out DIR [filters] [--limit N] [--max-excerpt-bytes N]
//
// Read-only. Resolves DIR/CURRENT.json once, pins that generation, verifies every
// file it reads against the pointer's hashes and every payload against its
// manifest, and prints one `l9.corpus-evidence-query/v1` JSON document on stdout.
// Nothing is indexed, cached, re-read from the source files, or written anywhere.
//
// Exit codes: 0 for `ok`, `empty` and `incomplete` (read the outcome; incomplete
// means the snapshot itself is partial); 3 for `unavailable` and `unsupported`
// (the question cannot be answered from this generation); 1 for `invalid` (the
// generation failed verification and no result is trusted); 2 for a usage error.
const path = require("node:path");

const LABEL = "corpus-query";

const USAGE = [
  "usage: corpus-query --out DIR [options]",
  "",
  "  --out DIR                  corpus output directory holding CURRENT.json (required)",
  "  --root KEY|ID              only this root (root key as declared, or root id)",
  "  --artifact ID|PATH         only this artifact: vsrc:… id, artifact:… packet id, or Root::path",
  "  --predicate NAME           exact predicate, e.g. work.status, work.task.open, document.title",
  "  --class NAME               exact architecture statement class: intent, constraint,",
  "                             assumption, open_question, decision_statement",
  "  --text LITERAL             literal, case-sensitive substring of the value or excerpt",
  "  --kind VALUE               documents that declared this work.kind (any declaration)",
  "  --status VALUE             documents that declared this work.status (any declaration)",
  "  --source NAME              architecture_evidence | document_work_signals | repository_model_packet",
  "  --limit N                  records returned (default 50, max 500); more is truncation,",
  "                             not a page: narrow the query",
  "  --max-excerpt-bytes N      excerpt byte ceiling on the wire (default 1024)",
  "",
  "Every result is a record the generation already wrote, with its identities, its",
  "native coordinate and its bounded excerpt. Nothing is ranked, inferred or resolved:",
  "a decision_statement from a WIP document is returned as source-declared beside the",
  "WIP status the document declared, never as an accepted decision.",
].join("\n");

const VALUE_FLAGS = new Set([
  "--out", "--root", "--artifact", "--predicate", "--class", "--text", "--kind",
  "--status", "--source", "--limit", "--max-excerpt-bytes",
]);

function fail(message, code = 2) {
  console.error(`${LABEL}: ${message}`);
  process.exit(code);
}

/** Strict option grammar (ADR-069): every flag is known, every value flag has a value. */
function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") {
      console.log(USAGE);
      process.exit(0);
    }
    if (!VALUE_FLAGS.has(flag)) fail(`unknown option '${flag}'\n\n${USAGE}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) fail(`${flag} needs a value`);
    if (flag in options) fail(`${flag} was given twice`);
    options[flag] = value;
    index += 1;
  }
  if (options["--out"] === undefined) fail(`--out DIR is required\n\n${USAGE}`);
  return options;
}

function integer(options, flag) {
  const raw = options[flag];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) fail(`${flag} must be an integer, got '${raw}'`);
  return value;
}

function requireBuilt(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    fail(`run "npm run build" first (${error.message})`);
    return undefined;
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const repo = path.resolve(__dirname, "..");
  const query = requireBuilt(path.join(repo, "dist", "corpus_query.js"));

  const input = { outDir: path.resolve(options["--out"]) };
  const strings = {
    root: "--root",
    artifact: "--artifact",
    predicate: "--predicate",
    statementClass: "--class",
    text: "--text",
    kind: "--kind",
    status: "--status",
    source: "--source",
  };
  for (const [key, flag] of Object.entries(strings)) {
    if (options[flag] !== undefined) input[key] = options[flag];
  }
  const limit = integer(options, "--limit");
  const maxExcerptBytes = integer(options, "--max-excerpt-bytes");
  if (limit !== undefined) input.limit = limit;
  if (maxExcerptBytes !== undefined) input.maxExcerptBytes = maxExcerptBytes;

  const response = query.queryCorpusEvidence(input);
  process.stdout.write(query.renderEvidenceQueryResponse(response));
  const exit = { ok: 0, empty: 0, incomplete: 0, unavailable: 3, unsupported: 3, invalid: 1 };
  process.exitCode = exit[response.outcome] ?? 1;
}

main();
