# l9-meta-injector

L9 metadata injection for classifying, normalizing, injecting, verifying, inventorying, and indexing prompt, skill, kernel, source, and repository artifacts.

## Package identity

- Package: `l9-meta-injector`
- API generation: 3
- Runtime authority: TypeScript under `src/`
- Distribution: committed `dist/`, proven by `npm run check:dist`
- Package proof: installed tarball tested by `npm run test:packed`

## Supported imports

```ts
import { runPipelineAsync, runSkillsPipelineAsync } from "l9-meta-injector";
import { inventoryTree } from "l9-meta-injector/inventory";
import { buildMetaV3 } from "l9-meta-injector/schema";
import { compilePlacementPlans } from "l9-meta-injector/advanced";
import { makeOpenAIAdapter } from "l9-meta-injector/advanced/llm";
```

The root is the stable orchestration boundary. `inventory` and `schema` are stable subpaths. `advanced` and `advanced/llm` are explicit experimental surfaces. Imports not listed in `package.json#exports` are unsupported and rejected.

**SKILL.md protection:** `inventory` and `pipeline` modes never mutate `SKILL.md` / `skill.md` (built-in omit). Use `runSkillsPipelineAsync` / `npm run skills` / Action `mode: skills` for Cursor-native description improvements (ADR-017).

**Omit:** built-in noise + SKILL.md protect, optional `.l9metaignore`, CLI `--omit` / `--omit-file`.

## GitHub Action

Publication to npm is currently blocked (see `check:publication` below), but this package is fully
consumable as a **GitHub composite action** — it runs directly against the pinned ref's committed
`dist/`, no build step and no npm registry needed. Drop this into any repo's workflow:

```yaml
# Observation only: classify + write an inventory manifest as a build artifact.
# `mode: inventory` defaults to dry-run, so the checked-out repo is not modified.
# (Setting `dry-run: "false"` turns this into annotation: it then writes metadata
# headers and sidecars into the checkout.) Safe as a first drop-in.
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: inventory
```

```yaml
# Real CI gate: inject + verify metadata, fail the job on verification drift
# (e.g. sharing_scope mismatches against the given namespace).
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: pipeline
    namespace: my-repo
    fail-on-issues: "true"
```

```yaml
# Cursor-native skills mode: material-improve SKILL.md description (Use when …).
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: skills
    llm: "true"
    llm-base-url: "https://api.openai.com/v1"
    llm-model: "gpt-5-nano"
    llm-api-key: ${{ secrets.OPENAI_API_KEY }}
```

```yaml
# Pipeline mode with LLM-assisted semantic classification. Composite actions cannot
# read the secrets context directly, so the calling workflow passes its own secret in
# as an input — never hardcode a key in `with:`.
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@main
  with:
    mode: pipeline
    namespace: my-repo
    llm: "true"
    llm-base-url: "https://api.openai.com/v1"
    llm-model: "gpt-5-nano" # cheapest OpenAI model as of 2026-07; ~$0.0001-0.0003/file, see TODO.md
    llm-api-key: ${{ secrets.OPENAI_API_KEY }}
```

