# l9-meta-injector CHANGELOG

## Unreleased

Correctness remediation of the bf66978 audit (plan `l9-meta-injector-remediation-bf66978`, READY work units). Each unit lands as one commit with failing-before / passing-after regression tests named by their `REG-WU-*` ids. Units blocked on owner decisions (ADR-057..071) are not included.

### Breaking

Consumer-visible refusals and input-handling changes in this release. Which release line ships them is the owner's call (ADR-069); this heading carries no version label. The Wave 2 "Breaking or consumer-coordinated" list below also applies.

- **Authority configuration (ADR-057).** `parseAuthorityYaml` refuses plain `null`/`~`/booleans, `key:value` without a space, a plain value containing `: `, and an empty block list such as `inline_allow:` with no items. A consumer `.l9/meta-authority.yaml` that parsed before can now fail with `META_AUTHORITY_CONFIG_INVALID` (WU-017).
- **Omit patterns (ADR-058).** A pattern with a slash anywhere but the end is anchored at the root, as in gitignore. `dir/file` no longer matches nested copies; migrate with `**/dir/file` (WU-006).
- **Carrier values with control characters (ADR-057).** A key holding a C0 control character or U+007F, or a JSON-inlined value holding U+007F, is refused with `CARRIER_UNREPRESENTABLE` (audit G07).
- **`splitCsvLine`.** A `"` opens a quoted field only as the field's first character (RFC 4180), so a cell such as `27"` keeps its quote (audit F10).

### Changed

- **Consumer-visible version bumps.** Each bump changes derived ids, cache keys or profile hashes once:
  - `manifest/v1` extractor and every line extractor: 1.0.0 → 1.1.0. `DOCUMENT_BLOCK_PROFILE_VERSION`: 1.1.0.
  - `MANIFEST_DECODER_VERSION` and `PROJECT_CANDIDATE_METHOD_VERSION`: 1.1.0, so project candidate ids move.
  - `FUSION_PROFILE_VERSION`: 1.1.0, so semantic candidate ids move.
  - `READINESS_PROFILE_VERSION`: 1.1.0.
  - PDF decoder: 1.0.0 → 1.4.0.
  - DOCX, PPTX and XLSX decoders: 1.1.0. HTML and CSV decoders: 1.2.0. Text and notebook decoders: 1.1.0.
