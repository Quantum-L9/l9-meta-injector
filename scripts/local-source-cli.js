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
  "  --topic-threshold F        topic candidate vocabulary overlap in [0,1] (default: 0.35)",
  "  --no-topic-candidates      skip topic candidate analysis",
  "  --max-decoder-workers N    documents decoded concurrently (default: 4)",
  "  --max-hash-workers N       recorded; acquisition hashes each root with one reader",
  "  --max-analysis-workers N   recorded; candidate analysis is a single pass",
  "  --max-embedding-workers N  recorded; embeddings are not enabled in this release",
  "  --max-memory-bytes N       ceiling on decoded text held at once (default: 256 MiB)",
  "",
  "semantic candidate discovery (on by default):",
  "  --no-semantic-analysis     skip candidate discovery; duplicates still reported",
  "  --embeddings               enable optional semantic embeddings (default: off)",
  "  --embedding-provider NAME  required when --embeddings is given",
  "  --embedding-model ID       required when --embeddings is given",
  "  --embedding-model-revision R   recorded when the provider exposes one",
  "  --embedding-endpoint URL   required for a remote provider; must be https://",
  "  --embedding-locality K     local (default) or remote",
  "  --allow-remote-embeddings  permit a remote provider to receive bounded document",
  "                             text; enabling embeddings alone does NOT imply this",
  "                             (this release ships no provider: --embeddings is",
  "                             refused, and the similarity thresholds are set",
  "                             programmatically, not from this CLI)",
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

/** Every file under `root`, as root-relative POSIX paths, in code-point order. */
function listFilesRecursively(root, prefix = "") {
  const out = [];
  for (const entry of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) out.push(...listFilesRecursively(root, relative));
    else out.push(relative);
  }
  return out.sort();
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