| Input | Default | Notes |
|---|---|---|
| `mode` | `inventory` | `inventory` = classify + manifest. `pipeline` = scan→inject→verify→index. `skills` = Cursor-native skill description improve. |
| `root` | `.` | Directory to scan, relative to the calling repo's checkout. |
| `namespace` | *(repo name)* | `pipeline` mode only — stamped into placement/verification. |
| `dry-run` | `true` for `inventory`, `false` for `pipeline`/`skills` | `pipeline` verification requires real injected frontmatter, so a `pipeline` dry-run will always fail verification on prose files — pair `dry-run: "true"` with `fail-on-issues: "false"` if you want a preview-only pipeline pass. |
| `fail-on-issues` | `true` | `pipeline` mode only — gate the job on `verification.passed`. |
| `omit` | *(empty)* | Comma-separated gitignore-style patterns (built-ins always protect `SKILL.md` and skip bytecode/logs). |
| `upload-artifact` | `true` | Uploads the manifest/report directory as a workflow artifact. |
| `llm` | `false` | `pipeline`/`skills` — enable LLM-assisted field assist (falls back to local/no-op if `llm-base-url`/`llm-model`/`llm-api-key` are incomplete). |
| `llm-base-url` | *(none)* | OpenAI-chat-completions-compatible endpoint. |
| `llm-model` | *(none)* | Model name sent in the request body. |
| `llm-api-key` | *(none)* | Pass from the calling workflow's own secret, e.g. `${{ secrets.OPENAI_API_KEY }}`. Never hardcoded; read via env, never placed on the command line. |
| `llm-allow-insecure` | `false` | Allow a non-https `llm-base-url` (e.g. a self-hosted runner reaching a local model). |

### Local sources: any file, folder, drive, or ZIP

`npm run local-source -- <path> --name <name> --out <dir>` observes an arbitrary local
source read-only (ADR-036). The path may be a single file, an ordinary folder, an
external-drive tree, a synced folder, or a `.zip`. **It does not have to be a Git
repository, and it is never modified** — no file under it is written, renamed, or
removed, and nothing is extracted beside it.

```bash
npm run local-source -- /Volumes/Data/Folder --name Folder --out ./out
npm run local-source -- ~/Downloads/Bundle.zip --name Bundle --out ./out
npm run local-source -- ~/Documents/design.md  --name design --out ./out
```

Output is a Repository Model Packet bundle under `<out>/bundle`, an acquisition
manifest at `<out>/local-source-manifest.json`, and the corpus intelligence projection
described below. A corpus run publishes generationally — see **A whole result set
appears at once** below — so its documents live under
`<out>/generations/<id>/` and `<out>/CURRENT.json` names the generation to read.
None of them is ever written inside the observed tree.

What the observation guarantees:

- **Source immutability.** Archives are staged into tool-owned scratch outside the
  source. Recursive deletion is confined to a scratch root this run created and
  proved it owns; a directory is never removed because of its name.
- **Virtual archive members.** A member is `Bundle.zip!/docs/a.md` — machine
  independent, and nested as `outer.zip!/inner.zip!/src/b.py`. Each carries the digest
  of its exact bytes and a `DERIVED_FROM` link to its archive. Scratch paths never
  reach a packet.
- **ZIP only, in v1.** `tar`, `gz`, `7z`, `rar` and friends are classified as
  archives, hashed, and reported as not expanded. No external tool is consulted.
- **Bounded expansion.** Archive size, member count, per-member/per-archive/per-session
  expansion, compression ratio, nesting depth and path length are all capped, checked
  against the central directory *and* against the bytes actually produced. Any
  preflight or budget violation holds the whole archive: it is still observed and
  hashed, and none of its members are claimed.
- **Symlinks are not followed.** The link and its literal target text are recorded;
  the target's bytes are not read.
- **Secret-candidate files are not interpreted.** `Bundle.zip!/.env` keeps its path,
  size and digest, and contributes no excerpt and no assertion.
- **Encoding safety.** A file is validated as UTF-8 over every byte before it is
  decoded or mutated. A file that fails is hashed, diagnosed, and left alone.
- **Deterministic identity.** `file:sha256:…`, `archive:sha256:…`, or `fs:sha256:…`,
  derived from bytes and repository-relative paths. If the source changes mid-read,
  the run reports it and refuses to emit a packet rather than publishing a torn
  snapshot.

Budget flags: `--no-expand-archives`, `--max-archive-bytes`, `--max-members`,
`--max-member-bytes`, `--max-expanded-bytes`, `--max-session-bytes`,
`--max-compression-ratio`, `--max-archive-depth`. Run with no arguments for full usage.

