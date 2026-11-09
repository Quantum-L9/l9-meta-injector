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

**Omit:** built-in noise + SKILL.md protect, optional `.l9metaignore`, CLI `--omit` / `--omit-file`. Repository-model observation also omits what git reports as untracked and ignored, never a tracked file (ADR-078).

## Use it from another repository

npm registry publication is blocked (see `check:publication` below), so `npm install
l9-meta-injector` does not work. Three install paths do, and each is proven by test
(ADR-079): `npm run test:packed` drives the installed bin inside a generated foreign git
repository, `--git-install` repeats that from a git dependency, and CI runs the composite
Action against a separate target directory on every pull request. The packed runtime is
proven on Node 18, 20 and 22.

| Path | How | Notes |
|---|---|---|
| GitHub Action | `uses: Quantum-L9/l9-meta-injector@v4` (or `@<commit sha>`) | Runs the pinned ref's committed `dist/`; no build, no registry. |
| Git dependency | `npm install --save-dev github:Quantum-L9/l9-meta-injector#<tag or sha>` | Installs the committed `dist/`; no developer toolchain runs (ADR-079). |
| Packed tarball | `npm pack` in a checkout, then `npm install ./l9-meta-injector-<version>.tgz` | Same contents a registry release would ship. |

`@v4` advances only when a release lands on `main`; to take unreleased fixes, pin a commit.

### First run in a new repository

`inventory` needs nothing. `check` and `apply` take the target repository's own
`.l9/meta-authority.yaml` as input and refuse without it. An unbound repository declares
the `v1` form:

```yaml
# .l9/meta-authority.yaml
schema: l9.meta-authority/v1
writer:
  repository: Quantum-L9/l9-meta-injector
  ref: v4
default_carrier: central_manifest   # metadata lives in .l9/metadata-index.jsonl; sources stay byte-identical
legacy_writers: forbidden
inline_allow: []
```

(`l9.meta-authority/v2` adds `semantic_foundation` and `product`; see Semantic Foundation
binding below.) Then, from inside the repository — the root must be a relative path inside
the current directory (ADR-022):

```bash
npx l9-meta-injector --help
npx l9-meta-injector inventory .                       # read-only scan, reports under .l9-meta-injector-out/
npx l9-meta-injector apply . --authority <your-org>    # writes .l9/metadata-index.jsonl
npx l9-meta-injector check . --authority <your-org>    # read-only drift gate; exits 1 on drift
```

A first `check` before any `apply` reports the missing metadata index as drift; that is
expected.

### Opt in to format-safe headers

**Unreleased (ADR-080):** use a reviewed commit containing this change; `@v4` receives it
only after a separate release. In the target's v1 or v2 `.l9/meta-authority.yaml`, retain
the writer/binding fields and replace the carrier-policy fields with, for example:

```yaml
default_carrier: central_manifest
inline_allow:
  - "docs/**/*.md"
  - "src/**/*.py"
  - "scripts/**/*.py"
  - "tests/*.py"
  - "**/*.yaml"
  - ".github/workflows/*.yml"
  - ".gitignore"
  - ".editorconfig"
  - ".env.example"
inline_exclude:
  - "tests/fixtures/**"
  - "**/golden_tests/**"
  - "**/datasets/**"
```

`inline_allow` grants permission only for an eligible host carrier: approved Markdown
frontmatter or supported, inert line/block comments in source, ordinary tests, scripts
and configuration. No allow match means central metadata; even
`default_carrier: inline_managed` cannot grant permission by itself. Optional
`inline_exclude` defaults to `[]`, uses the same repository-relative POSIX glob dialect,
and wins over allow without removing the file from discovery or the index. Preview with
`check`, then use `apply` and a second `check` to verify the result.

Canonical fixture families (`fixture`, `fixtures`, `__fixtures__`), `golden_tests` and
`datasets` directories at any depth always stay centrally indexed, even under an allow
of `**`; the example exclusions make the intent visible and can cover additional custom
data paths. Hidden controls require named safe patterns such as
`.github/workflows/*.yml`, `.gitignore` and `.editorconfig`: `**` or `**/*.yaml` alone
never unlocks them. `.git`, `.l9`, dependencies and binaries are hard-skipped; generated
outputs, locks and vendored state are never annotated. Secret-bearing `.env` files are
hard-protected, distinct from an explicitly authorized, non-secret `.env.example`.
JSON, JSONL, plaintext and files with no safe comment position stay central or retain
an existing external carrier unchanged: governed apply inserts neither comments nor
adjacent sidecars there. Normal-mode `SKILL.md` protection is unchanged.

