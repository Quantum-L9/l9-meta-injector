#!/usr/bin/env node
"use strict";
// Read-only observation of an arbitrary local source.
//
//   node scripts/local-source-cli.js <path> [--name NAME] [--out DIR] [options]
//
// The source may be a single file, an ordinary folder, an external-drive tree, a
// synced folder, or a ZIP archive. It does not have to be a Git repository, and
// it is never modified: archives are staged into tool-owned scratch outside the
// source tree, and nothing is written beside the source.
//
// Output layout under --out:
//   bundle/                        canonical Repository Model Packet bundle
//   local-source-manifest.json     acquisition manifest (never written in-source)
//   corpus-index.json              machine-readable corpus intelligence projection
//   corpus-report.md               the same projection, rendered for a person
//
// Passing one or more --root switches to corpus mode: several roots are read as a
// single logical corpus, duplicate and candidate analysis crosses the root
// boundaries, and the output layout is the corpus projection set instead.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const LABEL = "local-source";
const USAGE = [
  "usage: local-source <path> [--name NAME] [--out DIR] [options]",
  "",
  "  <path>                     file, folder, external drive tree, or .zip to observe",
  "  --name NAME                canonical source name (default: basename of <path>)",
  "  --source-kind KIND         auto|file|directory|archive (default: auto)",
  "  --out DIR                  output directory (default: <tmpdir>/l9-local-source-out)",
  "  --generated-at ISO         timestamp recorded in the bundle (default: deterministic epoch)",
  "  --no-expand-archives       hash archives but do not observe their members",
  "  --no-interpret             skip the deterministic interpretation pass",
  "  --omit PATTERN             gitignore-style omit pattern (repeatable)",
  "  --omit-file PATH           load additional omit patterns from a file",
  "  --hash-max-bytes N         refuse to hash files above N bytes (default: no limit)",
  "",
  "corpus intelligence:",
  "  --near-duplicate-threshold F   lexical similarity threshold in [0,1] (default: 0.85)",
  "  --no-near-duplicates           skip similarity analysis; exact duplicates still reported",
  "",
  "archive budget (all optional; conservative defaults apply):",
  "  --max-archive-bytes N      largest archive file that will be staged",
  "  --max-members N            largest member count for one archive",
  "  --max-member-bytes N       largest uncompressed size for one member",
  "  --max-expanded-bytes N     largest total uncompressed size for one archive",
  "  --max-session-bytes N      largest total uncompressed size for the whole run",
  "  --max-compression-ratio N  largest uncompressed:compressed ratio",
  "  --max-archive-depth N      nested-archive depth ceiling",
  "  --max-archives N           archives expanded in one run (default: 64). A corpus that",
  "                             is mostly ZIPs will hit this; the run says so rather than",
  "                             quietly stopping, and every held archive is still hashed",
  "",
  "multi-root corpus mode (repeat --root, or point at a manifest):",
  "  --root PATH[=NAME]         add a root; repeatable. NAME defaults to the final",
  "                             path segment and is the root's identity across runs",
  "  --root-manifest FILE       read roots from a l9.corpus-roots/v1 JSON document",
  "                             or a plain list of paths, one per line",
  "  --cache-root DIR           content-addressed cache root (default: $L9_CORPUS_CACHE",
  "                             or ~/.l9/corpus-cache); never inside an observed root",
  "                             (--cache-dir is the older spelling of the same flag)",
  "  --no-cache                 run cold: read nothing from the cache, write nothing",
  "  --previous-snapshot FILE   diff against this snapshot (default: <out>/corpus-snapshot.json)",
  "  --incremental              carry a previous run's content hash forward when a file's",
  "                             size and mtime have not moved. Fast, and explicitly NOT",
  "                             byte-verified: the run reports how many hashes it reused",
  "                             and refuses to call the result fully_verified",
  "  --verify-content           read every byte even under --incremental, restoring a",
  "                             fully_verified snapshot",
  "  --allow-partial-roots      emit a snapshot marked partial when a root cannot be read,",
  "                             instead of failing the run. Never labelled complete",
  "  --no-diff                  do not produce corpus-diff.json",
  "  --session FILE             session manifest path (default: <out>/corpus-session.json)",
  "  --resume                   adopt an existing session manifest for the same roots",
  "  --allow-inferred-root-history  permit resume, incremental reuse, or previous-snapshot",
  "                             comparison when root continuity depends on an inferred",
  "                             basename identity. Two unrelated directories can share",
  "                             one, so this is refused by default; supplying it records",
  "                             the weaker-authority override in the run's provenance",
  "  --topic-threshold F        topic candidate vocabulary overlap in [0,1] (default: 0.35)",
  "  --no-topic-candidates      skip topic candidate analysis",
  "  --keep-generations N       output generations retained (default: 3)",
  "  --max-decoder-workers N    documents decoded concurrently (default: 4)",
  "  --max-embedding-workers N  documents embedded concurrently (default: 2)",
  "  --max-memory-bytes N       ceiling on decoded text held at once (default: 256 MiB)",
  "",
  "semantic candidate discovery (on by default):",
  "  --no-semantic-analysis     skip candidate discovery; duplicates still reported",
  "  --embeddings               enable optional semantic embeddings (default: off)",
  "  --embedding-provider NAME  required when --embeddings is given; 'http-json' is",
  "                             the provider this package can run",
  "  --embedding-model ID       required when --embeddings is given",
  "  --embedding-model-revision R   recorded when the provider exposes one",
  "  --embedding-endpoint URL   where http-json POSTs {model,input}; a local",
  "                             provider must name a loopback host, a remote one",
  "                             must be https://",
  "  --embedding-locality K     local (default) or remote",
  "  --embedding-pair-threshold F   cosine at which a pair is offered (default 0.75)",
  "  --allow-remote-embeddings  permit a remote provider to receive bounded document",
  "                             text; enabling embeddings alone does NOT imply this",
  "",
  "  A bearer token is read from L9_EMBEDDING_BEARER_TOKEN, never from a flag, and",
  "  is refused over a cleartext endpoint. Redirects are never followed. Documents",
  "  whose path matches a secret pattern are never embedded at any setting.",
  "  --reasoning-pack-max-artifacts N   members per evidence pack (default: 12)",
  "  --reasoning-pack-max-chars N       characters per evidence pack (default: 24000)",
  "",
  "The source is never modified. Archive members are observed as virtual",
  "artifacts named <archive>!/<member>; nothing is extracted beside the source.",
].join("\n");