What this trusts and refuses, and its known limits, is stated in
[`docs/local-source-trust-boundary.md`](docs/local-source-trust-boundary.md).
Moving off `--local-files`:
[`docs/migrations/local-files-to-local-source.md`](docs/migrations/local-files-to-local-source.md).

### Corpus intelligence

The same run also answers what the corpus *says about itself* (ADR-037), in two
deliberately separate epistemic classes.

- **Work intelligence.** Each `.md`, `.markdown`, `.txt` and `.rst` document is read for
  the things it declares outright — its title and headings, an explicit `Status:` or
  frontmatter `status`, a declared kind, checkbox and `TODO:` tasks, `Milestone:` lines,
  and `Depends on:` / `Blocked by:` / `See also:` / `Supersedes:` / `Superseded by:`
  pointers. Each claim attaches to the *artifact that made it*, including a member of a
  nested archive, and cites the exact line. Nothing is inferred from file age, path,
  TODO count, or the absence of a signal, and a document that contradicts itself keeps
  both claims.
- **Exact duplicates — a fact.** Two artifacts are duplicates when both carry a known
  content hash and those hashes are equal. Clusters span physical files and archive
  members freely, and are rendered as `DUPLICATE_OF` relations to a deterministic
  cluster representative. The representative is a rendering anchor, **not** a
  recommendation about which copy to keep.
- **Near-duplicates — a candidate, not a conclusion.** `text-near-duplicate/v1` scores
  the exact Jaccard overlap of unique 5-token shingles over normalized text, default
  threshold `0.85` (`--near-duplicate-threshold F`, or `--no-near-duplicates` to skip).
  A candidate means two documents share wording. It does **not** mean they share a
  topic, a project or an owner, that one supersedes the other, or that anything should
  be merged or deleted.

Nothing is moved, deleted, rewritten, consolidated or prioritized. Full semantics:
[`docs/corpus-intelligence.md`](docs/corpus-intelligence.md).

### Corpus archaeology across several disks

Passing one or more `--root` switches reads several roots as **one corpus** (ADR-038),
so the duplicate that spans two disks and the project whose files are split across them
stop being invisible.

```bash
npm run local-source -- \
  --root /Volumes/OldSSD \
  --root /Volumes/Backup \
  --root ~/ArchiveZips \
  --out ./corpus-out
```

- **A root is identified by its own name, not by where it is mounted.** `/Volumes/OldSSD`
  and `/mnt/recovered/OldSSD` are the same root, and the same corpus read from two
  different absolute paths produces byte-identical output. Every artifact is addressed
  as `OldSSD::widget-api/PLAN.md`, so two roots holding `notes/monday.md` hold two
  artifacts.
- **Unchanged bytes reuse the work already done on them.** Six content-addressed cache
  layers under `~/.l9/corpus-cache` (configurable, and refused inside an observed root)
  mean a second run decodes, interprets and tokenizes only what actually changed. Every
  byte is still hashed on every run: `mtime` is a scheduling hint whose accuracy is
  reported, and it never decides an identity. A cold run and a fully warm run produce
  byte-identical semantic output.
- **A corpus has two identities, and they mean different things.**
  `corpus_source_snapshot_id` says what the disks held; `corpus_analysis_id` says what
  was concluded and under which rules. Swapping an embedding model or raising a
  threshold moves the second and leaves the first alone, so a settings change is never
  reported as though the drives had been rewritten (ADR-041).
- **Every root keeps its own Repository Model Packet** under `roots/<root>/bundle/`,
  beside that root's acquisition manifest, document index and document coverage. A root
  is modelled exactly as it would be if observed alone, so it carries the same packet id
  into every corpus it is named in. The corpus is an analysis across roots, not a
  synthetic tree that replaces them.
- **A hash records how it was obtained.** `--incremental` carries a previous run's
  content hash forward when a file's size and mtime have not moved, and the snapshot is
  then `cached_unchanged_assumption` — never `fully_verified`, because filesystem
  metadata is a revalidation signal and not content truth. `--verify-content` reads
  every byte again and restores a verified snapshot.
