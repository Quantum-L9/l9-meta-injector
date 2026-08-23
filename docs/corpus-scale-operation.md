# Operating a corpus at scale

A personal archive is several drives, a folder of ZIPs nobody has opened in years,
and a backup of one of the drives. This document is about running the corpus layer
over that without lying about what it found.

## The corpus manifest

```json
{
  "schema": "l9.local-corpus/v1",
  "corpus_id": "personal-technical-archive",
  "roots": [
    { "root_id": "primary-projects", "path": "/Volumes/Projects" },
    { "root_id": "old-ssd",          "path": "/Volumes/OldSSD" },
    { "root_id": "zip-archive",      "path": "/Volumes/Backup/Zips" }
  ]
}
```

```bash
npm run local-source -- --manifest corpus.yaml --out ./l9-corpus
```

`--root PATH=NAME` does the same thing at the prompt, and `--corpus-id` names the
corpus there.

### Why every root is named explicitly

`root_id` is the root's identity across runs, so it has to be a decision rather
than a consequence of where the drive mounted today. A root declared `old-ssd`
stays `old-ssd` at `/Volumes/OldSSD`, at `/mnt/recovered/OldSSD`, and on the next
machine. No absolute path, mount point, hostname, username or content hash enters
it.

Artifacts are addressed `old-ssd::plans/deploy.md`. Two roots holding
`notes/monday.md` hold two artifacts, not one — and if their bytes are identical
they form an exact-duplicate cluster, which is precisely the finding a single-root
scan structurally cannot make.

### Why the roots stay separate

Each root produces its own Repository Model Packet under
`roots/<root>/bundle/`, beside that root's acquisition manifest, document index
and document coverage. A root is modelled exactly as it would be if it had been
observed alone: nothing about the corpus — its name, its other roots, its
thresholds — reaches a packet, so a root carries the same packet id into every
corpus it is ever named in.

The corpus is an analysis *across* roots. It is not a synthetic filesystem that
replaces them, and an operator who later wants only the old SSD finds it whole in
one directory rather than having to filter a corpus-wide file.

## Two identities, on purpose

```
corpus_source_snapshot_id   what the disks held
corpus_analysis_id          what was concluded, and under which rules
```

The source snapshot is `H(sorted(root_id, source_revision, rmp_packet_id))`. No
analysis profile enters it. The analysis id binds that plus every profile: corpus,
decoders, interpretation, semantic candidates, embeddings, readiness.

Swapping an embedding model or raising a threshold moves the second and leaves the
first alone. That separation is the whole point: an identity that mixed them would
report every settings change as though the drives had been rewritten, and the next
run could no longer tell a real edit from a preference. `corpus-diff.json` reports
the two separately for the same reason.

`corpus_id` is a label. It enters no identity at all.

## Verification: what a content hash is claiming

| Mode | Flag | Class |
|---|---|---|
| Full | default | `fully_verified` |
| Incremental | `--incremental` | `cached_unchanged_assumption` |
| Forced full | `--verify-content` | `fully_verified` |

Full mode reads every byte of every regular file. `--incremental` carries a
previous run's content hash forward when the file's size and mtime have not moved,
comparing the nanosecond timestamp where the platform keeps one.

That is a revalidation signal and nothing more. A file rewritten in place, within
one filesystem timestamp tick, to exactly the same length would be reported
unchanged. So the snapshot records `verification_class`, and reuse of even one
hash makes the whole snapshot `cached_unchanged_assumption`:

```
verification     incremental -> cached_unchanged_assumption
hashes           0 read in full, 11 carried over, 0 unhashed
```

The label follows what the run did, not what it was asked for — an incremental run
that happened to reuse nothing did read every byte and says `fully_verified`.
`--verify-content` outranks `--incremental` and restores a byte-verified snapshot,
because that is exactly what it is for.

Archive members are always re-derived: their bytes live inside an archive this run
re-reads, so there is nothing to stat.

## A root that is not there

By default a root that cannot be read fails the run. That is deliberate: a
snapshot that looks complete and is quietly missing a disk is the one outcome a
corpus spread across removable media must never produce.

`--allow-partial-roots` says the operator wants the snapshot anyway. The root then
appears in it with `observation_status: "missing"` and the reason it failed,
`missing_root_ids` names it, coverage carries `root_count_failed`, and the corpus
is labelled `partial`. It is never labelled complete.

## Archives

The archive budget is a safety limit, not a performance knob: an unbounded archive
expansion is how a scan becomes a zip bomb. The default ceiling is 64 archives
expanded per run, and a corpus that is mostly ZIPs will hit it.

When it does, the run says so. Held archives are still observed and hashed; they
are simply not expanded, and both `archive.session_budget_exceeded` and
`local-source.archive_held` appear in the diagnostics. A short member count is
explained rather than being read as a corpus that held less. Raise the ceiling
deliberately with `--max-archives`.

## Interruption

`session/corpus-session.json` records completions by content-addressed key.
`--resume` adopts it for the same root set and continues; a manifest written for
other roots is not adopted. A failed run leaves the previous good outputs in place
— every projection is built in staging and renamed into position together, so a
reader never sees a coverage report describing one corpus beside a readiness
document describing another.

Resuming needs the cache: the session records what was finished, and the cache
holds it. `--resume --no-cache` is refused rather than quietly doing nothing.

## Concurrency

`--max-decoder-workers` bounds documents decoded at once;
`--max-hash-workers`, `--max-analysis-workers` and `--max-embedding-workers` are
recorded and reported as recorded, because acquisition hashes each root with one
streaming reader, candidate generation is a single pass over evidence already in
memory, and no embedding provider ships in this release. `--max-memory-bytes`
bounds decoded text held at once.

Execution order may vary with worker count. Emitted output order never does: every
list is in code-point order, and concurrency is not part of any identity.

## Coverage, and why the denominators are in the file

`corpus-coverage.json` groups its numbers under the bases they were drawn from:
`corpus`, `hashing`, `documents`, `semantics`, `embeddings`. "12 project
candidates" is a different claim over two hundred files than over two hundred
thousand, and a different claim again when four of six drives were never plugged
in. Embeddings report as disabled rather than being omitted — those are different
facts.

## Topology conformance, per root

Each root's packet is proven acceptable to the bound consumer without a second
golden fixture, and by a stronger route than one: a corpus models a root into
canonically the same packet the single-source path produces for it. The committed
`fixtures/local-source/expected-bundle` is what
`npm run topology:conformance` proves the consumer accepts, and a corpus run over
the same sample reproduces that packet byte for byte — same `packet_id`, same
`semantic_hash`. So conformance established for that bundle covers every per-root
corpus bundle, and the property is pinned by a test rather than argued here.

The corpus-level projections are deliberately not inserted into the Repository
Model wire contract. Cross-root candidates stay corpus-level inputs for a later
Topology or World Model evolution to consume on its own terms.

## What this layer will not tell you

No priority, no ranking, no percentage complete, no readiness score, no strategic
value, no recommended build order, and no opinion about what to delete or merge.
Readiness evidence is counts and citations; candidates are candidates. Weighing
them is a downstream decision, and one this package is not entitled to make.

No model is called. No build, test or package manager from an observed project is
executed. No file under any root is written, moved or removed.
