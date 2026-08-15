# ADR-021: Check is a non-persisting expected-versus-actual operation

- Status: Accepted
- Date: 2026-08-01
- Supersedes: none
- Related: ADR-010, ADR-016, ADR-018, ADR-019, ADR-020

## Context

The legacy `pipeline --dry-run` path still created diff and coverage artifacts and,
when local-files mode was enabled, extracted archives into the target tree. It also
verified the unchanged file after planning metadata, which proved header presence
rather than comparing the exact canonical bytes that apply would produce.

CI therefore lacked a true drift gate. A stale or missing repository could either
be mutated before judgment or be evaluated through a dry-run path whose side
effects and semantics differed from a read-only check.

## Decision

`check` is a dedicated operation with these rules:

1. Repository authority is loaded and hidden control surfaces are scanned before
   metadata planning.
2. The canonical TypeScript pipeline remains the classification and reconciliation
   engine, but it runs with persistence disabled.
3. Each injection plan records its target, whether the target exists, the expected
   content hash, the current content hash, and whether bytes would change.
4. Missing and differing targets become drift; check never applies the plan.
5. A byte-and-mode snapshot is taken before and after the operation. Any repository
   change raises `CHECK_MUTATION_DETECTED`.
6. Check disables filename normalization, metadata logs, report/index persistence,
   and LLM assistance.
7. Local-file archives are listed and reported without extraction. Until a virtual
   archive planner exists, their apply-state comparison is explicitly unsupported
   rather than simulated through mutation.
8. Reports may be written only outside the target root by the CLI or Action wrapper.

The existing `runPipelineAsync` apply path is preserved. The only pipeline change is
an internal `persistOutputs: false` seam and non-writing dry-run injection planning.

## Consequences

CI can fail on committed drift without repairing it. The same canonical metadata
builder and reconciler drive apply and check, reducing semantic divergence. Archive
checks are conservative and fail with explicit unsupported evidence instead of
creating extracted trees. The carrier policy remains transitional until ADR work in
P-201 narrows inline mutation and replaces adjacent sidecars with a central manifest.

## Validation

- Missing, stale, clean, authority-conflict, and archive fixtures.
- Recursive before/after repository hashing.
- No report, diff, index, extraction, sidecar, or inject-log creation inside root.
- CLI report-path containment test.
- Composite Action check routing with the mutating dispatcher bypassed.
- Public API and packed-consumer export checks.