Headers use the existing renderer, preserving shebangs, BOMs, encoding cookies, CRLF
and body bytes. All changed inline carriers and the index share the governed transaction
and post-write verification. Scanned/inventory totals and index record counts are
coverage, **not inline changes**: non-hard-skip metadata subjects remain indexed even
when inline. Apply's `inlineChanged` identifies changed source carriers;
`metadataIndexChanged` separately reports the index write, and `changed` includes both.
Discovery omissions, hard skips, encoding/unsupported-entry holds and central fallbacks
are coverage exceptions, not evidence that every file received a header. Full policy:
[ADR-080](docs/decisions/080-governed-format-safe-comment-carriers.md).

## Universal tracked metadata v2 (explicit candidate contract)

This unreleased candidate adds exact Git-tracked accounting. It is not present in
the existing released `v4.3.0` tag: install an immutable validated candidate commit
or its packed tarball before using it. Package release and consumer rollout require
separate authorization.

Universal coverage means every leaf entry at one exact Git revision receives exactly
one v2 metadata record or protected/unsupported-exclusion receipt. It does **not** mean a header
inside every file or a content hash for bytes that were never read. The tracked seam
is conservative and index-only; source code, configuration, hidden files, archives,
links and prose remain untouched. Canonical identities preserve exact path bytes,
including case and Unicode form; legacy aliases are not unique canonical keys.

```bash
# Read-only, content-free Git commit-tree accounting. Export is outside the source.
npx l9-meta-injector tracked-coverage . --repository Quantum-L9/example --revision <exact-commit> --out /tmp/example-coverage.json

# Compare the active v2 index without repairing it.
npx l9-meta-injector tracked-check . --repository Quantum-L9/example --revision <exact-commit>

# Explicit governed index-only write; requires the repository's canonical authority.
npx l9-meta-injector tracked-apply . --repository Quantum-L9/example --revision <exact-commit> --writer-ref <approved-writer-ref>

# Replacing a legacy v1 index additionally requires an explicit migration choice.
npx l9-meta-injector tracked-apply . --repository Quantum-L9/example --revision <exact-commit> --migrate-v1 --writer-ref <approved-writer-ref>
```

The one active store remains `.l9/metadata-index.jsonl`. V1 readers/valid behavior
remain supported; mixed/unknown contracts and implicit v2-to-v1 downgrade are refused.
Self-index and root `GIT_TREE_MANIFEST.json` are protected and accounted outside the
tree to avoid hash cycles. Dirty/stale tracked sources and unsafe targets hold apply;
the established CAS transaction provides rollback. A second unchanged apply performs
no writes. No standalone annotating-inventory call or adjacent sidecar is used as a
governed-write workaround.

Read-only qualification uses pinned disposable repository snapshots. Private per-path
metadata stays private. Snapshot proof does not promise continuous fleet freshness,
host path materializability, blob encoding or semantic interpretation. See
[ADR-081](docs/decisions/081-versioned-universal-tracked-metadata.md) and
[the migration guide](docs/universal-tracked-metadata.md).

## GitHub Action

```yaml
# Observation only: classify + write an inventory manifest as a build artifact.
# `mode: inventory` defaults to dry-run, so the checked-out repo is not modified.
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@v4
  with:
    mode: inventory
```

```yaml
# CI drift gate: fail the job when committed metadata drifts from what apply would
# write. Needs .l9/meta-authority.yaml in the repository (see above).
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@v4
  with:
    mode: check
    authority: my-org
```

```yaml
# Governed write: inject/refresh metadata, then commit the result in a later step.
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@v4
  with:
    mode: apply
    authority: my-org
```

```yaml
# Cursor-native skills mode: material-improve SKILL.md descriptions (Use when …).
# Composite actions cannot read the secrets context directly, so the calling workflow
# passes its own secret in as an input — never hardcode a key in `with:`.
- uses: actions/checkout@v4
- uses: Quantum-L9/l9-meta-injector@v4
  with:
    mode: skills
    authority: my-org
    llm: "true"
    llm-base-url: "https://api.openai.com/v1"
    llm-model: "gpt-5-nano"
    llm-api-key: ${{ secrets.OPENAI_API_KEY }}
```

