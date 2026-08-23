# ADR-041: A corpus has two identities, a hash says how it was obtained, and a missing drive stays visible

## Status

Accepted. Extends [ADR-038](038-multi-root-corpus-incremental-cache-and-readiness-evidence.md)
(multi-root corpora, content-addressed reuse, readiness evidence) and
[ADR-040](040-semantic-candidate-discovery-and-reasoning-handoff.md) (semantic
candidates and the reasoning queue). Neither is superseded.
[ADR-037](037-corpus-intelligence-artifact-scope-and-duplicate-topology.md) and
[ADR-039](039-real-corpus-qualification-report.md) are untouched.

## Date

2026-08-23

## Context

ADR-038 gave a corpus one identity, derived from its roots' source revisions
*and* the analysis profile. That was wrong in a way that only shows up in use.

An operator who raises a near-duplicate threshold gets a new corpus id. So does
an operator who edits a file. Diffing two runs cannot tell them apart, and every
derived document inherits the confusion: a coverage report and a readiness
document both cite an identity that means "these bytes under these rules", which
is not a thing a consumer can compare against anything.

Two further gaps in the same area. A scan over several drives cannot rehash
hundreds of gigabytes every time, but filesystem timestamps cannot become the
truth either, and there was no vocabulary for the difference. And a root that
could not be read failed the whole run — correct as a default, and useless for
the case the layer exists for, where one of six drives is simply not plugged in
today.

## Decision

### Source identity and analysis identity are separate numbers

`corpus_source_snapshot_id` is `H(sorted(root_id, source_revision, rmp_packet_id))`.
No analysis profile enters it.

`corpus_analysis_id` binds that plus every profile the derived layers were
computed under: corpus, document decoders, interpretation, semantic candidates,
embeddings when enabled, readiness.

Changing a model or a threshold moves the second and leaves the first alone.
`corpus-diff.json` reports the two separately and states whether the conclusions
are comparable at all, rather than reporting a zero that would read as "nothing
changed".

`corpus_id` is the operator's name for the corpus. It is a label and enters no
identity.

### Every root keeps its own packet, and the packet id is part of source identity

Each root produces an independent Repository Model Packet, emitted under
`roots/<root>/bundle/`. Nothing about the corpus reaches a packet, so a root
carries the same packet id into every corpus it is named in.

The packet id participates in the source snapshot deliberately. A corpus that
recorded only content hashes would say two runs saw the same bytes; recording the
packet says they also modelled them the same way, which is the claim a consumer
actually depends on.

### A cached interpretation carries no subject

An assertion names the repository it was read in, in its subject and in its own
id. The interpretation cache is keyed on the normalized document plus the source
path — and two roots in an archive corpus routinely hold the same bytes at the
same relative path, because one is a backup of the other.

Stored interpretations therefore carry no subject: it is stripped on write and
derived afresh for whichever root reads. This closed a real defect in which the
second root filed its own documents under the first root's artifacts.

### A hash records how it was obtained

`verification_class` is `fully_verified` when every byte was read on this run, and
`cached_unchanged_assumption` when any hash was carried forward from a previous
run because size and mtime had not moved.

Reuse of one hash makes the whole snapshot `cached_unchanged_assumption`. The
label follows what the run did rather than what it was asked for, so an
incremental run that reused nothing may say `fully_verified`, and
`--verify-content` outranks `--incremental` because restoring a byte-verified
snapshot is precisely its purpose.

### A missing root is recorded rather than dropped

The default remains to fail. `--allow-partial-roots` emits the snapshot with the
root present as `observation_status: "missing"` and its reason, names it in
`missing_root_ids`, counts it in coverage, and labels the corpus `partial`. A
partial corpus is never labelled complete.

### Readiness evidence carries its denominators and its uncertainties

Metrics are grouped by the question each group answers, and the corpus base sits
beside the counts drawn from it. `uncertainty` separates three ways of not
knowing that were previously invisible: a format no decoder reads, bytes a decoder
could not turn into text, and a file whose bytes were never established at all.
Documents that disagree about their own state are reported as a conflict count
rather than resolved by picking one.

## Consequences

A snapshot written before this split carries the same schema string and a
conflated id. Rather than trusting the version, `readCorpusSnapshot` refuses a
document that lacks the new fields and says why: diffing against it would compare
a source identity with a profile-bound one and call every unchanged corpus
changed.

The archive budget's default ceiling of 64 expanded archives now has a CLI flag
(`--max-archives`). Without one, the contract's own hundred-ZIP corpus could not
be fully observed from the command line; with one, raising it stays a deliberate
act rather than a default.

An archive's preflight verdict is cached, but its bytes are still staged, because
the members are needed by whatever reads them next. Skipping the decompression
entirely requires expansion on demand, which this release does not implement.