- **A drive that is not plugged in stays visible.** By default an unreadable root fails
  the run. `--allow-partial-roots` records it in the snapshot with its reason, names it
  in `missing_root_ids`, and labels the corpus `partial` — never complete.
- **`corpus-diff.json`** classifies everything against the previous snapshot — added,
  removed, changed, renamed candidate, unchanged, the same four for archives, roots
  added, removed, changed and unchanged, and cross-root move candidates — and says
  exactly which cache layers that invalidates, separating a change to the rules from a
  change to the disks. Nothing is ever evicted because an artifact left the corpus.
  Candidate deltas are computed from each snapshot's analysis manifest and are reported
  as `null` with a stated reason when a snapshot has none — never as a zero that would
  read as "nothing changed".
- **A root says how much its identity is worth.** A key the operator declared is a name
  a person chose; a key inferred from a mount point's last segment is a good default
  and a weak identity, because `/Volumes/Backup` and an unrelated `/mnt/usb/Backup` key
  the same. Each root diff row states which it rests on, and a match not made between
  two declared keys raises a caution naming the root and the remedy.
- **`readiness-evidence.json`** carries twelve measurable signals per artifact — source,
  tests, build manifest, CI, container, deployment, specification, documentation, open
  tasks, blockers, roadmap, plan — each with the exact filename, path segment, extension
  or declared predicate that decided it, plus per-project counts. It contains **no**
  priority, score, percentage complete or abandonment estimate; those five names are
  refused explicitly and a test walks the emitted document to prove it.
- **`corpus-coverage.json`** says what the scan reached and what it did not: decode,
  interpretation and lexical coverage as ratios, unsupported formats counted by
  extension, OCR-required imagery, encrypted members, oversized documents and
  credential-path skips. `decode_gap` reconciles the eligible set against the decoded
  one cause by cause, with an `unaccounted` residual so a document lost by a route
  nobody named surfaces instead of vanishing into a difference of two totals.
- **Documents are decoded, not counted as unreadable** (ADR-042). PDF, DOCX, PPTX,
  XLSX, IPYNB, CSV and HTML are read into the same normalized form Markdown is, with
  **no new runtime dependency** — OOXML is a ZIP of XML parts and PDF's FlateDecode is
  Node's own `zlib`. Every block cites its own format's coordinate — a page and an
  index, a slide and a shape, a sheet and a cell, a notebook cell index — and no format
  without lines is ever given a line number. A scanned PDF reports `decoder.ocr_required`
  and an encrypted one `decoder.encrypted`; neither is silently an empty document. No
  notebook cell is executed, no spreadsheet formula evaluated, no macro run, no script
  run, and no external reference fetched.
- **A decoded document states what it says** (ADR-043). The work vocabulary —
  `work.status`, `work.kind`, `work.task.open`, `work.milestone`, `work.depends_on`,
  `work.blocked_by`, `work.supersedes` and the rest — is read out of every supported
  format by one implementation, so `Status: blocked` in a `.docx` and in the `.md` copy
  beside it produce the same claim. A Word checklist whose bullet lives in the document's
  numbering, a slide titled `Q3 Roadmap`, a worksheet cell reading `Status: blocked` and
  a register with a status column are each read, and each claim cites the coordinate its
  own format has rather than a line number the file does not have.
- **`document-signals.json`** (`l9.document-signals/v1`) reports, per format, what
  decoded, what refused it and why, which locator kinds it cited, how much of it a
  candidate actually named — and the claims themselves, each binding the artifact id,
  the raw content hash, the normalized document id, the decoder and version, the block,
  the structured locator, a bounded excerpt, the predicate and the object. Decoding that
  reaches nothing is a real failure and is invisible in a coverage ratio. The record
  listing is bounded per format; the counts beside it are complete, and the difference is
  stated rather than left to subtraction.