| Input | Default | Notes |
|---|---|---|
| `mode` | `inventory` | `inventory` = classify + manifest (read-only by default). `check` = read-only drift gate. `apply` = governed metadata write. `skills` = Cursor-native skill description improve. `pipeline` is a deprecated alias of `apply`. |
| `root` | `.` | Existing directory, relative to the calling repository's workspace. Absolute paths, traversal and symlink escapes are refused. |
| `authority` | *(none)* | Header authority. Required by `check`, `apply` and `skills` unless `.l9/meta-authority.yaml` is v2 (then `product.owner` is used and a differing value is a conflict). |
| `namespace` | *(folder name)* | Header namespace, every mode. Defaults to the bound `product.id` for a v2 authority, else the target directory name. |
| `dry-run` | `true` for `inventory`/`check`, `false` for `apply`/`skills` | Exact boolean. `check` rejects `false`, and `apply` (and its deprecated `pipeline` alias) rejects `true`: for a read-only preview of what apply would change, run `mode: check`. |
| `fail-on-issues` | `true` | Exact boolean; only `true` is accepted. `check` always fails on drift and `apply` (and `pipeline`) always fails on repository authority conflicts; `"false"` is an input error in every mode, including `apply` (ADR-069). |
| `out` | `.l9-meta-injector-out` | Report/manifest directory, relative to `root`. |
| `omit` | *(empty)* | Comma-separated gitignore-style patterns (built-ins always protect `SKILL.md` and skip bytecode/logs). |
| `node-version` | `20` | Node used to run the action; 18, 20 and 22 are proven. |
| `upload-artifact` | `true` | Uploads the manifest/report directory as a workflow artifact. |
| `llm` | `false` | `apply`/`skills` only; `check` refuses it. `llm: "true"` without all of `llm-base-url`, `llm-model` and `llm-api-key` is an input error — there is no silent fallback. |
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
- **`architecture-evidence.jsonl`** (`l9.architecture-evidence/v1`, opt-in with
  `--architecture-evidence`) is what the design documents explicitly declared about their
  own architecture: the `intent`, `constraint`, `assumption`, `open_question` and
  `decision_statement` statements written as labelled fields (`Objective:`, `Decision:`),
  labelled lists (`Constraints:` then items) and labelled sections (`## Open Questions`),
  read out of every decoded format by one implementation and cited at the exact line a
  text file has or the block a Word document has. Every record is **source-declared and
  never authority-verified** — a recorded decision is not an accepted one — and carries
  both artifact identities, the document's own `work.kind`/`work.status` declarations by
  assertion id, and the `architecture-development/v1` selection verdict with the rule and
  evidence that decided it. Complete, hashed and manifest-bound like the work signals;
  selecting it moves `corpus_analysis_id` and nothing else. See
  [`docs/architecture-evidence.md`](docs/architecture-evidence.md) (ADR-087, Proposed).
- **`corpus-query-cli.js`** asks one bounded question of a completed generation and
  answers from its own records: `--class open_question --text Gate`,
  `--class decision_statement --status wip`, `--predicate work.status --root Designs`.
  It pins `CURRENT.json` once, verifies every file against the pointer and every payload
  with the scan's own verifiers, reads the architecture evidence, the work-signal payload
  and each root packet, and returns records with their identities, native coordinates and
  bounded excerpts — every declaration retained, nothing ranked, inferred, resolved or
  written. A partial snapshot is `incomplete`, an unobserved root `unavailable`, a failed
  verification `invalid`. See [`docs/corpus-evidence-query.md`](docs/corpus-evidence-query.md)
  (ADR-088, Proposed).
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
  A publish holds an exclusive `.corpus-publish.lock` in the output root, so a second
  concurrent publisher into the same root is refused rather than racing (ADR-066).
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
not an observation one (ADR-016, hardened by ADR-036, ADR-044 and ADR-045). It expands
`.zip` archives into sibling `*.l9extracted/` directories, writes `<zip>.l9meta.yaml`
sidecars, and injects the extracted members in place. No system `unzip` is involved:
the package's own ZIP reader and preflight admit every archive. Default pipeline mode
still skips archives, and TAR or compressed tarballs are never expanded on any path.

It now refuses to replace an extraction target that carries no ownership marker — a
user directory named `Foo.l9extracted` is never deleted — and its dry run performs zero
source mutation, reporting what a real run would extract instead of extracting it.
Prefer `local-source` for anything you do not intend to modify.

`npm run skills -- <root> --llm …` runs Cursor-native skill mode (ADR-017).

**`npm run inventory` is not read-only.** Unlike the Action's `mode: inventory`, the
direct CLI defaults to annotation: it harvests existing meta first, writes three clocks
(`created_at`, `modified_at`, `inspected_at`), appends metadata headers to text files,
writes `.l9meta.yaml` sidecars beside comment-less text and **every recognized archive**,
and when rewrite is admitted injects a root `.l9meta.yaml` member inside `.zip` / `.tar` /
`.tar.gz` / `.tgz`. On macOS it also projects a concise Finder Comment and Tags for
search. Header fields are derived from the file (`classify`, `PRIMITIVE_TAXONOMY`,
`resolveNamespace`, `estimateTokens`) or written as `Unknown`; inventory does not
stamp `namespace: inventory` or `authority: inventory`, and `content_hash` on UTF-8
text is the body without the managed carrier. This is not apply: it does not require
`.l9/meta-authority.yaml`. A v2 binding, when present, supplies `authority` and `namespace` (ADR-052). Pass `--dry-run` for observation only, or use
`npm run local-source` when the source must not be touched.

