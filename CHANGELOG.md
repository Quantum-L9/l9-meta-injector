# l9-meta-injector CHANGELOG

## Unreleased

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