- **`document-work-signals.jsonl`** (`l9.document-work-signals/v1`) is the same claims
  again, and this time all of them. `document-signals.json` is a projection for a person
  reading it, so its listing stops at fifty records per format; a machine consumer needs
  the corpus rather than a readable share of it, so this file is written one JSON object
  per line with **no sample ceiling at any volume**. Each record carries both identities a
  consumer has to join on — the corpus `artifact_id` and the `rmp_artifact_id` naming the
  artifact inside its root's Repository Model Packet — beside the decoder, the block, the
  structured locator, the predicate, the object and a bounded excerpt.
  `document-work-signals.manifest.json` (`l9.document-work-signals-manifest/v1`) states the
  record count, the per-format and per-predicate totals, and two hashes: one over the exact
  bytes, one over the canonical records so it survives being moved. A consumer verifies the
  payload against the manifest before trusting a single record, and the counts agree with
  the report's complete counts — the report lists fewer, it never *knows* fewer.
- **`document-index.json`** (`l9.document-index/v2`) names, for every decoded document,
  the decoder that actually read it, the format it was read as, its block count and its
  locator type — and derives `normalized_document_id` from that decoder, because that id
  joins the index, the cache and every piece of evidence.
- **`corpus-report.md` states what was understood.** Exact observation, per-format
  decoding with eligible beside decoded beside *understood*, intelligence counts and the
  embedding report, so an operator can tell "we inspected this and found nothing" from
  "we could not understand this" without opening two JSON files and joining them by hand.
- **A whole result set appears at once.** Every projection of one run is written into
  `generations/<id>/` and a single atomic rename of `CURRENT.json` makes the set
  visible. A crash at any point leaves the whole previous generation or the whole new
  one, never a coverage report from one run beside a readiness document from another.
  `--keep-generations` bounds retention; pruning never touches what the pointer names.
- **Interrupted scans resume.** `corpus-session.json` records completions by
  content-addressed key; `--resume` picks them up. Cache and session writes are staged,
  fsynced, renamed, and the parent directory fsynced — a rename is atomic against a
  crashed process and not against a power cut. `--max-decoder-workers` bounds documents
  read concurrently and `--max-memory-bytes` bounds decoded text held at once; both are
  measured rather than recorded, and a budget that governed nothing was removed rather
  than documented.
- **A root nobody named cannot carry history.** A root's key is either *declared* — the
  operator wrote `--root /Volumes/OldSSD=OldSSD`, or a root manifest did — or *inferred*
  from the final path segment. Inferred keys are fine for a single run and are not an
  identity: two unrelated directories both called `Backup` infer the same key, so a
  previous-snapshot diff across them would report one drive's files as the other's
  deletions. So the three operations that claim a root is the same root it was last time
  — `--previous-snapshot`, `--resume`, and `--incremental` — **refuse** to run when either
  side of the match rests on an inferred key. The refusal names the root, both identity
  classes, and the two ways forward: declare the key, or pass
  `--allow-inferred-root-history` to say the basenames really do mean the same drive. The
  override is recorded in the snapshot's operational provenance, and it changes nothing
  about identity — it authorizes the comparison, it does not make the key declared.

No model is called and no network request is made unless an operator explicitly
configures an embedding endpoint. Full semantics:
[`docs/corpus-archaeology.md`](docs/corpus-archaeology.md). Running one at scale:
[`docs/corpus-scale-operation.md`](docs/corpus-scale-operation.md). What the cache is
and is not: [`docs/corpus-cache.md`](docs/corpus-cache.md).

### Legacy archive materialization

`npm run pipeline -- <root> --local-files` is a **mutating materialization** workflow,
not an observation one (ADR-016, hardened by ADR-036). It expands `.zip` archives into
sibling `*.l9extracted/` directories, writes `<zip>.l9meta.yaml` sidecars, and injects
the extracted members in place. It requires system `unzip`. Default pipeline mode still
skips archives.