function fail(message, code = 1) {
  console.error(`${LABEL}: ${message}`);
  process.exit(code);
}

function parseArgs(argv) {
  // Corpus mode names its roots with --root, so it has no positional target; the
  // single-source mode still requires one.
  const corpusMode = argv.includes("--root")
    || argv.includes("--root-manifest")
    || argv.includes("--manifest");
  if (argv.length === 0 || (!corpusMode && argv[0].startsWith("-"))) {
    console.error(USAGE);
    process.exit(2);
  }
  const flag = (name) => argv.includes(name);
  const opt = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
  };
  const optAll = (name) => {
    const out = [];
    for (let i = 0; i < argv.length; i++) if (argv[i] === name && argv[i + 1]) out.push(argv[i + 1]);
    return out;
  };
  return { argv, flag, opt, optAll, corpusMode, target: corpusMode ? null : argv[0] };
}

/** Parse a fractional flag in [0,1], or exit with a precise message. */
function unitIntervalOpt(cli, name) {
  const raw = cli.opt(name, null);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    fail(`${name} must be a number within [0, 1], got '${raw}'`, 2);
  }
  return value;
}

/** Parse a positive-integer budget flag, or exit with a precise message. */
function numericOpt(cli, name) {
  const raw = cli.opt(name, null);
  if (raw === null) return undefined;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0) fail(`${name} must be a non-negative integer, got '${raw}'`, 2);
  return value;
}

/**
 * Every file under `root`, as root-relative POSIX paths, in code-point order.
 *
 * `compare` is the engine's own `compareCodePoints`. A bare `.sort()` would order
 * by UTF-16 code *unit*, which is a different order from code points for anything
 * outside the BMP — and every ordering this package emits is decided rather than
 * inherited, so the comparator is passed in rather than assumed.
 */
function listFilesRecursively(root, compare, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFilesRecursively(root, compare, relative));
    else out.push(relative);
  }
  return out.sort(compare);
}

function requireBuilt(modulePath) {
  try {
    return require(modulePath);
  } catch (error) {
    fail(`run "npm run build" first (${error.message})`, 2);
    return undefined;
  }
}

function collectPolicy(cli) {
  const policy = {};
  const map = {
    maxArchiveCompressedBytes: "--max-archive-bytes",
    maxMemberCount: "--max-members",
    maxSingleMemberUncompressedBytes: "--max-member-bytes",
    maxTotalUncompressedBytesPerArchive: "--max-expanded-bytes",
    maxTotalUncompressedBytesPerSession: "--max-session-bytes",
    maxCompressionRatio: "--max-compression-ratio",
    maxNestedDepth: "--max-archive-depth",
    maxNestedArchiveCount: "--max-archives",
  };
  for (const [key, flagName] of Object.entries(map)) {
    const value = numericOpt(cli, flagName);
    if (value !== undefined) policy[key] = value;
  }
  return policy;
}

/** Roots named on the command line and in any manifest, in the order given. */
/**
 * The roots to observe, and the corpus they belong to.
 *
 * `--manifest` is the form that names both; `--root` is the quick one for a
 * corpus an operator is assembling at the prompt, and `--corpus-id` names it.
 */
function collectRoots(cli, roots) {
  const specs = [];
  for (const value of cli.optAll("--root")) specs.push(roots.parseRootArgument(value));
  const rootManifest = cli.opt("--root-manifest", null);
  if (rootManifest !== null) specs.push(...roots.readRootManifest(rootManifest));

  let corpusId = cli.opt("--corpus-id", null);
  const manifest = cli.opt("--manifest", null);
  if (manifest !== null) {
    const parsed = roots.readCorpusManifest(manifest);
    specs.push(...parsed.roots);
    // An explicit --corpus-id still wins: the flag is the more specific request.
    if (corpusId === null) corpusId = parsed.corpus_id;
  }
  return { specs, corpusId: corpusId ?? roots.DEFAULT_CORPUS_ID };
}

/**
 * Flags this CLI used to accept and act on nowhere.
 *
 * Refused rather than ignored. Silently dropping a flag an operator passed is
 * how a decorative knob keeps working after it is removed: the invocation still
 * succeeds, the setting still has no effect, and now there is not even a field
 * in the manifest to notice. An error naming the reason is the only honest exit.
 */
const RETIRED_BUDGET_FLAGS = {
  "--max-hash-workers":
    "acquisition hashes a root with one synchronous streaming reader, which is what makes its "
    + "did-this-tree-move check meaningful; the flag was recorded and never exercised",
  "--max-parallel-hashers": "see --max-hash-workers",
  "--max-analysis-workers":
    "candidate generation is a single pass over evidence already in memory; the flag was "
    + "recorded and never exercised",
};

/** Resource budgets, defaulted by the engine and overridable one at a time. */
function collectBudgets(cli) {
  for (const [flagName, reason] of Object.entries(RETIRED_BUDGET_FLAGS)) {
    if (cli.opt(flagName, null) !== null || cli.flag(flagName)) {
      fail(`${flagName} has been removed: ${reason}. Drop the flag.`, 2);
    }
  }
  const budgets = {};
  // Only bounds the run is actually held to. `--max-hash-workers` and
  // `--max-analysis-workers` were accepted here and exercised nowhere; they are
  // gone rather than documented as decorative, and an invocation still passing
  // one is refused below rather than silently ignored.
  //
  // The older --max-parallel-* spellings are kept for the two that remain, so an
  // existing invocation does not break; the newer name wins when both are given.
  const map = {
    max_parallel_decoders: ["--max-decoder-workers", "--max-parallel-decoders"],
    max_parallel_embedding_requests: ["--max-embedding-workers", "--max-parallel-embedding-requests"],
    max_memory_bytes: ["--max-memory-bytes"],
  };
  for (const [key, flagNames] of Object.entries(map)) {
    for (const flagName of flagNames) {
      const value = numericOpt(cli, flagName);
      if (value !== undefined) {
        budgets[key] = value;
        break;
      }
    }
  }
  return budgets;
}