- `DecoderBudget` gains `maxContainerUncompressedBytes` (default 256 MiB, 8 × the per-part limit), the aggregate decompression allowance for one OOXML container (WU-061).
- Inventory excludes a nested custom `outDir` by its exact root-relative path; same-named directories elsewhere are now inventoried (WU-078). Only a harvested `inventory_type` is compared with the classification, so repositories with pipeline-annotated docs see a one-time repository-model snapshot hash change (WU-081).
- Placement plans carry repository-relative `sourcePath` and the resolved namespace (WU-010). Dry-run verification reports what a real run would verify and accounts for every eligible file; a new coverage reason `carrier_inline_blocked` and optional `inlineCarrierBlock` field name inline-carrier holds (WU-009).
- The local-source canonical packet is blocked by any unreadable file, directory or entry, and a single-file or archive source whose bytes cannot be hashed is refused at acquisition (WU-035). `LocalSourceObservation` gains an optional `hashingStats` field (WU-040). A built repository-model packet carries `validation.status` and `receipt_ref` only for validation that actually ran (WU-030).
- Identity-bearing diagnostics carry portable error codes instead of absolute host paths (WU-028).
- Embedding runs record `reported_model_revision`; a run whose responses report two revisions fails, the pool stops on the first failure, and vectors are validated (WU-051). The HTTP timeout covers the whole request including the body read (WU-052).
- `FileTransactionResult` gains an optional `cleanupPending`; governed apply reports it as a warning (WU-004).
- ZIP rewrites preserve each kept member's original central record and the archive comment; a member whose offset needs Zip64 holds as `archive.zip64` (WU-031).
- `.github/dependabot.yml` limits both version-update groups to minor and patch updates, so a major version of any package arrives as its own individual pull request instead of inside a group. The first grouped branch (#108) paired TypeScript 7 with typescript-eslint 8, whose peer range stops at 5.x, and could not install, which also blocked the minor and patch updates sharing it (ADR-056 amendment). Minor and patch updates still land through the groups and `npm run deps:rebind`.

### Fixed

- Frontmatter: opaque managed values reconcile by their verbatim text, so a real value is not replaced by a placeholder and a second run writes nothing (WU-003). Pipeline `content_hash` covers exactly the body the patcher preserves (WU-012). normalize-filenames sidecars are excluded from discovery and hard-skipped by the carrier policy (WU-013). LLM assist results are normalised to the declared field shape (WU-015). Skills dry-run applies the real-run eligibility filter (WU-018). Operation-mode lookup refuses `Object.prototype` names (WU-008). The discovery-glob validator refuses trailing-slash patterns that can never match, suggesting `dir/**` (WU-007).
- Extractors: TOML tables and arrays of tables, PEP 621 and nested JSON manifests are read correctly (WU-019); extractor regexes run in linear time and line splitting honours BOM and CR (WU-020); fence exclusion follows CommonMark and duplicate title readings are removed (WU-021); the block reader finds milestone sections as the Markdown reader does (WU-022); stacked route decorators are all recorded (WU-023).
- Corpus: project containers, declared identifiers (`pom.xml` `artifactId`, JSON top-level keys) and root-level keys are resolved correctly and empty candidates are not emitted (WU-047); `decode_gap.encoding_rejected` counts the statuses actually recorded (WU-044); partial-root failures are keyed by root identity (WU-045); readiness archive identity is unique across roots (WU-046); `stat_precheck` reuses the hashing stat (WU-040); fusion computes `cross_root` and the confidence class and supersedes within a member structurally (WU-048); the reasoning-pack character budget bounds the rendered pack (WU-053); diff invalidation uses the real analysis inputs (WU-054); readiness conflicts compare status classes (WU-055); the work-signal export verifier recomputes manifest counts (WU-056); output containment holds when a root is `/` (WU-080), and the same holds for the local-source scratch-parent check.
- Documents: the PDF decoder bounds every inflate and the per-document total, stores CMap ranges, and computes object extents once (WU-057); resolves indirect lengths, object streams, the page tree and trailer `/Info` (WU-058); and tokenizes text by operand stack with per-font ToUnicode and positioning (WU-059). XML text nodes are delivered faithfully, DOCX `w:t` runs are harvested, and a markup tag's end is found outside quoted attribute values (WU-060). OOXML parts are located through their `.rels` relationships, PPTX speaker notes included; decompression is bounded per container; XLSX cells without an `r` attribute take their implied reference (WU-061). HTML `script`/`style` (and `noembed`, `noframes`) contents are raw text, the block model is complete, and the HTML 4.01 named references (plus `apos`) decode (WU-062). CSV records split only after quote-aware parsing (WU-063). Text and notebook line classification runs in linear time, notebook fences are respected, a BOM is not content, and ATX closing sequences are stripped (WU-064).
- Archives and inventory: TAR members join the ustar prefix, and root meta is recognised by one canonical identity (WU-031); gunzip stops at the budget in both variants (WU-077); `inventory.csv` quotes carriage returns (WU-082); the macOS tag projection decodes tags once and plist reads remove their temp directory (WU-079; closure on macOS outstanding).
- Local source: only verified regular files are opened (WU-033); output containment resolves symlinks and the CLI writes nothing before it passes (WU-036); the validated `scratchParent` is the one used (WU-037); `local-source-cli` cleans up on every exit and accepts thresholds only in [0, 1] (WU-067).
- Authority and transactions: the transaction journal's bookkeeping and commit/rollback use compare-and-swap (WU-004); the authority scan evaluates every invocation in linear time (WU-025); authority loading refuses symlinked path components and broken links (WU-026); semantic-foundation verification refuses duplicate `artifact_id` claims (WU-027).
- Scripts: `gitBinary` resolves absolute paths only (WU-069); selfpack fails when its baseline is missing (WU-071); the validation-report verdict is parsed structurally (WU-072); the topology read-only guard removes only its own interpreter output (WU-073).

### Wave 2 — decision-blocked units (ADR-057..073)

The repository owner adopted the plan's recommended option for every blocking decision. Each decision is recorded in the ADR named with its entry.

#### Breaking or consumer-coordinated

- **Corpus-intelligence packet 1.1.0 (ADR-068).** `domains_not_run` names the payload domains that no pass populated, and lexical topic candidates are now carried. `l9.corpus-coverage/v2` adds `interpretation_enabled`; `interpretation_coverage` is null when interpretation is off, and the CLI says so instead of printing 0/0. `l9.corpus-qualification-report/v2` replaces `text_decoder_id`/`text_decoder_version` with `decoder_coverage.decoder_profiles` and adds `interpretation_enabled`. `l9-constellation-topology` must accept the new packet version and the `domains_not_run` field before it can ingest these bundles (WU-049).
- **Corpus-mode index schema (ADR-067).** A `--root` run's `corpus-index.json` now declares `l9.corpus-mode-index/v1` instead of `l9.corpus-index/v1`. Single-root output is unchanged (WU-043).
- **Action `mode: apply` with `fail-on-issues: 'false'` (ADR-069).** This combination, or `--no-fail-on-issues`, is now an input error (exit 2). `action.yml` documented it as advisory verification, which was never implemented. ADR-069 leaves the v4-versus-v5 versioning call to the owner (WU-066).
- **Publication decision schema v2 (ADR-070).** The decision now carries `approved_version`. `check:publication` requires the three ADR-015 evidence ids and a verified owner approval bound to the package version. Preparing a new version resets an approval to blocked (WU-068).

#### Changed

- **Comment carriers (ADR-057).**
  - Headers are placed after mandatory prologues: an XML declaration, a bare `<?php` line, a Python or Ruby encoding cookie, CSS `@charset`, and Dockerfile parser directives.
  - PHP templates, and XML or `@charset` prologues that do not end their line, use a sidecar.
  - Blocks misplaced by earlier versions are repaired once on the next write.
  - `.ql` and `.sass` use `//` line comments (WU-001).
- **Metadata ids (ADR-071).** Non-ASCII path characters are kept as `u<hex>` tokens instead of being erased. Ids for non-ASCII paths change once, and `check` reports them stale until `apply` rewrites them. ASCII ids are unchanged (WU-016).
- **Metadata index (ADR-058).**
  - Records are ordered by code point. ASCII and most BMP paths keep their order.
  - Glob `?` matches one code point.
  - The index writer and parser enforce the record schema.
  - In governed `check`/`apply`, an eligible text path the index cannot represent is held as `unsupported_entry`, so `check` reports it and `apply` refuses (WU-006; narrowed by audit G02, see below).
- Omit-pattern anchoring is listed under Breaking (WU-006).
- **Repository model (ADR-062).** Package managers, governance references and ADR references come only from the repository root (governance also from `.github/` and `docs/`). Repository-scoped claims from nested files and archive members are filed against their own artifact. `package.json` alone no longer implies npm. Interpretation profile 1.2.0 (WU-029).
- **Corpus cache (ADR-059).** The cache epoch is `l9.corpus-cache-entry/v2`, so the first run after upgrade is cold. The decoder-declared dialect (Markdown, TSV) enters `normalized_document_id` and its cache key. Text decoder 1.2.0, CSV decoder 1.3.0 (WU-038, WU-039).
- **Archive reader 1.2.0 (ADR-061).** Cached archive verdicts are recomputed once (WU-032).
- **Direct CLIs (ADR-069).** The inventory, pipeline, check, apply, skills and repository-model CLIs reject unknown options, missing values, duplicate options, out-of-range `--near-dup`/`--hash-prefix-length` values and malformed `--namespace-glob` pairs with exit 2, before doing any work (WU-066).
- **Authority scan (ADR-072).**
  - Symlinked control directories are reported as `META_AUTHORITY_SCAN_INCOMPLETE`.
  - A nested `.l9/meta-authority.yaml` under `docs/`, `tests/`, `fixtures/`, `build/`, `dist/`, `coverage/`, `reports/` or a caller-excluded directory is a conflict.
  - `.git`, `node_modules`, `.venv` and `__pycache__` are not searched (WU-024).
- **Corpus generations (ADR-066).** Retention keeps the N most recently published generations. `CURRENT.json` gains `previous_generation_ids`. Publishing takes an exclusive `.corpus-publish.lock` in the output root (WU-042).
- **Inventory (ADR-065).** `inventory.md` reports duplicate clusters as same carrier-free content and no longer reports "recoverable" bytes (WU-075).

#### Fixed

- **Carrier values (ADR-057).** Values are escaped so they cannot end or break the host comment (`--`, `*/`, `#{`, CR, U+2028/2029, the end sentinel). A value that cannot be escaped refuses with `CARRIER_UNREPRESENTABLE`. Managed blocks are recognised only at the head position, so sentinel text in a file body is preserved. A shebang or `<?php` line without a trailing newline round-trips exactly (WU-001, WU-002).
- **Narrow YAML readers (ADR-057).** The meta-schema, authority, extractor and frontmatter-patcher readers match YAML for the subset they accept, or refuse; the `parseAuthorityYaml` refusals are listed under Breaking (WU-017).
- **Scoped runs (ADR-058).** A `--glob`-scoped `apply` merges with the existing `.l9/metadata-index.jsonl` instead of dropping out-of-scope records. A scoped run over an unparseable index refuses with `METADATA_INDEX_UNMERGEABLE`, and apply's compare-and-swap binds to the index the plan merged with (WU-005).
- **Inventory re-runs (ADR-060).**
  - Live re-runs converge: carrier clocks are carried while content is unchanged, and byte-identical carriers and sidecars are not rewritten.
  - Hand-authored sidecars are held with a diagnostic.
  - An I/O failure during an archive rewrite becomes a recorded hold (WU-074).
  - A rewritten archive is re-observed before its sidecar is written (WU-076).
- **Archive admission (ADR-061).**
  - A member whose declared extent does not fit, or that produces a byte count other than it declares, is held instead of crashing the run.
  - A file and a directory whose names differ only by case or Unicode normalization hold the archive with `archive.path_conflict`.
  - Typeless Unix-mode entries are classified by name (WU-032).
- **Member locators (ADR-063).** A locator that another record could also spell holds the archive with `archive.locator_ambiguous`. Archive ancestry comes from the parent chain (WU-034).
- **Corpus derive stage (ADR-059).** Bytes are verified against the acquisition hash before anything is derived or cached. A file changed or unreadable mid-scan is reported per file and never cached (WU-038). The indexed near-duplicate and topic passes equal their exhaustive references at boundary thresholds (WU-041).
- **Document index.** Artifacts refused before decoding report that reason, the claiming decoder and `byte_length: null` (WU-050).
- **Pipeline (ADR-073).** A `DUPLICATE_METADATA_ID` refusal caused by files already in the tree happens before archive expansion and filename normalization, so a refused run leaves the tree unchanged (WU-011).
- **LLM adapter (ADR-064).** Each pipeline and skills run uses its own LLM adapter, endpoint, credential and metrics, so concurrent runs no longer mix and a run no longer resets the caller's adapter (WU-014).
- **Action outputs.** Outputs come only from each child's own summary line, so a crashed check or apply reports `verification-passed=false`. Paths containing NUL, CR or LF are refused (WU-065).
- **Release versions.** Versions with leading zeros are rejected, and exact consumer pins such as `@v4.1.0` are no longer rewritten (WU-070).

### Audit remediation of #112 and #113 (ADR-074..077)

Fixes for the 2026-10-28 audit of the wave 1 and wave 2 heads (`f3096e5`, `ebc0dd3`). Each behavioural fix carries a `REG-AUDIT-<id>` regression test that fails on `ebc0dd3` and passes here.

#### Changed

- **Version bumps.** Each one changes cache keys, derived ids or profile hashes once: PDF decoder 1.4.0, DOCX decoder 1.3.0, HTML decoder 1.3.0, CSV decoder 1.4.0, text decoder 1.3.0, notebook decoder 1.2.0, and the `python-route-observation/v1` extractor 1.2.0. The golden repository-model and local-source bundles were regenerated for the extractor bump, and topology conformance was re-proven against the consumer at `fe85ed9`.
- **PDF inflate allowance (F04).** An inflate strategy that fails after inflating, for example on a bad adler32, is now charged to the document's decompression allowance: a success after k failures is charged (k+1) × its output, and an all-fail stream min(ceiling, input × 1032) per attempt. Damaged PDFs reach the aggregate limit sooner.
- **Corpus publication (G01, ADR-077).** Taking over a stale `.corpus-publish.lock` happens only under an exclusive `.corpus-publish.lock.takeover` guard, so two publishers that see the same stale lock can no longer both own it. The guard is transient; a guard left by a crashed process on the same host is reaped by the next takeover.
- **Local source (F13).** `writeLocalSourceManifest` and `writeLocalSourceCorpus` again return `path.resolve(target)`, the path as given; containment and the write still use the resolved real path.
- **Release preparation (N01).** `prepare-release.js` keeps the `Amended by` lines of ADR-050 when it regenerates the ADR.
- **README.** The Action `Outputs` line lists all five outputs and their per-mode meaning, as `action.yml` does.

#### Fixed

- **PDF object scan (F01, F02, F03, F06, F07).** Object headers are found in one linear pass. Long runs of unclosed `(`, unterminated streams and long digit runs no longer cost quadratic time. An unterminated literal string ends at its object's `endobj` instead of swallowing later objects up to a stray `)`. `stream` is a keyword only after `>>` and before an end of line, in the scanner and in object parsing (N04), so a name such as `/a-stream` no longer hides objects or misplaces stream data. On well-formed files the one behaviour change is that a literal string containing the word `endobj` ends there, as before #112. The lexical header scan itself came from the review fix `e339f36` in #112.
- **PDF text (F05).** The parts of a `/Contents` array are joined with a newline and tokenized as one stream, so a font chosen by `Tf` in one part applies to text in later parts.
- **Office and HTML (F09, F12).** A self-closing `w:del`, `w:delText`, `w:moveFrom`, `w:t` or `mc:AlternateContent` no longer ends the surrounding deletion, run or frame early. A table nested in a cell is decoded as its own table, and the outer table keeps its rows.
- **CSV and line ends (F10, F15, N02).** A quote inside an unquoted field no longer pulls following lines into its record. A lone CR ends a line in text blocks and notebook code cells, so line numbers match the extractors.
- **YAML lexers (G03, G07).** A quote after a `:` with no following blank, or after a `[` that does not open a flow list, is plain text, so a trailing comment is dropped instead of kept in the value. Carrier strings holding C0 control characters (other than TAB, LF and CR) or U+007F are double-quoted with `\xNN` escapes for every carrier, so `<!-- -->` blocks stay well-formed and values round-trip exactly.
- **Discovery (G02, G15).** The index-path hold applies only to governed `check`/`apply`, after the binary and encoding probes. A non-governed `runPipelineAsync` no longer refuses a tree with `DISCOVERY_INCOMPLETE`, public `findFiles` returns such files again, and a binary with an unrepresentable path is `known_binary`, not blocking. `.php` files are again eligible as "known text extension".
- **Corpus intelligence (G06).** Lexical project and topic clusters take `cross_archive` from the archive parent chain (ADR-063), so a physical directory named like `notes!/` is not treated as an archive.
- **Inventory (G05).** A `--schema` that renames a field sourced from `content_hash`, `created_at` or `modified_at` no longer writes it into an archive's embedded `.l9meta.yaml`, so such archives converge instead of being rewritten on every run.
- **Interpretation (F11).** Stacked route decorators with the same verb and path on different routers yield one `http.route_handler` assertion instead of two drafts with the same id.

#### Notes

- **Hardening (G04).** The frontmatter inline-comment splitter counts `[` only at a scalar start and never below zero. The audited overwrite is not reachable today, because the scalar readers refuse such values; the change and its tests guard the case if those readers widen.
- **Declined (F08).** Dry-run `bodyPreserved` was not changed. The claimed fail-open does not reproduce: 400k fuzzed carrier inputs and 4,500 dry-run files never produced a false planned `bodyPreserved`.
- **Correction.** The wave 1 reasoning-pack budget (WU-053) keeps list entries by greedy best fit in priority order, not as a prefix as its commit message said.
- **Records.** ADR-074 records the Action output contract of WU-065 (DEC-RC-100 option B, DEC-GAR-04). ADR-075 records DEC-RC-107 and the strict SemVer release grammar. ADR-076 corrects ADR-058 and ADR-069.
- **Outstanding.** The v4-versus-v5 versioning of the ADR-069 `fail-on-issues` change stays with the owner. The macOS-only Finder-tag regression test (WU-079) still has no macOS CI runner.

## 4.2.0 - 2026-10-22

Minor release: the public API surface is additive and `packet_version` stays 1.1.0. One change is breaking for a narrower audience: consumers that compare metadata `id` values across versions see every id move (ADR-054, below).

### Added

- `.l9/meta-authority.yaml` may declare `l9.meta-authority/v2`: cite Semantic Foundation ledgers by `artifact_id` and sha256 at one `Quantum-L9/.github` revision, and declare this product as Dependency / `semantic-subsystem@1`. Pipeline and inventory derive header `authority`/`namespace` from that binding (ADR-052). The bound identity is applied after harvested metadata, so adopting a binding migrates files annotated earlier, and a bound pipeline refuses a `namespaceGlobs` entry that names anything but `product.id` with `META_AUTHORITY_IDENTITY_MISMATCH` instead of letting a per-glob value override the binding.
- `resolveHeaderIdentity` / `verifySemanticFoundation` and `npm run semantics:verify` (offline; not part of `npm run validate`).
- A bound root stamps header `owner` from `product.owner`, refuses a `--namespace-glob` whose namespace is not `product.id`, skips the literal `shared`/`core` verify rule, and records the binding on `PipelineResult.semanticBinding` and `coverage-report.json` `semantic_binding` (ADR-053). Unbound roots stay unchanged. A custom `--schema` targeting `file_header` cannot displace the bound `owner`, `authority` or `namespace`; its other fields are still carried.
- `Topology conformance` workflow: every pull request and push to `main` checks out `Quantum-L9/l9-constellation-topology` read-only at the revision `docs/topology-conformance.json` binds to, proves the committed golden bundles still match the record and are accepted by that consumer, and compiles a local-source packet of this repository under the consumer's profile, failing unless its validation receipt passes. A weekly run checks the consumer's `main` so drift is visible before a release pins it.
- `.github/dependabot.yml` groups npm updates, and `npm run deps:rebind` lands a dependency group as one validated commit pair (ADR-056).

### Changed

- The test toolchain is vitest 5.0.5 with vite 8 and `@types/node` 22; `devEngines.runtime` declares Node 22.12 for working on this repository and `CI / smoke` runs on Node 22. `engines.node` stays `>=18` for consumers. The bump closes seven npm advisories, two critical (tinypool, `@vitest/mocker`), and supersedes Dependabot #101–#106.
- Every repository record in a Repository Model Packet cites an observed inventory-walk evidence record, so a record claiming `validated-machine` authority never carries empty `evidence_refs` (ADR-055). The `dependencies` coverage diagnostic is emitted only when no manifest declared a dependency. Both golden bundles and `docs/topology-conformance.json` are rebound to the consumer at `fe85ed9`.

- **Identity change (ADR-054).** Metadata ids are the repo-relative path with the extension kept behind `__`. A second run recomputes `id`, `source_path`, `content_hash`, and `token_cost_estimate`. Two paths that normalize to one id refuse the run before any write. Dry-run diffs mirror `source_path` under the output directory. Keyword-only skill, playbook, kernel, and doctrine classifications become context. `hard_skip` files are coverage-only; `inventory_only` files stay in the metadata index and are not injected.
- Inventory annotation no longer stamps `namespace: inventory`, `authority: inventory`, or `token_cost_estimate: 0`. Taxonomy fields derive from `classify` and `PRIMITIVE_TAXONOMY`, `sharing_scope` from `resolveNamespace`, and token cost from `estimateTokens`; otherwise the field is `Unknown` (ADR-051).
- Inventory `content_hash` for UTF-8 regular files is the SHA-256 of the body with the L9 managed carrier removed, so a second run is stable and duplicate clusters still match after annotation.

### Fixed

- Inventory records `clock_skew:<clock>_after_inspected_at` when `created_at` or `modified_at` is later than `inspected_at`, without rewriting the observed clocks. The comparison is made on parsed instants, so an `inspected_at` with a UTC offset or a different precision is judged chronologically rather than by string order.
- The repository model keeps clock-skew notes out of the semantic hash and out of packet diagnostics. They compare filesystem timestamps with the inventory clock, both of which belong to the checkout; letting them through made the semantic hash change when the same tree was copied to another path.
- Inventory classifies, estimates tokens for, and size-limits the carrier-free body. A second run over an annotated tree no longer estimates the generated header, and a body within `hashMaxBytes` stays hashed after its header pushes the physical file past the limit.
- A previously written inventory header whose fields equal the old placeholder literals is migrated on the next run instead of being harvested forever.
- The semantic classifier recognizes Jest's `__fixtures__/` and `__mocks__/` directories as fixtures, so JavaScript and TypeScript test-support files under them classify as `test` instead of injectable `source`.
- `resolveHeaderIdentity` returned binding conflicts through a conditional that produced the same value on both branches; the conflicts are returned directly. The ledger-id patterns use the digit shorthand.
- `CODEOWNERS` names the repository owner for source, `dist/`, decisions, contracts, CI and dependency files; the one-shot `pr89-closure.yml` workflow (`contents: write`) is removed; `.l9/ci.json` declares the `owner` the organization consumer schema admits, as AGENTS.md already described; the CI tables in AGENTS.md and `docs/architecture.md` list every workflow in the tree.

## 4.1.0 - 2026-09-17

### Fixed

- Archive preflight now holds a ZIP that declares one path as a file and uses it as a directory (`archive.path_conflict`), and one whose path component is longer than any filesystem stores (`archive.path_too_long`). Both verdicts are order-independent; previously `a` before `a/b` threw `EEXIST` out of member staging and leaked the scratch root, and the reverse order was mis-held as an unreadable format. The canonical reader version is `1.1.0` (ADR-046).
- `acquireLocalSource` disposes its scratch root when an exception escapes archive staging, and rethrows host failures instead of reporting them as `archive.format_unreadable`.
- `src/archive_formats.ts` is the single owner of archive extensions and byte signatures. The inventory classifier, the strategy resolver, the acquirer and the legacy expander agree on `.tar`, `.tgz`, `.tbz`, `.tbz2`, `.txz`, `.tzst`, `.gz`, `.bz2`, `.xz`, `.zst`, `.lz4`, `.7z`, `.rar`, `.jar`, `.war`, `.cab`, `.iso` and `.zip`; the reader version is declared once. A file whose bytes carry an archive signature its name does not declare is recorded (`archive_signature:<format>`) and diagnosed (`local-source.archive_signature_detected`) instead of passing silently; it is still never opened.
- Comment injection keeps the file's newline convention, keeps a byte-order mark at byte 0, and reads a CRLF block back without stray carriage returns, so a second run replaces the block instead of stacking one.
- The injector, its inject log, both inventory sidecars and the archive sidecar write through `replaceFileAtomically`: staged beside the target, synced, renamed in, mode preserved, symlink targets refused. A crash can no longer truncate a source, and injecting into a file hard-linked from outside the governed root no longer rewrites the outside file.
- `runPipelineAsync` refuses an output or index directory equal to the root and omits one nested inside it, so a second run no longer annotates the first run's reports.
- A real `localFiles` run judges the tree before it materializes anything: a symlink, unreadable or unsupported entry now refuses the run with `DISCOVERY_INCOMPLETE` and no `*.l9extracted/` directory or archive sidecar left behind. Previously archives were extracted first and the refusal came afterwards.
- Every ordering on the filesystem, discovery, transaction, carrier, authority and skills paths is code-point (`compareCodePoints`); the inventory walk and the nested-archive walk sort directory entries, so record order and nested-archive budget order no longer depend on the host filesystem or locale.
- `inventoryTree` records symlinks and special entries (`artifact_type: unknown`, `symlink_not_traversed` / `special_filesystem_entry`) instead of dropping them, and never opens or annotates them.
- `CURRENT_VALIDATION_REPORT.md` is bound to the tree it describes again; `npm run validate` on a clean checkout of `main` had been failing on the stale binding.
- `scripts/pipeline-cli.js` and the README no longer claim that `--local-files` requires system `unzip` or extracts during `--dry-run`.
- The discovery scope (`--glob`, `PipelineConfig.glob`, the dispatcher's `L9_INPUT_GLOB`) is honored as a whole-path pattern through the same dialect the authority's `inline_allow` uses (`src/glob.ts`). Previously only a trailing `*.ext` was applied, so `docs/**/*.md` planned and mutated `other/b.md`; an absolute, parent-relative or unsupported (brace, class, negation) scope is now refused with the reason before any directory is read, and the ledger records `glob_filtered` (ADR-047).
- `executeFileTransaction` restores the recorded original mode (or the intent's mode) on the staging descriptor, so a restrictive umask no longer commits `0o775` as `0o700`; it also refuses any `.git` segment, `.l9/meta-authority.yaml` and its own `.l9/.transactions` as targets.
- `runCheckAsync` with `localFiles` reports a hostile or unreadable ZIP, and every non-expandable archive format, as `unsupported` drift instead of throwing; an unreadable directory in the read-only snapshot is reported rather than aborting the check.
- The authority scan reports every nested `.l9/meta-authority.yaml` as `META_AUTHORITY_CONFLICT`, so a subtree declaring a different policy fails the governed modes closed instead of silently inheriting the root policy.
- Header detection (`splitContent`, `stripExistingFrontMatter`) looks past a leading byte-order mark and consumes a CRLF closing-fence line, so a governed apply over a BOM-prefixed markdown file no longer fails its own verification and rolls the whole run back, and a CRLF file no longer leaves the metadata index stale for one run (its body hash was recorded with a stray `\r`).

### Added

- `src/glob.ts` (`globToRegExp`, `compileDiscoveryGlob`, `assertDiscoveryGlob`), the `glob_filtered` discovery disposition, and ADR-047 with tests for scope, transaction modes and protected targets, check archive inspection, unreadable entries and nested authorities.
- `tests/tarball_rejection_matrix.test.ts` and `tests/helpers/tar_fixtures.ts`: every TAR and compressed-tarball spelling, and every hostile TAR shape (traversal, absolute and drive paths, symlink and hard-link escapes, chained links, devices, FIFOs, setuid, GNU long names, PAX paths, sparse, size lies, duplicates, case and Unicode collisions, bad checksums, truncation, trailing bytes, concatenation, many members, nesting) is proven to be classified, hashed, reported as not expanded, and never written anywhere, on every ingestion surface.

- Added the stable `l9-meta-injector/repository-model` entrypoint, which builds, validates, and emits a deterministic `l9.repository-model` packet bundle from inventory evidence (ADR-030).
- Added `scripts/repository-model-cli.js` (`npm run repository-model`) for executable packet egress.
- Added `scripts/topology-conformance.js` (`L9_TOPOLOGY_CHECKOUT=<checkout> npm run topology:conformance`), which proves the emitted bundle is accepted by the real `l9-constellation-topology` consumer from an ephemeral read-only checkout, and records the bound revision in `docs/topology-conformance.json`.

- Added `AuthorityNotice` and `CheckResult`/`ApplyResult.authorityNotices` for non-blocking authority findings, including the `migration_only` allowance (ADR-034).
- Added `docs/output-placement-contract.md` as the single documented source of truth for where every entrypoint writes.
- Added read-only local-source acquisition (ADR-036): `acquireLocalSource` observes an arbitrary file, ordinary folder, external-drive tree, synced folder, or ZIP archive without requiring Git and without modifying the source. Archives stage into tool-owned scratch and their members become virtual artifacts named `Bundle.zip!/docs/a.md`, nesting as `outer.zip!/inner.zip!/src/b.py`, each with the digest of its exact bytes and a `DERIVED_FROM` relationship to its archive.
- Added `scripts/local-source-cli.js` (`npm run local-source`), which emits a Repository Model Packet bundle plus an acquisition manifest and states explicitly that the source was not modified. Budget flags: `--no-expand-archives`, `--max-archive-bytes`, `--max-members`, `--max-member-bytes`, `--max-expanded-bytes`, `--max-session-bytes`, `--max-compression-ratio`, `--max-archive-depth`.
- Added a self-contained ZIP central-directory reader and member preflight (`src/zip_reader.ts`, `src/archive_preflight.ts`). Canonical archive observation no longer runs a `unzip` subprocess as its security boundary, and no dependency was added: Node's own zlib does the decompression under an explicit output ceiling.
- Added `LocalArchivePolicy` (`src/local_archive_policy.ts`): conservative, documented, configurable limits on archive size, member count, per-member/per-archive/per-session expansion, compression ratio, nesting depth, path length and processing time, enforced against declared metadata and again against the bytes actually produced.
- Added whole-file UTF-8 validation in bounded memory (`src/encoding.ts`).
- Added a second topology conformance subject: a committed non-Git local source with a nested archive, whose golden bundle the bound `l9-constellation-topology` consumer accepts with no translation shim.
- Added corpus intelligence (ADR-037). `npm run local-source` now also emits `corpus-index.json` (`l9.corpus-index/v1`) and `corpus-report.md` beside the packet bundle, with `--near-duplicate-threshold F` (default `0.85`) and `--no-near-duplicates`.
- Added artifact-scoped assertion subjects. `Extractor.subjectScope` is `"repository"` (the default, and what every pre-existing extractor keeps) or `"artifact"`; an artifact-scoped assertion attaches to the exact file that made it, including a member of a nested archive at its virtual locator. `buildRepositoryModelPacket` preserves the subject instead of rewriting every assertion onto the repository, and producer validation now accepts a repository id or an emitted artifact id. `repositoryModelArtifactId` is exported so packet building and interpretation share one identity formula. The `l9.repository-model` contract stays at `1.1.0` and the bound `l9-constellation-topology` consumer accepts artifact subjects with no translation shim.
- Added the `document-structure/v1` and `work-intelligence/v1` extractors over UTF-8 `.md`, `.markdown`, `.txt` and `.rst`: titles, headings, `work.status`, `work.kind`, open and completed tasks, milestones, and the `depends_on` / `blocked_by` / `references` / `supersedes` / `superseded_by` predicates. Every rule reads a form the author chose deliberately; status is never inferred from file age, path, TODO count, or the absence of a signal, and a document that contradicts itself keeps both claims. The interpretation profile moves to `1.1.0`. Every pattern in the profile is linear on adversarial input: these documents come out of archives this package does not control, so a super-linear pattern is a denial of service rather than a style problem.
- Added deterministic near-duplicate candidate analysis (`text-near-duplicate/v1`): the exact Jaccard overlap of unique 5-token shingles over NFKC-normalized, lowercased, whitespace-collapsed text, at a configurable threshold. Candidate generation runs through a shingle index that is held to a bounded all-pairs reference implementation in tests. A candidate is lexical similarity only — never a shared topic, a shared project, a supersession, or a recommendation to merge or delete.
- Added `src/ordering.ts`, the single code-point comparator and canonical pair ordering shared by inventory, acquisition and packet egress.
- Added `docs/corpus-intelligence.md`.

- Added multi-root corpus archaeology (ADR-038). `npm run local-source -- --root PATH [--root PATH …]` reads several disks, folders and archive collections as one corpus and emits `corpus-snapshot.json`, `corpus-candidates.json`, `readiness-evidence.json`, `corpus-coverage.json`, `corpus-diff.json` and `corpus-session.json`. `--root-manifest FILE` accepts a `l9.corpus-roots/v1` document or a plain list of paths. Single-source mode is unchanged and still runs when no `--root` is given.
- Added two root identities that answer different questions. `root_id` comes from the root's declared key — its own final path segment, or `--root PATH=NAME` — so `/Volumes/OldSSD` and `/mnt/recovered/OldSSD` are one root and a remount changes nothing; `root_snapshot_id` comes from the physical snapshot hash and changes whenever a byte does. Corpus identity is `H(sorted(root source revisions), corpus profile)`. Artifacts are addressed as `OldSSD::widget-api/PLAN.md` and identified by `H(root_id, root-relative path)`, so two roots holding `notes/monday.md` hold two artifacts. A root mounted twice is folded with a diagnostic; two roots claiming one key while holding different content are refused.
- Added a content-addressed cache with six layers — `raw_identity`, `normalized_document`, `interpretation`, `lexical_features`, `embedding`, `candidate_analysis` — under `~/.l9/corpus-cache` by default (`$L9_CORPUS_CACHE`, `--cache-dir`, `--no-cache`), refused inside any observed root. Acquisition never consults it: every byte is hashed on every run, so a warm run establishes that a document is unchanged before deciding not to open it. Every entry carries its schema, key, payload hash and producer version and is verified on read; a failed entry is discarded, recomputed and reported. `mtime` is a scheduling hint whose accuracy is measured and reported, and no code path lets it skip a hash or decide an identity. A cold run and a fully warm run produce byte-identical semantic output.
- Added `corpus-diff.json` (`l9.corpus-diff/v1`): `added`, `removed`, `changed_content`, `renamed_candidate`, `unchanged`, `archive_added`, `archive_removed`, `archive_changed`, plus an invalidation section naming the new content hashes, the reusable ones, and which cache layers that retires. A rename candidate is one content hash absent at an old corpus path and present at a new one — a deterministic observation about two paths, not a claim that anyone moved anything. No cache entry is ever removed because an artifact left the corpus.
- Added `readiness-evidence.json` (`l9.readiness-evidence/v1`): twelve per-artifact signals — source code, tests, build manifest, CI, container, deployment, specification, documentation, open tasks, blockers, roadmap, plan — each carrying the exact filename, path segment, extension or declared predicate that decided it and which of those four kinds of evidence it was. Body-of-work counts aggregate them per project candidate. `build_priority`, `strategic_value`, `percent_complete`, `production_readiness_score` and `abandonment_probability` are refused by name, restated in every emitted document, and asserted absent by a test that walks the document.
- Added project candidates (`container-project-candidate/v1`) and topic candidates (`lexical-topic-candidate/v1`), both crossing root boundaries. A project candidate is a container holding a build manifest or CI definition, keyed on the identifier the manifest *body* declared with the line it was read from, falling back to the container's own directory name; members go to the innermost container that claims them. A topic candidate is a connected group of documents whose salient vocabulary overlaps at `0.35` (`--topic-threshold`, `--no-topic-candidates`). Both are candidates: neither claims two documents mean the same thing, and neither ranks, names, merges or recommends anything.
- Added `corpus-coverage.json` (`l9.corpus-coverage/v1`): decode, interpretation, lexical and exact-hash coverage as ratios over what was eligible; unsupported text-bearing formats counted by extension with their bytes; OCR-required imagery, encrypted archive members, oversized documents and credential-path skips counted separately. The reasoning handoff points at the readiness evidence, the declared dependency assertions and the two duplicate classes, and produces no priority.
- Added `corpus-session.json` (`l9.corpus-session/v1`) and `--resume`. Completions are recorded by content-addressed key, so one attempt's completion is still true for the next and one that has stopped being true simply produces a different key. Concurrency and in-flight decoded bytes are bounded and configurable (`--max-parallel-decoders`, `--max-memory-bytes`). Every projection is staged and renamed together, so a reader sees either the previous complete set or the new one.
- Added `interpretDocumentContent` and `interpretationProfileHash`. `interpretRepository` now delegates to the former, so per-document interpretation has one implementation rather than two.
- Added `clusterExactDuplicates`, the corpus-scope entry point to the existing duplicate rule, sharing `duplicateRepresentative` and `compareDuplicateClusters` with `buildCorpusDuplicateClusters`.
- Added `docs/corpus-archaeology.md` and ADR-038.

- Added a `Makefile` with `pr-check` and `pr`. `make pr` is the sanctioned publish path: it runs `npm run lint` and `npm run validate`, refuses a dirty tree, then pushes and opens the pull request, so a push is never separable from the gate it claims to have passed. The Makefile is not part of the packed artifact.

- Added block-bound work signals (ADR-043). The work vocabulary — `work.status`, `work.kind`, open and completed tasks, milestones, and the `depends_on` / `blocked_by` / `references` / `supersedes` / `superseded_by` predicates — is now read out of every decoded document format, not only out of files that have lines. The recognizers return a reading carrying no position, and two callers attach the coordinate their own source has: a line span for a `.md`, `.txt` or `.rst` file, and a block id plus the structured locator the decoder emitted for a PDF, Word document, deck, worksheet, notebook, saved page or register. One implementation decides what a status declaration is, so a `.docx` plan and the `.md` copy beside it cannot be found to say different things. A Word checklist whose bullet lives in the document's numbering is read; a code block and a heading are never read as declarations; an excerpt shaped like a credential is refused rather than redacted. Block-bound claims reach readiness, the semantic passes, the reasoning evidence packs and the coverage counts, and deliberately never the Repository Model Packet, whose evidence class is a line span — the bound `l9-constellation-topology` consumer is unchanged and no dispatch was made.
- Added `document_block_profile` to `CorpusAnalysisIdentity`, beside `interpretation_profile` rather than folded into it: the two answer the same question about different sources, and a change to either must not invalidate both.
- Added the coverage law to the report a person reads. `corpus-report.md` and `corpus-index.json` now state exact observation, per-format decoding with eligible beside decoded beside *understood*, intelligence counts and the embedding report, so "we inspected this and found nothing" and "we could not understand this" are different rows rather than one total. A format decoded but never understood is a decoder wired to nothing, and it is now visible.
- Added mixed-format documents to the ten-thousand-artifact scale fixture. It previously held Markdown and manifests only, so the scale run measured the cheapest path through the scan and no decoder ran at scale; it now carries real PDF, DOCX, PPTX, XLSX, IPYNB, HTML and CSV documents sharing the filler's subject vocabulary, and each is required to be decoded, understood and named by a candidate at that size.

### Fixed

- Near-duplicate candidate generation no longer fails on a large corpus. The shingle index enumerated every pair sharing any shingle, which on a ten-thousand-document corpus with a heading common to every document exceeds the maximum size of a `Set` and aborts the run with `RangeError: Set maximum size exceeded` — a corpus of short similar notes is the normal case for an archive, not a synthetic one. The generator now uses an exact prefix-and-size filter: a pair whose shingle-set sizes differ by more than a factor of the threshold cannot qualify, and under a global rarest-first order a qualifying pair must intersect within each document's first `|X| - ceil(t·|X|) + 1` shingles. Both bounds follow from the definition of Jaccard, and the generator is held to the bounded all-pairs reference at seven thresholds and over a generated corpus with shared boilerplate. Rarest-first also keeps the shingles every document shares out of the index entirely.

- Assertion objects keep the characters the document wrote. Task, milestone, heading and title text was normalized with a global strip of `*`, `_` and backticks — correct for a value matched against a closed vocabulary, wrong for text quoted back as evidence. `- [ ] wire up user_profile_service` was recorded as `wire up userprofileservice`: an identifier present in no file, matching no search, while the assertion still claimed to cite its source line. Snake_case in a task or milestone is ordinary in engineering documents, so this was quietly losing real content. Emphasis is now removed only where it wraps the whole value; `normalizeTarget` already drew this line for relation targets.

- Local-source acquisition no longer discards its own duplicate analysis. It assembled a unified record set of physical files and virtual archive members and then returned `duplicates: []`, so the most common shape a real corpus has — the same file on disk and inside three backup ZIPs — was invisible. Clustering now runs over the complete record set.
- Duplicate clustering no longer uses `localeCompare` for path ordering or for the shortest-path tie-break, so cluster output stops varying with the host's ICU data and ambient locale.
- Observing a local archive no longer destroys user data. Expanding `Foo.zip` used to remove whatever occupied the sibling `Foo.l9extracted/` path first, on the strength of the pathname alone, so a user directory that merely shared the name was lost. Extraction now refuses to replace a target that carries no ownership marker, and recursive deletion is confined to a scratch root the run created and can still prove it owns (ADR-036).
- `--local-files` dry run performs zero source mutation. It previously extracted anyway and skipped only the sidecar, so the mode that promises to touch nothing touched the source tree. It now reports what a real run would extract, via `ArchiveRecord.heldReason`.
- Encoding eligibility is decided over every byte instead of an 8 KiB prefix, and a known-text extension no longer grants eligibility on its own. A `.md` file whose tail is Windows-1252 was previously eligible for inline injection, which decodes and rewrites the whole file and loses the tail; it is now hashed, diagnosed, and left alone. The same whole-file check gates interpretation, so an assertion's excerpt always matches the bytes its hash cites.
- A discovery candidate that cannot be opened is excluded with an explicit disposition whatever its extension, rather than being declared eligible unread.
- The topology conformance record and its test had drifted apart: the probe wrote a `subjects` array while the record and test still carried a single `subject`, so the record was stale and the test read a field the generator no longer wrote. Both now iterate every committed bundle.
- Boolean CLI flags (`--dry-run`, `--fail-on-issues`, `--llm`, `--llm-allow-insecure`) no longer consume the following option token, so `--dry-run --out reports` parses as intended. `--no-<flag>` is the explicit false form.
- `legacy_writers` now reaches a runtime authority decision instead of existing only in schema validation, and historical `L9_META` marker text plus an unrelated generic file write is no longer classified as an active competing metadata writer (ADR-034).
- Frontmatter outside the inline-patchable subset no longer aborts a repository-wide apply. The file's bytes are preserved, its metadata moves to the central manifest, and a deterministic diagnostic states why (ADR-035).
- An unquoted single-line scalar such as `created: 2025-10-28T15:30:00Z` is carried as an opaque field and preserved verbatim rather than failing inspection (ADR-035).
- `verify` recovers a frontmatter body using the same byte-exact derivation `inject` captured it with. A file that already carried frontmatter followed by a blank line previously failed a body-preservation postcondition and aborted governed apply (ADR-035).
- Refused applies and failing checks now render the authority conflict code, path, message, and evidence, deterministically ordered, with credential-shaped values redacted.
- Plan-mode runs no longer print a phantom `verification FAILED` banner for files that have not been written yet.

- The document index named the decoder that had not read the file. `decoder_id` and `decoder_version` were passed once and stamped on every row, so a `.docx` entry said the text decoder had opened it, and `normalized_document_id` — the key joining the index, the cache and every piece of evidence — was derived from that same fixed decoder. Each entry now names the decoder that actually read those bytes, the format it read them as, its block count and its locator type.
- An incremental scan recorded a different inventory from a full scan of the same unchanged bytes. The `unsupported_encoding` observation — "this file is not valid UTF-8 and is observed by hash only" — was pushed only when a file was freshly hashed; carrying a prior run's hash forward probed the encoding, held the result, and dropped the finding. The inventory is part of the Repository Model Packet, so an incremental scan of an untouched disk holding one Word document produced a different packet semantic hash, and through it a different `corpus_source_snapshot_id`, than a full scan of exactly those bytes. Reuse is only worth having if it lands on the same answer.
- The CSV decoder's smallest unit was the row, and `csv_row` has carried an unused optional `column` since it was defined. A row block's text is a rendering of the whole row — `owner: mel; status: blocked` — so a reader looking for a declaration found `owner` and stopped, and a register with a status column was understood only when the identical table happened to be a worksheet. The decoder (1.1.0) now emits a block per populated cell under its column's name.
- `EmbeddingCoverage` carries `secret_skipped_count`, so the document an operator reads to find out what left the machine also answers how many documents were refused before a byte of them could be sent.

### Notes

- Emitted packets are byte-deterministic and independent of the local checkout path. Capabilities and relationships are emitted only where repository evidence supports them; unsupported domains stay empty and are reported as diagnostics. Interpretation is declared-or-observed only: no model, no network, no cross-repository inference.
- The interpretation profile participates in packet identity, so packet semantic hashes change for every repository. The `l9.repository-model` wire contract is unchanged at 1.0.0; facts it has no field for are preserved as evidence plus a `contract-field-unavailable` diagnostic.
- Canonical local-source observation supersedes sibling `*.l9extracted` materialization (ADR-036). The `PipelineConfig.localFiles` materialization workflow remains for callers that intend to modify their tree, hardened by the two fixes above; documentation now distinguishes observation, annotation and materialization, and `npm run inventory` is no longer described as non-destructive because it annotates by default.
- v1 expands ZIP only. `tar`, `gz`, `7z`, `rar` and similar are classified as archives, hashed, and reported as not expanded; no external tool is consulted to guess at them. A preflight or budget violation holds the whole archive rather than yielding a partial view: the archive is still observed and hashed and none of its members are claimed.
- Local-source packets declare their own observation profile, so packets built from a Git checkout keep the identity and golden bundles they already had. A source that changes between the two enumerations is reported and refused rather than published as a torn snapshot.
- No runtime dependency on `l9-constellation-topology`, Python, or the network is introduced. `npm run validate` remains runnable without a second repository.

## 4.0.0 - 2026-08-01

### Breaking

- Bumped `l9.document-index/v1` to `l9.document-index/v2` and `l9.document-coverage/v1` to `l9.document-coverage/v2`. These correct what their predecessors said rather than adding to them: the single `decoder` field named one decoder for a corpus that seven of them read, and neither carried a format, a block count or a locator type. `decoder_profiles` replaces `decoder`. A reader must be able to tell an index whose decoder fields are accurate from one whose are not.
- Renamed the `document-signals.json` schema from `l9.corpus-document-signals/v1` to `l9.document-signals/v1`. A reader that understood the old name was reading a document of counts; this one also carries the claims themselves and the coordinates they were read at, which is a different contract rather than more of the same one.
- `corpus_analysis_id` moves for every corpus, because a new profile participates in it and more is now concluded. `corpus_source_snapshot_id` moves only for a corpus containing non-UTF-8 files previously scanned incrementally, where the incremental scan had been recording an inventory a full scan did not produce; the full scan was the correct one.

- Replaced syntax-selected metadata writes with explicit `hard_skip`, `inventory_only`, `central_manifest`, and `inline_managed` carrier authority.
- Made `.l9/metadata-index.jsonl` the canonical deterministic metadata store for non-inline subjects.
- Unified check and apply through one carrier plan and removed legacy adjacent-sidecar dispatch.
- Made apply a journaled whole-run transaction with compare-and-swap, rollback, and interrupted-run recovery.
- Replaced whole-header YAML serialization with byte-preserving managed-field frontmatter patching.

### Security and assurance

- Added fail-closed hidden control-surface authority scanning, strict operation modes, immutable Action pins, path containment, deterministic discovery, and exact repository-relative identity.
- Restricted ordinary inline YAML to plain Markdown and made ambiguous or complex frontmatter non-mutating.

### Distribution

- Added the `l9-meta-injector` executable to the packed artifact and included the runtime scripts needed for immutable Git-SHA consumption.
- Corrected the stale package-lock identity and added a release-candidate gate.

### Migration

- Added `docs/migrations/v3-to-v4.md`. Consumers must declare `.l9/meta-authority.yaml`, pin a 40-character release commit, and remove competing metadata writers.

### Carried forward

- `--local-files` archive expansion and the ADR-016 through ADR-018 omit/skills behavior introduced after 3.0.0 are included in this release.

## 3.0.0 - 2026-07-22

### Breaking

- Replaced the broad root barrel with an orchestration-first stable root.
- Added stable `./inventory` and `./schema` entrypoints.
- Added experimental `./advanced` and `./advanced/llm` entrypoints.
- Denied unlisted deep imports through an explicit package export map.

### Assurance

- Added separate runtime and declaration export inventories.
- Added source, package-map, installed-tarball, declaration, and deep-import validation.
- Added a publication decision gate so unresolved package history blocks publishing without blocking implementation or CI.

### Migration

- Added `docs/migrations/v2-to-v3.md` with import mappings.

## 2.1.0 - 2026-06-19

Introduced the TypeScript metadata injection pipeline, LLM-assisted prose reconciliation, namespace handling, filename normalization, and body-preserving verification.