It now refuses to replace an extraction target that carries no ownership marker — a
user directory named `Foo.l9extracted` is never deleted — and its dry run performs zero
source mutation, reporting what a real run would extract instead of extracting it.
Prefer `local-source` for anything you do not intend to modify.

`npm run skills -- <root> --llm …` runs Cursor-native skill mode (ADR-017).

**`npm run inventory` is not read-only.** Unlike the Action's `mode: inventory`, the
direct CLI defaults to annotation: it appends metadata headers to text files and writes
`.l9meta.yaml` sidecars beside binaries and folders. Pass `--dry-run` for observation
only, or use `npm run local-source` when the source must not be touched.

Pipeline coverage: every run (including dry-run) writes `coverage-report.json` under `--out-dir` with skipped binary/non-injectable paths and classification details (ADR-018). `skipped-noninjectable` is taxonomy-gated; weak keyword false positives are demoted so in-scope prose injects.

Outputs: `scanned`, `injected` (`pipeline`/`skills`), `verification-passed` (`pipeline` mode: `true`/`false`/`n-a`).

## Validation

```bash
npm ci
npm run validate
```

The canonical gate covers typing, tests, the exact API contract, architecture authority, deterministic manifest, committed distribution parity, selfpack, and an installed-tarball consumer.

`npm run validate:report` runs the gate and writes `CURRENT_VALIDATION_REPORT.md`,
recording the exit code each command actually returned and binding the result to a digest
of the tree it ran over. `npm run validate:report -- --check` fails when that digest has
moved, so a report written against an earlier tree cannot be presented as evidence for
this one.

`L9_ACCEPTANCE_CORPUS_MANIFEST=<manifest.json> npm test` additionally scans a real
archive an operator names — roots the manifest declares and nothing else. Nothing
enumerates drives or guesses at locations, and with the variable unset the acceptance
suite is skipped.

### Semantic candidates

`npm run local-source -- --root <path> …` also runs deterministic semantic candidate
discovery: keyphrases, multi-signal pair evidence, topic/project/consolidation candidates,
and a bounded reasoning queue naming which candidates a future model would be worth
spending on. Decoded PDFs, Word documents, decks and spreadsheets enter that analysis on
the same terms Markdown does, so a plan saved as `.docx` and the same plan saved as
`.md` are found to be near-duplicates of each other.

Topic candidates run over ten thousand documents under an exact rarest-first prefix
bound rather than a sample: at that size, comparing every pair would be 47,428,930
comparisons and the index performs 9,733. `corpus-coverage.json` reports both numbers,
and the bounded pass is held to an exhaustive reference at six thresholds.

Optional embeddings are **off by default**, a remote provider needs a second explicit
opt-in, and the one provider this package ships (`http-json`) refuses a `local` endpoint
that is not a loopback literal, never follows a redirect, and takes its bearer token from
the environment rather than a flag. **No language model is called anywhere in this
package**; an embedding pass calls only the embedding endpoint an operator configured.
See [`docs/semantic-candidates.md`](docs/semantic-candidates.md).

`npm run qualify:corpus` is separate and deliberately not part of that gate. It measures
rather than asserts: it scans a mixed read-only two-root corpus cold and then warm and
writes `reports/corpus-real-world-qualification.json` — bytes and files scanned, the second
run's cache hit ratio, decoder coverage, duplicate and candidate counts, and everything it
could not read split by why. See
[`docs/corpus-archaeology.md`](docs/corpus-archaeology.md#what-it-does-on-a-real-corpus).

`prepack` enforces package integrity. `prepublishOnly` additionally runs `check:publication`; publication remains blocked until the external distribution history and constellation-consumer inventory are resolved in `docs/package-publication-decision.json`.

## Architecture and contracts

- `docs/architecture-authority.json`
- `docs/public-api-contract.json`
- `docs/public-api.md`
- `docs/package-contract.json`
- `docs/contracts.md`
- `docs/traceability-map.json`

The historical Python consolidation engine remains reference-only under `tools/consolidation/` and `docs/legacy/consolidation-v1/`.