/**
 * Everything corpus mode prints, and nothing it decides.
 *
 * Kept out of `runCorpusMode` because it is sixty lines of formatting with no
 * control flow of its own, and leaving it inline made the one function that does
 * decide things harder to read than it needed to be.
 */
function reportCorpusRun(context) {
  const { result, cacheEnabled, cache, resumed, written, sessionPath, published } = context;
  const coverage = result.coverage;
  const summary = result.candidates.summary;
  console.log(`${LABEL}: OK (corpus mode)`);
  console.log("  no root was modified: no file was written, renamed, or removed under any of them");
  console.log(`  corpus_id        ${result.snapshot.corpus_id}`);
  console.log(`  source_snapshot  ${result.snapshot.corpus_source_snapshot_id}`);
  console.log(`  analysis_id      ${result.snapshot.analysis.corpus_analysis_id}`);
  console.log(`  corpus_status    ${result.snapshot.corpus_status}`);
  console.log(`  roots            ${result.bindings.length}`);
  for (const binding of result.bindings) {
    console.log(`    ${binding.root_label}  ${binding.source_revision}  ${binding.absolute_path}`);
  }
  console.log(`  files scanned    ${result.scanned.files} (${result.scanned.bytes} byte(s))`);
  console.log(`  archives         ${coverage.archive_count}, ${coverage.archive_member_count} member(s)`);
  console.log(`  exact hashes     ${coverage.exact_hash_coverage.covered}/${coverage.exact_hash_coverage.eligible}`);
  console.log(`  decoded          ${coverage.normalized_document_coverage.covered}/${coverage.normalized_document_coverage.eligible}`);
  console.log(`  interpreted      ${coverage.interpretation_coverage.covered}/${coverage.interpretation_coverage.eligible}`);
  console.log(`  lexical          ${coverage.lexical_analysis_coverage.covered}/${coverage.lexical_analysis_coverage.eligible}`);
  // The two states are reported differently on purpose. "Not enabled" is a claim
  // that nothing left the machine; an enabled run has to say what it sent, to
  // where, and how much of it came back, because that is what makes a remote
  // pass auditable after the fact.
  const embeddings = coverage.embeddings;
  if (embeddings.enabled !== true) {
    console.log("  embeddings       not enabled; no model was called and no network request was made");
  } else {
    const report = result.semantic?.embeddingReport;
    console.log(
      `  embeddings       ${embeddings.embedded_count}/${embeddings.eligible_count} embedded`
      + ` (${embeddings.cache_hit_count} from cache),`
      + ` ${report?.remote === true ? "remote" : "local"} ${report?.provider ?? "?"}`
      + ` model ${report?.model_id ?? "?"}`,
    );
    console.log(
      `  embeddings sent  ${report?.artifact_count_sent ?? 0} document(s),`
      + ` ${report?.chunk_count_sent ?? 0} bounded chunk(s);`
      + ` ${report?.secret_candidates_skipped ?? 0} secret-candidate document(s) never sent`,
    );
  }
  console.log(
    `  duplicates       ${summary.exact_duplicate_cluster_count} cluster(s), `
    + `${summary.cross_root_duplicate_cluster_count} crossing a root boundary`,
  );
  console.log(
    `  near-duplicates  ${summary.near_duplicate_candidate_count} candidate(s), `
    + `${summary.cross_root_near_duplicate_count} crossing a root boundary`,
  );
  console.log(
    `  topic candidates ${summary.topic_candidate_count}, `
    + `${summary.cross_root_topic_candidate_count} crossing a root boundary`,
  );
  console.log(
    `  projects         ${summary.project_candidate_count} candidate(s), `
    + `${summary.cross_root_project_candidate_count} crossing a root boundary, `
    + `${coverage.reasoning_eligible_candidate_count} reasoning-eligible`,
  );
  const unsupported = coverage.unsupported_format_counts
    .map((format) => `${format.extension}:${format.count}`)
    .join(" ");
  console.log(`  unsupported      ${unsupported || "none"}`);
  // Decoding is not the deliverable; what the decoded text reached is. A format
  // that decodes cleanly and appears in no candidate is a real finding, and it
  // is invisible in a coverage ratio, so it is printed here beside one.
  const signals = result.documentSignals;
  const participation = signals.analysis_participation;
  console.log(
    `  decoded formats  ${signals.formats.filter((entry) => entry.decoded_count > 0).length}`
    + ` (${participation.decoded_document_count} document(s),`
    + ` ${participation.candidate_member_count} named by a candidate)`,
  );
  for (const entry of participation.by_format) {
    if (entry.decoded_count === 0) continue;
    console.log(
      `    ${entry.format.padEnd(14)} ${entry.decoded_count} decoded,`
      + ` ${entry.lexically_analyzed_count} analyzed, ${entry.candidate_member_count} in candidates`,
    );
  }
  console.log(`  ocr required     ${coverage.ocr_required_count}`);
  console.log(`  encrypted        ${coverage.encrypted_document_count}`);
  console.log(`  oversized        ${coverage.oversized_document_count}`);
  console.log(`  secrets skipped  ${coverage.secret_skipped_count}`);
  if (result.semantic === null) {
    console.log("  semantic         off (--no-semantic-analysis)");
  } else {
    const semantic = result.semantic;
    const relations = semantic.relations;
    const lexical = relations.pairs.filter(
      (pair) => pair.signals.some((signal) => signal.kind !== "embedding_similarity"
        && signal.kind !== "archive_context"),
    ).length;
    const embeddingRelations = relations.pairs.filter(
      (pair) => pair.signals.some((signal) => signal.kind === "embedding_similarity"),
    ).length;
    console.log(
      `  relationships    ${lexical} lexical/structural, ${embeddingRelations} embedding `
      + `(${relations.generation.scored_pair_count} scored of `
      + `${relations.generation.exhaustive_pair_count} possible)`,
    );
    console.log(
      `  candidates       ${semantic.summary.topic_candidate_count} topic, `
      + `${semantic.summary.project_candidate_count} project, `
      + `${semantic.summary.consolidation_candidate_count} consolidation`,
    );
    console.log(
      `  reasoning        ${semantic.summary.reasoning_eligible_count} eligible of `
      + `${semantic.reasoningCandidates.length} routed; `
      + `${semantic.evidencePacks.length} evidence pack(s)`,
    );
    // The embedding state is reported above, in one place, with the counts.
    // Repeating it here as a bare on/off was one more line to keep in step.
    //
    // The no-model claim is conditional because it has to be true. Candidate
    // discovery calls no model whatever the settings; an embedding pass calls
    // one by definition, and printing "no model was called" after thirty
    // requests to a model server would be the report lying about its own run.
    console.log(
      semantic.embeddingReport.enabled
        ? "  no language model was called: candidate discovery is deterministic, and the "
          + "embedding pass calls only the embedding model named above"
        : "  no model was called: this pass is deterministic and makes zero LLM calls",
    );
  }
  console.log(
    `  cache            ${cacheEnabled ? "on" : "off"}, hit ratio ${coverage.cache.hit_ratio} `
    + `(${coverage.cache.hits} hit, ${coverage.cache.misses} miss, ${coverage.cache.corrupt} discarded)`,
  );
  if (cache !== undefined) console.log(`  cache dir        ${cache.root}`);
  const verification = result.snapshot.verification;
  console.log(
    `  verification     ${verification.mode}${verification.verify_content_requested ? " (--verify-content)" : ""}`
    + ` -> ${verification.verification_class}`,
  );
  console.log(
    `  hashes           ${verification.fully_rehashed_artifact_count} read in full, `
    + `${verification.cached_hash_reuse_count} carried over, `
    + `${verification.unhashed_artifact_count} unhashed`,
  );
  if (verification.cached_hash_reuse_count > 0) console.log(`  ${verification.statement}`);
  console.log(
    `  mtime precheck   ${result.precheck.predicted_unchanged} predicted unchanged, `
    + `${result.precheck.confirmed_unchanged} confirmed by hash, ${result.precheck.contradicted} contradicted`,
  );
  if (resumed.source_ids + resumed.decoder_keys + resumed.analysis_keys > 0) {
    console.log(
      `  resumed          ${resumed.source_ids} source(s), ${resumed.decoder_keys} decoder key(s), `
      + `${resumed.analysis_keys} analysis key(s) carried in from a previous session`,
    );
  }
  if (result.diff !== null) {
    const counts = result.diff.counts;
    console.log(
      `  diff             +${counts.added} -${counts.removed} ~${counts.changed_content} `
      + `renamed-candidate ${counts.renamed_candidate} unchanged ${counts.unchanged}`,
    );
    console.log(
      `  archives diff    +${counts.archive_added} -${counts.archive_removed} ~${counts.archive_changed}`,
    );
    // Two states, printed as two different sentences. A run that could not
    // compare candidates says so; it does not print three zeros that read as
    // "nothing changed" to anyone not checking a flag first.
    const analysis = result.diff.analysis;
    if (analysis.not_computed_reason !== null) {
      console.log(`  candidates diff  not computed: ${analysis.not_computed_reason}`);
    } else {
      console.log(
        `  candidates diff  +${analysis.candidate_added} -${analysis.candidate_removed} `
        + `~${analysis.candidate_changed} unchanged ${analysis.candidate_unchanged}`,
      );
      for (const kind of analysis.by_kind) {
        if (kind.added === 0 && kind.removed === 0 && kind.changed === 0) continue;
        console.log(
          `    ${kind.candidate_kind.padEnd(24)} +${kind.added} -${kind.removed} ~${kind.changed}`,
        );
      }
    }
    // A root matched across runs on a basename is a comparison resting on a
    // mount point. Worth one line: the operator is the only one who can turn it
    // into a real identity, and they will not do it if nobody says so.
    for (const caution of result.diff.longitudinal_identity_cautions) {
      console.log(`  caution          ${caution.message}`);
    }
    console.log(
      `  invalidation     ${result.diff.invalidation.new_content_hashes.length} new content hash(es); `
      + `${result.diff.invalidation.retained_content_hash_count} reusable; `
      + `${result.diff.invalidation.cache_entries_removed} cache entries removed`,
    );
  }
  console.log("  no ranking, score or priority is produced; readiness evidence is counts and citations");
  // The generation, then what is in it. An operator reading this needs to know
  // which directory the run landed in, because that is what CURRENT.json now
  // points at and what a later --previous-snapshot would name.
  console.log(`  generation       ${published.generation_id}`);
  console.log(`  generation dir   ${published.generation_directory}`);
  console.log(`  current          ${published.current_file}`);
  if (published.reused) {
    console.log("  generation       reused: this corpus under these rules produced these exact bytes before");
  }
  if (published.pruned_generation_ids.length > 0) {
    console.log(`  pruned           ${published.pruned_generation_ids.length} older generation(s)`);
  }
  for (const file of written) console.log(`  wrote            ${file}`);
  console.log(`  session          ${sessionPath}`);
  for (const diagnostic of result.diagnostics) {
    console.log(`  ${diagnostic.severity}: ${diagnostic.code} ${diagnostic.message}`);
  }
}