Pipeline coverage: every run (including dry-run) writes `coverage-report.json` under `--out-dir` with skipped binary/non-injectable paths and classification details (ADR-018, amended by ADR-054). `skipped-noninjectable` is taxonomy-gated or a carrier tier: `hard_skip` is coverage-only, and `inventory_only` is indexed and never injected. Weak keyword false positives, including keyword-only skill, playbook, kernel, and doctrine, are demoted so in-scope prose injects. File ids follow the repo-relative path, and a dry-run diff is written at `<out-dir>/<source_path>.diff`.

Outputs: `scanned`, `injected` (files changed by `apply`/`skills`; zero for `inventory`/`check`), `verification-passed` (`check`/`apply` verification result: `true`/`false`; `n-a` for other modes), `artifact-path` (contained report or output path supplied to upload-artifact), `resolved-mode` (canonical mode after deprecated-alias handling).

## Semantic Foundation binding

This package cites org Semantic Foundation ledgers; it does not copy `Quantum-L9/.github/semantics/`.

A repository may declare `.l9/meta-authority.yaml` with schema `l9.meta-authority/v2`: pin one `Quantum-L9/.github` revision, cite each ledger by `artifact_id` and sha256, and declare `product.id`, `product.owner`, `product.kind`, and archetype. `resolveHeaderIdentity` then stamps header `authority` from `product.owner` and `namespace` from `product.id`. Source, test, and script headers stamp `owner` from `product.owner`. A conflicting `--authority`, `--namespace`, or `--namespace-glob` whose namespace is not `product.id` fails closed with `META_AUTHORITY_IDENTITY_MISMATCH`. An invalid v2 file fails with `META_SEMANTIC_BINDING_INVALID` and never falls back to the folder name.

A bound run records the cited foundation and product on `PipelineResult.semanticBinding` and, when reports are persisted, as the top-level `semantic_binding` key of `coverage-report.json`.

An unbound root (no v2 binding) still requires `--authority` and defaults namespace to the directory name. Inventory uses the binding when present; otherwise it keeps the ADR-051 harvest-or-Unknown derivation. Unbound `owner` stays `Unknown`.

This repository's own declaration is Dependency / `l9.dependency-archetype/semantic-subsystem@1`. Admission of Semantic Foundation v3.6.0 is recorded as `candidate`.

Offline digest proof against an operator-supplied checkout:

```bash
npm run semantics:verify -- --semantics-root <Quantum-L9/.github checkout at the bound revision>
```

That command is not part of `npm run validate` (ADR-048, ADR-052).

### Binding provenance in the Repository Model Packet

`repository-model` carries the binding as evidence about the repository (ADR-082):

- **Declared binding.** One `declared` evidence record, `semantic_binding`, cites
  `.l9/meta-authority.yaml` and the digest of its exact bytes.
- **Verified binding.** With `--semantics-root <checkout>`, the cited ledgers are
  verified offline and a separate `validated` record,
  `semantic_binding.verification`, is added. If verification fails, the CLI
  refuses to emit.
- **Strict mode.** `--require-semantic-binding` refuses anything short of a
  verified v2 binding.
- **What it never does.** It never promotes product identity into `owner_ids`
  or `repository_id`, and verification never grants admission: a `candidate`
  binding stays a candidate.

```bash
npm run repository-model -- . --name l9-meta-injector --revision git:<sha> --out <bundle> \
  --semantics-root <Quantum-L9/.github checkout at the bound revision> --require-semantic-binding
```

Native metadata headers, workflow structure, static imports, requirements files and API contract references are observed as source claims under predicates the consumer preserves but does not project; see [Repository Model semantics](docs/repository-model-semantics.md).

## Validation

```bash
npm ci
npm run validate
```

The canonical gate covers typing, tests, the exact API contract, architecture authority, computed architecture manifest, committed distribution parity, selfpack, and an installed-tarball consumer. Developing this repository needs Node `>=22.13` (vitest 5, eslint 10); the published package still runs on Node `>=18`.

Consumer alignment is proved separately: `npm run topology:conformance` runs the committed golden bundles through the real `Quantum-L9/l9-constellation-topology` consumer named in `docs/topology-conformance.json`, and the `Topology conformance` workflow does the same on every pull request, plus a packet of this tree. A dependency update is verified locally with `npm run deps:rebind` (ADR-056, ADR-093).

`npm run validate:report` runs the gate and writes `CURRENT_VALIDATION_REPORT.md`,
recording the exit code each command actually returned and binding the result to a digest
of the tree it ran over. `npm run validate:report -- --check` fails when that digest has
moved, so a report written against an earlier tree cannot be presented as evidence for
this one. The report is gitignored and never committed; release preparation uploads it as
a workflow artifact (ADR-093).

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
