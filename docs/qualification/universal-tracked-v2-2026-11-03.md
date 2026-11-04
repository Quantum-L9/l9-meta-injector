# Universal tracked-v2 qualification — 2026-11-03

## Candidate and result

Executed against producer runtime implementation `1dcfe866a78f63d3ba516ff7aaf431bf4c3fbf13`, independently based on `main` at `c53ef3aa0ccea04af2adfe67800ad09843b6e0fe`. The producer package version remains `4.3.0`; this is an unreleased protocol-v2 candidate, not registry or fleet-release authorization. The separate ADR-080 / PR #123 comment-carrier change is not its base or dependency.

All six supplied immutable commit snapshots passed. These are actual metadata-only runs, not inferred results from existing repository counts. Private source references, raw paths, receipts and per-item assessments remain outside this repository; the table intentionally publishes only aggregate evidence.

| Snapshot | Tracked leaves | Indexed | Protected | Unsupported | Symlink blobs | Hidden-path leaves | Runs (ms) | Node peak RSS (KiB) |
|---|---:|---:|---:|---:|---:|---:|---|---:|
| Topology | 550 | 548 | 2 | 0 | 0 | 37 | 172.30 / 131.77 | 83,368 |
| EIE | 673 | 672 | 1 | 0 | 4 | 56 | 221.10 / 145.75 | 88,752 |
| CEG | 814 | 814 | 0 | 0 | 0 | 86 | 262.68 / 180.06 | 87,332 |
| Cursor-Governance | 4,851 | 4,793 | 58 | 0 | 2 | 81 | 954.46 / 840.43 | 176,884 |
| Gate | 307 | 307 | 0 | 0 | 0 | 17 | 129.47 / 119.96 | 83,108 |
| Odoo — private authorized sample | 2,027 | 2,027 | 0 | 0 | 48 | 135 | 485.44 / 354.27 | 121,908 |
| **Total** | **9,222** | **9,161** | **61** | **0** | **54** | **412** | — | — |

Each case independently passed exact byte-path set equality against native Git-tree metadata, mode/type/OID/identity matching, metadata-versus-receipt partition, byte-identical index and coverage output on a second run, and unchanged observed source filesystem metadata. Every historical supplied blob count matched; these snapshots had no gitlinks. Gitlink handling is separately exercised in adversarial synthetic tests.

## What was specifically exercised

Topology accounted for the protected active index and root Git-tree manifest without a recursive hash claim. EIE accounted for four symlink blobs without dereferencing and retained a protected secret-candidate outcome. CEG accounted for hidden skills and five `.tar.gz` names inventory-only without extraction. Cursor-Governance accounted for its generated corpus, two template symlinks and explicit protected outcomes. Gate accounted for hidden workflows and Terraform/configuration paths. The private Odoo sample accounted for mixed Python/XML/CSV/skill/PDF/ZIP names and 48 symlink blobs without opening payloads or targets.

The 61 protected entries are justified receipt outcomes, not silently missing records. Zero unsupported outcomes is not a claim that content classification, encoding, competing-writer discovery or host materializability was proved: those remain uninspected/Unknown.

## Reproduction boundary

`scripts/qualify-tracked-snapshot.js` is a Linux maintenance-only helper, **not shipped in the package**. It calls the existing producer's tracked coverage API and independently compares native tree metadata; it does not classify mutation permission or write consumer metadata. It requires `/usr/bin/git`, a locally available immutable commit/tree and an output directory outside the source.

```bash
# Disposable bare metadata-only checkout. Acquire an approved exact commit if needed.
gh repo clone <approved-repository> /private/snapshot.git -- --bare --filter=blob:none

# Existing root, declared repository identity, exact source revision, private output,
# producer checkout and exact implementation provenance. No tracked apply/check.
node scripts/qualify-tracked-snapshot.js \
  /private/snapshot.git <owner/repository> <approved-exact-source-commit> \
  /private/qualification-output /path/to/producer-checkout \
  1dcfe866a78f63d3ba516ff7aaf431bf4c3fbf13
```

The helper retains private index/receipt/result files with restrictive permissions. Repeat timings measure two coverage API calls inside one Node process on the disposable metadata checkout, including compilation but excluding clone/fetch/setup, export and the independent comparator. Peak RSS is the operating system's high-water mark for the **Node process**, not an isolated resolver cost or native Git child-process maximum. These measurements are not a speedup claim, service SLO or portable benchmark.

## Validation and remaining authorization

The implementation's canonical `npm run validate:report` ran `npm run lint` and `npm run validate`, both exit zero. The aggregate includes source typing, unit/adversarial tests, exact public runtime and declaration contracts, closed authority/schema validation, manifest integrity, committed distribution parity, selfpack and real installed-package CLI/SDK v2 execution. The package runner proves read-only coverage/check, idempotent governed index-only apply, consumed-ID v1 migration and replay while preserving generated fixture sources.

Final-tree validation evidence is `CURRENT_VALIDATION_REPORT.md`; it must be regenerated whenever non-report bytes change. A green technical candidate does not authorize release: `check:publication` still blocks on history/distribution-approval/version evidence. No consumer repository or PR was edited, no Topology #35 refresh choice was changed, no recurring freshness enforcement was deployed and nothing was merged or published.

See [ADR-081](../decisions/081-versioned-universal-tracked-metadata.md) and [migration/rollback guide](../universal-tracked-metadata.md).
