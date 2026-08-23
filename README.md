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
described below at `<out>/corpus-index.json` and `<out>/corpus-report.md`. None of them
is ever written inside the observed tree.

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
- **`corpus-diff.json`** classifies everything against the previous snapshot — added,
  removed, changed, renamed candidate, unchanged, and the same three for archives — and
  says exactly which cache layers that invalidates. Nothing is ever evicted because an
  artifact left the corpus.
- **`readiness-evidence.json`** carries twelve measurable signals per artifact — source,
  tests, build manifest, CI, container, deployment, specification, documentation, open
  tasks, blockers, roadmap, plan — each with the exact filename, path segment, extension
  or declared predicate that decided it, plus per-project counts. It contains **no**
  priority, score, percentage complete or abandonment estimate; those five names are
  refused explicitly and a test walks the emitted document to prove it.
- **`corpus-coverage.json`** says what the scan reached and what it did not: decode,
  interpretation and lexical coverage as ratios, unsupported formats counted by
  extension, OCR-required imagery, encrypted members, oversized documents and
  credential-path skips.
- **Interrupted scans resume.** `corpus-session.json` records completions by
  content-addressed key; `--resume` picks them up. Concurrency and in-flight memory are
  bounded and configurable, and every projection is staged and renamed together.

No model is called and no network request is made. Full semantics:
[`docs/corpus-archaeology.md`](docs/corpus-archaeology.md).

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