/** Resource budgets, defaulted by the engine and overridable one at a time. */
function collectBudgets(cli) {
  const budgets = {};
  // The contract names these workers; the older --max-parallel-* spellings are
  // kept so an existing invocation does not break, and the newer name wins when
  // both are given.
  const map = {
    max_parallel_hashers: ["--max-hash-workers", "--max-parallel-hashers"],
    max_parallel_decoders: ["--max-decoder-workers", "--max-parallel-decoders"],
    max_parallel_analysis: ["--max-analysis-workers"],
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
  const { result, cacheEnabled, cache, resumed, written, sessionPath } = context;
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
  console.log(`  embeddings       not enabled; no model was called and no network request was made`);
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
    console.log(
      `  embeddings       ${semantic.embeddingReport.enabled ? "on" : "off"}, remote `
      + `${semantic.embeddingReport.remote ? "on" : "off"}`,
    );
    console.log("  no model was called: this pass is deterministic and makes zero LLM calls");
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
    console.log(
      `  invalidation     ${result.diff.invalidation.new_content_hashes.length} new content hash(es); `
      + `${result.diff.invalidation.retained_content_hash_count} reusable; `
      + `${result.diff.invalidation.cache_entries_removed} cache entries removed`,
    );
  }
  console.log("  no ranking, score or priority is produced; readiness evidence is counts and citations");
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
  const semanticRun = requireBuilt(path.join(repo, "dist", "corpus_semantic_run.js"));
  const documentsModule = requireBuilt(path.join(repo, "dist", "corpus_documents.js"));
  const embeddingsModule = requireBuilt(path.join(repo, "dist", "corpus_embeddings.js"));
  const repositoryModel = requireBuilt(path.join(repo, "dist", "public", "repository_model.js"));
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
      };
    }),
    budgets,
    now: new Date().toISOString(),
    resume: cli.flag("--resume"),
  });
  const resumed = session.resumedCounts;
  session.save(new Date().toISOString());

  const snapshotPath = path.join(outDir, "corpus-snapshot.json");
  const previousPath = cli.opt("--previous-snapshot", snapshotPath);
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
  if (embeddingsEnabled) {
    // The provider interface is an operator's to supply. This package ships no
    // model, so there is nothing to call, and saying so beats embedding nothing
    // and reporting a coverage of zero as though a model had run.
    fail(
      "embeddings are enabled but this release ships no embedding provider. The provider "
      + "interface is exported from corpus_embeddings for an operator to implement; the CLI "
      + "cannot invoke one yet. Re-run without --embeddings.",
      2,
    );
  }

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
      allowPartialRoots: cli.flag("--allow-partial-roots"),
      semanticAnalysis: !cli.flag("--no-semantic-analysis"),
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

  // Every projection is staged and then renamed, so a reader never sees a
  // coverage report describing one corpus beside a readiness document describing
  // another.
  const diffPath = path.join(outDir, "corpus-diff.json");
  const outputs = [
    { path: snapshotPath, contents: snapshotModule.renderCorpusSnapshot(result.snapshot) },
    { path: path.join(outDir, "corpus-candidates.json"), contents: scan.renderCorpusCandidates(result.candidates) },
    { path: path.join(outDir, "readiness-evidence.json"), contents: scan.renderReadinessEvidence(result.readiness) },
    { path: path.join(outDir, "corpus-coverage.json"), contents: coverageModule.renderCorpusCoverage(result.coverage) },
    { path: path.join(outDir, "document-index.json"), contents: documentsModule.renderDocumentIndex(result.documentIndex) },
  ];
  if (result.semantic !== null) {
    outputs.push(
      { path: path.join(outDir, "semantic-relations.json"), contents: semanticRun.renderSemanticRelations(result.semantic.relations) },
      { path: path.join(outDir, "topic-candidates.json"), contents: semanticRun.renderTopicCandidates(result.semantic.topics) },
      { path: path.join(outDir, "project-candidates.json"), contents: semanticRun.renderProjectCandidates(result.semantic.projects) },
      { path: path.join(outDir, "consolidation-candidates.json"), contents: semanticRun.renderConsolidationCandidates(result.semantic.consolidations) },
      { path: path.join(outDir, "reasoning-candidates.jsonl"), contents: semanticRun.renderReasoningCandidates(result.semantic.reasoningCandidates) },
      { path: path.join(outDir, "reasoning-evidence-packs.jsonl"), contents: semanticRun.renderReasoningEvidencePacks(result.semantic.evidencePacks) },
    );
  }
  if (result.diff !== null) {
    outputs.push({ path: diffPath, contents: diffModule.renderCorpusDiff(result.diff) });
  }

  // Each root's own outputs, under its own directory. The bundle is produced by
  // the canonical emitter into a scratch directory and then read back as files,
  // so the per-root bundles land through the same staged-and-renamed commit as
  // every other projection rather than through a second, unguarded write path.
  const bundleScratch = fs.mkdtempSync(path.join(os.tmpdir(), "l9-corpus-bundles-"));
  try {
    for (const root of result.rootPackets) {
      const rootDir = path.join(outDir, "roots", root.directory);
      const staged = path.join(bundleScratch, root.directory);
      repositoryModel.emitRepositoryModelBundle(root.packet, { outDir: staged });
      for (const relative of listFilesRecursively(staged)) {
        outputs.push({
          path: path.join(rootDir, "bundle", relative),
          contents: fs.readFileSync(path.join(staged, relative), "utf8"),
        });
      }
      outputs.push(
        {
          path: path.join(rootDir, "local-source-manifest.json"),
          contents: `${JSON.stringify(root.localSourceManifest, null, 2)}\n`,
        },
        {
          path: path.join(rootDir, "document-index.json"),
          contents: documentsModule.renderDocumentIndex(root.documentIndex),
        },
        {
          path: path.join(rootDir, "document-coverage.json"),
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
  // The index names every other document, so it is built once the output set is
  // final — including the ones this run decided not to write.
  const indexModule = requireBuilt(path.join(repo, "dist", "corpus_index.js"));
  const corpusIndex = indexModule.buildCorpusIndex({
    snapshot: result.snapshot,
    rootDirectories: new Map(result.rootPackets.map((root) => [root.root_id, root.directory])),
    writtenPaths: [
      ...outputs.map((file) => path.relative(outDir, file.path).split(path.sep).join("/")),
      "corpus-index.json",
      "corpus-report.md",
    ],
  });
  outputs.push(
    { path: path.join(outDir, "corpus-index.json"), contents: indexModule.renderCorpusIndex(corpusIndex) },
    { path: path.join(outDir, "corpus-report.md"), contents: indexModule.renderCorpusIndexReport(corpusIndex) },
  );

  // A diff from a previous run describes a comparison this run did not make, and
  // nothing inside the file says so. It leaves with the rest of the output set.
  const written = sessionModule.commitCorpusOutputs({
    files: outputs,
    remove: result.diff === null ? [diffPath] : [],
  });
  session.save(new Date().toISOString());

  reportCorpusRun({
    result,
    cacheEnabled,
    cache,
    resumed,
    written,
    sessionPath,
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
