# l9-meta-injector CHANGELOG

## Unreleased

### Added

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

### Notes

- Emitted packets are byte-deterministic and independent of the local checkout path. Capabilities and relationships are emitted only where repository evidence supports them; unsupported domains stay empty and are reported as diagnostics. Interpretation is declared-or-observed only: no model, no network, no cross-repository inference.
- The interpretation profile participates in packet identity, so packet semantic hashes change for every repository. The `l9.repository-model` wire contract is unchanged at 1.0.0; facts it has no field for are preserved as evidence plus a `contract-field-unavailable` diagnostic.
- Canonical local-source observation supersedes sibling `*.l9extracted` materialization (ADR-036). The `PipelineConfig.localFiles` materialization workflow remains for callers that intend to modify their tree, hardened by the two fixes above; documentation now distinguishes observation, annotation and materialization, and `npm run inventory` is no longer described as non-destructive because it annotates by default.
- v1 expands ZIP only. `tar`, `gz`, `7z`, `rar` and similar are classified as archives, hashed, and reported as not expanded; no external tool is consulted to guess at them. A preflight or budget violation holds the whole archive rather than yielding a partial view: the archive is still observed and hashed and none of its members are claimed.
- Local-source packets declare their own observation profile, so packets built from a Git checkout keep the identity and golden bundles they already had. A source that changes between the two enumerations is reported and refused rather than published as a torn snapshot.
- No runtime dependency on `l9-constellation-topology`, Python, or the network is introduced. `npm run validate` remains runnable without a second repository.

## 4.0.0 - 2026-08-01

### Breaking

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