async function runCorpusMode(cli) {
  const repo = path.resolve(__dirname, "..");
  const scan = requireBuilt(path.join(repo, "dist", "corpus_scan.js"));
  const roots = requireBuilt(path.join(repo, "dist", "corpus_roots.js"));
  const cacheModule = requireBuilt(path.join(repo, "dist", "corpus_cache.js"));
  const sessionModule = requireBuilt(path.join(repo, "dist", "corpus_session.js"));
  const snapshotModule = requireBuilt(path.join(repo, "dist", "corpus_snapshot.js"));
  const diffModule = requireBuilt(path.join(repo, "dist", "corpus_diff.js"));
  const coverageModule = requireBuilt(path.join(repo, "dist", "corpus_coverage.js"));
  const signalsModule = requireBuilt(path.join(repo, "dist", "corpus_document_signals.js"));
  const semanticRun = requireBuilt(path.join(repo, "dist", "corpus_semantic_run.js"));
  const documentsModule = requireBuilt(path.join(repo, "dist", "corpus_documents.js"));
  const embeddingsModule = requireBuilt(path.join(repo, "dist", "corpus_embeddings.js"));
  const publishModule = requireBuilt(path.join(repo, "dist", "corpus_publish.js"));
  const httpEmbeddings = requireBuilt(path.join(repo, "dist", "corpus_embedding_http.js"));
  const repositoryModel = requireBuilt(path.join(repo, "dist", "public", "repository_model.js"));
  const ordering = requireBuilt(path.join(repo, "dist", "ordering.js"));
  const corpusIntelligence = requireBuilt(path.join(repo, "dist", "corpus_intelligence.js"));
  const corpusIntelligenceInput = requireBuilt(path.join(repo, "dist", "corpus_intelligence_input.js"));
  const { version } = require(path.join(repo, "package.json"));

  let specs;
  let corpusId;
  try {
    ({ specs, corpusId } = collectRoots(cli, roots));
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
    return;
  }
  if (specs.length === 0) fail("corpus mode needs at least one --root, --manifest or --root-manifest", 2);
  // A root that is not there is a decision point, not a detail: either the run
  // stops, or the operator has said they want a snapshot that names what is
  // missing. It is never silently dropped.
  const allowPartial = cli.flag("--allow-partial-roots");
  for (const spec of specs) {
    if (fs.existsSync(spec.path)) continue;
    if (!allowPartial) {
      fail(`root does not exist: ${spec.path}. Pass --allow-partial-roots to emit a `
        + "snapshot that records it as missing instead.", 2);
    }
  }
  const rootPaths = specs.map((spec) => path.resolve(spec.path));

  const outDir = path.resolve(cli.opt("--out", path.join(os.tmpdir(), "l9-corpus-out")));
  roots.assertOutsideRoots(outDir, rootPaths, "the corpus output directory");

  const cacheEnabled = !cli.flag("--no-cache");
  // The session manifest names the work that was finished; the cache holds what
  // that work produced. Resuming without the cache could only skip work whose
  // result is gone, which would emit a corpus silently missing those documents'
  // assertions — worse than redoing it. So the combination is refused rather than
  // quietly doing nothing.
  if (cli.flag("--resume") && !cacheEnabled) {
    fail("--resume needs the cache: the session records what was completed, the cache holds it. "
      + "Drop --no-cache, or drop --resume to run cold.", 2);
  }
  let cache;
  if (cacheEnabled) {
    try {
      cache = new cacheModule.FileCorpusCache({
        root: cli.opt("--cache-root", cli.opt("--cache-dir", cacheModule.defaultCorpusCacheDir())),
        producerVersion: version,
        observedRootPaths: rootPaths,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 2);
    }
  }

  const sessionPath = roots.assertOutsideRoots(
    cli.opt("--session", path.join(outDir, "session", "corpus-session.json")),
    rootPaths,
    "the session manifest",
  );
  const budgets = {
    ...sessionModule.DEFAULT_CORPUS_BUDGETS,
    ...collectBudgets(cli),
    archive: collectPolicy(cli),
  };
  const session = sessionModule.CorpusSessionStore.open({
    file: sessionPath,
    roots: specs.map((spec) => {
      const rootKey = spec.name && spec.name.length > 0 ? spec.name : roots.defaultRootKey(spec.path);
      return {
        root_id: roots.corpusRootId(rootKey),
        root_key: rootKey,
        absolute_path: path.resolve(spec.path),
        // Recorded so a later resume can tell whether adopting this session's
        // completions is a continuity claim anyone underwrote.
        root_identity_class: spec.name && spec.name.length > 0 ? "declared" : "inferred",
      };
    }),
    budgets,
    now: new Date().toISOString(),
    resume: cli.flag("--resume"),
  });
  const resumed = session.resumedCounts;
  session.save(new Date().toISOString());

  const generationsKept = numericOpt(cli, "--keep-generations");

  // The previous run's snapshot is found through CURRENT.json rather than at a
  // fixed path, because a generation directory is named by its own contents and
  // nothing outside the pointer knows where the last one landed. An explicit
  // --previous-snapshot still wins: comparing against a snapshot from somewhere
  // else entirely is a thing operators do.
  const publishedPrevious = publishModule.resolveCurrentGeneration(outDir);
  const previousPath = cli.opt(
    "--previous-snapshot",
    publishedPrevious === null
      ? path.join(outDir, "corpus-snapshot.json")
      : path.join(publishedPrevious.directory, "corpus-snapshot.json"),
  );
  let previousSnapshot;
  if (!cli.flag("--no-diff") && fs.existsSync(previousPath)) {
    try {
      previousSnapshot = snapshotModule.readCorpusSnapshot(previousPath);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 2);
    }
  }

  const topicThreshold = unitIntervalOpt(cli, "--topic-threshold");
  const nearDuplicateThreshold = unitIntervalOpt(cli, "--near-duplicate-threshold");
  const hashMaxBytes = numericOpt(cli, "--hash-max-bytes");
  const omitPatterns = cli.optAll("--omit");
  const omitFile = cli.opt("--omit-file", undefined);

  // Embeddings are off unless asked for, and a remote provider needs a second,
  // separate permission. The guard runs before the scan so a misconfiguration
  // fails before anything is read, rather than after.
  const embeddingsEnabled = cli.flag("--embeddings");
  const allowRemoteEmbeddings = cli.flag("--allow-remote-embeddings");
  let embeddingConfiguration;
  if (embeddingsEnabled) {
    const locality = cli.opt("--embedding-locality", "local");
    if (locality !== "local" && locality !== "remote") {
      fail(`--embedding-locality must be 'local' or 'remote', got '${locality}'`, 2);
    }
    const endpoint = cli.opt("--embedding-endpoint", undefined);
    embeddingConfiguration = {
      provider: cli.opt("--embedding-provider", ""),
      model_id: cli.opt("--embedding-model", ""),
      locality,
      ...(cli.opt("--embedding-model-revision", undefined) !== undefined
        ? { model_revision: cli.opt("--embedding-model-revision", undefined) }
        : {}),
      ...(endpoint !== undefined ? { endpoint } : {}),
    };
  }
  try {
    embeddingsModule.assertEmbeddingConfiguration({
      embeddingsEnabled,
      allowRemoteEmbeddings,
      ...(embeddingConfiguration !== undefined ? { configuration: embeddingConfiguration } : {}),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }
  // Build the provider now, so a bad endpoint or a `local` provider aimed at a
  // public host fails before a single file has been read rather than after the
  // scan has already walked the disk.
  let embeddingProvider;
  if (embeddingsEnabled) {
    const name = embeddingConfiguration.provider.trim();
    if (name !== httpEmbeddings.HTTP_JSON_PROVIDER) {
      fail(
        `--embedding-provider '${name}' is not a provider this CLI can run. This package ships `
        + `one: '${httpEmbeddings.HTTP_JSON_PROVIDER}', which POSTs {model, input} to `
        + "--embedding-endpoint and reads a vector back. Any other provider is supplied in "
        + "process through the EmbeddingProvider interface exported from corpus_embeddings.",
        2,
      );
    }
    try {
      embeddingProvider = new httpEmbeddings.HttpJsonEmbeddingProvider({
        endpoint: embeddingConfiguration.endpoint ?? "",
        modelId: embeddingConfiguration.model_id,
        locality: embeddingConfiguration.locality,
        ...(embeddingConfiguration.model_revision !== undefined
          ? { modelRevision: embeddingConfiguration.model_revision }
          : {}),
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error), 2);
    }
  }

  const embeddingPairThreshold = numericOpt(cli, "--embedding-pair-threshold");

  const packBudget = {};
  const packMaxArtifacts = numericOpt(cli, "--reasoning-pack-max-artifacts");
  const packMaxChars = numericOpt(cli, "--reasoning-pack-max-chars");
  if (packMaxArtifacts !== undefined) packBudget.maxArtifactsPerPack = packMaxArtifacts;
  if (packMaxChars !== undefined) packBudget.maxTotalPackCharacters = packMaxChars;

  let result;
  try {
    result = await scan.runCorpusScan({
      roots: specs,
      producerVersion: version,
      ...(cache !== undefined ? { cache } : {}),
      session,
      ...(previousSnapshot !== undefined ? { previousSnapshot } : {}),
      expandArchives: !cli.flag("--no-expand-archives"),
      interpret: !cli.flag("--no-interpret"),
      archivePolicy: collectPolicy(cli),
      ...(omitPatterns.length ? { omitPatterns } : {}),
      ...(omitFile !== undefined ? { omitFile } : {}),
      ...(hashMaxBytes !== undefined ? { hashMaxBytes } : {}),
      nearDuplicates: {
        enabled: !cli.flag("--no-near-duplicates"),
        ...(nearDuplicateThreshold !== undefined ? { threshold: nearDuplicateThreshold } : {}),
      },
      topics: {
        enabled: !cli.flag("--no-topic-candidates"),
        ...(topicThreshold !== undefined ? { threshold: topicThreshold } : {}),
      },
      budgets: collectBudgets(cli),
      corpusId,
      observedAt: new Date().toISOString(),
      verification: cli.flag("--incremental") ? "incremental" : "full",
      verifyContent: cli.flag("--verify-content"),
      allowInferredRootHistory: cli.flag("--allow-inferred-root-history"),
      allowPartialRoots: cli.flag("--allow-partial-roots"),
      semanticAnalysis: !cli.flag("--no-semantic-analysis"),
      ...(embeddingProvider !== undefined ? { embeddingProvider } : {}),
      ...(embeddingPairThreshold !== undefined ? { embeddingPairThreshold } : {}),
      ...(Object.keys(packBudget).length > 0 ? { packBudget } : {}),
    });
  } catch (error) {
    session.fail({
      code: "corpus.scan_failed",
      severity: "error",
      message: error instanceof Error ? error.message : String(error),
    });
    session.save(new Date().toISOString());
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  // Every projection of one run goes into one generation directory, and a single
  // atomic switch of CURRENT.json makes the whole set visible at once. Paths here
  // are relative to that directory, not to the output root.
  const outputs = [
    { path: "corpus-snapshot.json", contents: snapshotModule.renderCorpusSnapshot(result.snapshot) },
    { path: "corpus-candidates.json", contents: scan.renderCorpusCandidates(result.candidates) },
    { path: "readiness-evidence.json", contents: scan.renderReadinessEvidence(result.readiness) },
    { path: "corpus-coverage.json", contents: coverageModule.renderCorpusCoverage(result.coverage) },
    { path: "document-index.json", contents: documentsModule.renderDocumentIndex(result.documentIndex) },
    { path: "document-signals.json", contents: signalsModule.renderCorpusDocumentSignals(result.documentSignals) },
    // The report above samples its evidence records. These two are the machine
    // contract: every structured work signal, and a receipt saying how many there
    // are and hashing what was written.
    { path: "document-work-signals.jsonl", contents: result.documentWorkSignals.payloadJsonl },
    { path: "document-work-signals.manifest.json", contents: result.documentWorkSignals.manifestJson },
  ];
  if (result.semantic !== null) {
    outputs.push(
      { path: "semantic-relations.json", contents: semanticRun.renderSemanticRelations(result.semantic.relations) },
      { path: "topic-candidates.json", contents: semanticRun.renderTopicCandidates(result.semantic.topics) },
      { path: "project-candidates.json", contents: semanticRun.renderProjectCandidates(result.semantic.projects) },
      { path: "consolidation-candidates.json", contents: semanticRun.renderConsolidationCandidates(result.semantic.consolidations) },
      { path: "reasoning-candidates.jsonl", contents: semanticRun.renderReasoningCandidates(result.semantic.reasoningCandidates) },
      { path: "reasoning-evidence-packs.jsonl", contents: semanticRun.renderReasoningEvidencePacks(result.semantic.evidencePacks) },
    );
  }
  // A diff from a previous run describes a comparison this run did not make. It
  // is simply absent from this generation rather than deleted from a shared
  // directory: a generation holds what its run produced, so there is nothing
  // left over to remove.
  if (result.diff !== null) {
    outputs.push({ path: "corpus-diff.json", contents: diffModule.renderCorpusDiff(result.diff) });
  }

  // Each root's own outputs, under its own directory. The bundle is produced by
  // the canonical emitter into a scratch directory and then read back as files,
  // so the per-root bundles land through the same staged-and-renamed commit as
  // every other projection rather than through a second, unguarded write path.
  const bundleScratch = fs.mkdtempSync(path.join(os.tmpdir(), "l9-corpus-bundles-"));
  try {
    for (const root of result.rootPackets) {
      const rootDir = `roots/${root.directory}`;
      const staged = path.join(bundleScratch, root.directory);
      repositoryModel.emitRepositoryModelBundle(root.packet, { outDir: staged });
      for (const relative of listFilesRecursively(staged, ordering.compareCodePoints)) {
        outputs.push({
          path: `${rootDir}/bundle/${relative.split(path.sep).join("/")}`,
          contents: fs.readFileSync(path.join(staged, relative), "utf8"),
        });
      }
      outputs.push(
        {
          path: `${rootDir}/local-source-manifest.json`,
          contents: `${JSON.stringify(root.localSourceManifest, null, 2)}\n`,
        },
        {
          path: `${rootDir}/document-index.json`,
          contents: documentsModule.renderDocumentIndex(root.documentIndex),
        },
        {
          path: `${rootDir}/document-coverage.json`,
          contents: scan.renderDocumentCoverage(root.documentCoverage),
        },
      );
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  } finally {
    fs.rmSync(bundleScratch, { recursive: true, force: true });
  }
  // The canonical packet, emitted from the generation this run just computed.
  //
  // This is the contract boundary. Every other file here is a projection whose
  // layout is this repository's business; the bundle below is what a consumer
  // is entitled to read, and it is versioned, hash-bound and validated before it
  // is written. It is built in memory from `result` rather than by re-reading
  // the files above, so it cannot describe a generation different from the one
  // it ships beside.
  //
  // A packet that fails its own referential validation fails the run. Publishing
  // the generation without it would leave a consumer to fall back to reading the
  // directory, which is the arrangement this packet exists to end.
  const corpusIntelligenceCreatedAt = new Date().toISOString();
  try {
    const built = corpusIntelligence.buildCorpusIntelligencePacket(
      corpusIntelligenceInput.corpusIntelligenceInput(result, {
        producerVersion: version,
        createdAt: corpusIntelligenceCreatedAt,
      }),
    );
    const bundle = corpusIntelligence.buildCorpusIntelligenceBundle(built.packet, built.payload, {
      createdAt: corpusIntelligenceCreatedAt,
    });
    for (const file of bundle.files) {
      outputs.push({
        path: `${corpusIntelligence.CORPUS_INTELLIGENCE_DIRECTORY}/${file.path}`,
        contents: file.contents,
      });
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  // The index names every other document, so it is built once the output set is
  // final — including the ones this run decided not to write.
  const indexModule = requireBuilt(path.join(repo, "dist", "corpus_index.js"));
  const corpusIndex = indexModule.buildCorpusIndex({
    snapshot: result.snapshot,
    // The coverage document and the document signals, so the report a person
    // reads states what was understood beside what was written.
    coverage: result.coverage,
    documentSignals: result.documentSignals,
    rootDirectories: new Map(result.rootPackets.map((root) => [root.root_id, root.directory])),
    writtenPaths: [
      ...outputs.map((file) => file.path),
      "corpus-index.json",
      "corpus-report.md",
    ],
  });
  outputs.push(
    { path: "corpus-index.json", contents: indexModule.renderCorpusIndex(corpusIndex) },
    { path: "corpus-report.md", contents: indexModule.renderCorpusIndexReport(corpusIndex) },
  );

  // One directory, then one rename. A crash anywhere in the write leaves the
  // previous generation intact and reachable, because CURRENT.json has not
  // moved; a crash during the rename leaves one pointer or the other, because a
  // rename is atomic. There is no moment at which a reader can see half of this
  // run beside half of the last one.
  const published = publishModule.publishCorpusGeneration({
    outDir,
    files: outputs,
    committedAt: new Date().toISOString(),
    ...(generationsKept !== undefined ? { keep: generationsKept } : {}),
  });
  const written = outputs.map((file) => `${published.generation_id.slice(-12)}/${file.path}`);
  session.save(new Date().toISOString());

  reportCorpusRun({
    result,
    cacheEnabled,
    cache,
    resumed,
    written,
    sessionPath,
    published,
  });
}

function main() {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.corpusMode) {
    runCorpusMode(cli).catch((error) => fail(error instanceof Error ? error.message : String(error)));
    return;
  }
  const target = path.resolve(cli.target);
  if (!fs.existsSync(target)) fail(`path does not exist: ${target}`, 2);

  const repo = path.resolve(__dirname, "..");
  const model = requireBuilt(path.join(repo, "dist", "local_source_model.js"));
  const { version } = require(path.join(repo, "package.json"));
  const repositoryModel = requireBuilt(path.join(repo, "dist", "public", "repository_model.js"));

  const outDir = path.resolve(cli.opt("--out", path.join(os.tmpdir(), "l9-local-source-out")));
  const bundleDir = path.join(outDir, "bundle");
  const generatedAt = cli.opt("--generated-at", "");
  const hashMaxBytes = numericOpt(cli, "--hash-max-bytes");
  const sourceKind = cli.opt("--source-kind", "auto");
  const omitPatterns = cli.optAll("--omit");
  const omitFile = cli.opt("--omit-file", undefined);
  const nearDuplicateThreshold = unitIntervalOpt(cli, "--near-duplicate-threshold");
  const nearDuplicatesEnabled = !cli.flag("--no-near-duplicates");

  let result;
  try {
    result = model.observeLocalSourceModel({
      path: target,
      sourceKind,
      name: cli.opt("--name", ""),
      expandArchives: !cli.flag("--no-expand-archives"),
      interpret: !cli.flag("--no-interpret"),
      archivePolicy: collectPolicy(cli),
      ...(omitPatterns.length ? { omitPatterns } : {}),
      ...(omitFile !== undefined ? { omitFile } : {}),
      ...(hashMaxBytes !== undefined ? { hashMaxBytes } : {}),
      producerVersion: version,
      ...(generatedAt ? { generatedAt } : {}),
    });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
    return;
  }

  const { packet, observation } = result;
  try {
    const emitted = repositoryModel.emitRepositoryModelBundle(packet, {
      outDir: bundleDir,
      ...(generatedAt ? { generatedAt } : {}),
    });
    const manifest = model.buildLocalSourceManifest(observation, {
      // Operational only. Never part of any identity this package computes.
      observedAt: new Date().toISOString(),
    });
    const manifestPath = model.writeLocalSourceManifest(
      manifest,
      path.join(outDir, "local-source-manifest.json"),
      target,
    );

    // Built while the staged member bytes are still on disk: the similarity pass
    // reads an archive member's text exactly as it reads a physical file's.
    const corpus = model.buildLocalSourceCorpus(result, {
      nearDuplicates: {
        enabled: nearDuplicatesEnabled,
        ...(nearDuplicateThreshold !== undefined ? { threshold: nearDuplicateThreshold } : {}),
      },
    });
    const corpusPaths = model.writeLocalSourceCorpus(
      corpus,
      {
        indexPath: path.join(outDir, "corpus-index.json"),
        reportPath: path.join(outDir, "corpus-report.md"),
      },
      target,
    );

    const held = observation.archives.filter((archive) => !archive.expanded);
    const unsupportedEncodings = observation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "local-source.unsupported_encoding",
    ).length;
    const symlinks = observation.diagnostics.filter(
      (diagnostic) => diagnostic.code === "local-source.symlink_not_traversed",
    ).length;

    console.log(`${LABEL}: OK`);
    console.log("  the source was NOT modified: no file was written, renamed, or removed under it");
    console.log(`  source_kind      ${observation.sourceKind}`);
    console.log(`  source_revision  ${observation.sourceRevision}`);
    console.log(`  snapshot_hash    ${observation.physicalSnapshotHash}`);
    console.log(`  archives         ${observation.archives.length} observed, ${held.length} held (not expanded)`);
    console.log(`  archive members  ${observation.virtualArtifacts.length} observed`);
    console.log(`  symlinks         ${symlinks} observed, 0 followed`);
    console.log(`  encodings        ${unsupportedEncodings} file(s) not valid UTF-8 (hashed, not interpreted)`);
    console.log(`  artifacts        ${packet.payload.artifacts.length}`);
    console.log(`  relationships    ${packet.payload.relationships.length}`);
    console.log(`  assertions       ${packet.payload.assertions.length}`);
    console.log(`  diagnostics      ${packet.payload.diagnostics.length}`);
    console.log(`  packet_id        ${emitted.packetId}`);
    console.log(`  semantic_hash    ${emitted.semanticHash}`);
    console.log(`  bundle           ${emitted.bundleRoot}`);
    console.log(`  manifest         ${manifestPath}`);

    const summary = corpus.index.summary;
    console.log(`  work signals     ${summary.artifacts_with_work_signals} artifact(s) with work signals`);
    console.log(`  open tasks       ${summary.open_task_count} (${summary.completed_task_count} completed)`);
    console.log(`  declared kinds   ${summary.plan_count} plan(s), ${summary.roadmap_count} roadmap(s)`);
    console.log(`  declared status  ${summary.wip_count} WIP, ${summary.draft_count} draft, ${summary.blocked_count} blocked`);
    console.log(
      `  exact duplicates ${summary.exact_duplicate_cluster_count} cluster(s), `
      + `${summary.exact_duplicate_artifact_count} file(s), ${summary.recoverable_duplicate_bytes} recoverable byte(s)`,
    );
    console.log(
      `  near-duplicates  ${summary.near_duplicate_candidate_count} candidate(s) at threshold `
      + `${corpus.index.analysis_profile.near_duplicate_threshold}`
      + `${nearDuplicatesEnabled ? "" : " (analysis disabled)"}`,
    );
    console.log("  near-duplicate candidates are lexical similarity only; they claim no shared topic");
    console.log(`  corpus index     ${corpusPaths.indexPath}`);
    console.log(`  corpus report    ${corpusPaths.reportPath}`);
    for (const archive of held) {
      console.log(`  held: ${archive.sourcePath} — ${archive.holds.map((hold) => hold.code).join(", ")}`);
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    observation.dispose();
  }
}

main();
