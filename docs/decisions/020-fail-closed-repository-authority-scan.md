# ADR-020: Fail-closed repository metadata-authority scan

## Status

Accepted for PR-1 Safety Envelope implementation.

## Context

Normal artifact discovery skips hidden directories and is intentionally optimized
for content classification. Repository authority is different: active writers can
be wired through `.github/workflows`, pre-commit hooks, package scripts, Makefiles,
hidden hook directories, or standalone scripts. A consumer can therefore contain a
second metadata writer without normal discovery seeing the invocation.

At least one confirmed consumer pattern uses `scripts/inject-l9-meta.py` together
with `scripts/verify-l9-meta.py`, legacy `L9_META` markers, and direct file writes.
Marker text can also appear harmlessly in documentation and tests, so a raw string
search would create noisy false positives.

## Decision

Add a separate read-only authority scan that:

1. Includes hidden control surfaces but never makes them mutation candidates.
2. Examines workflows, package scripts, Makefiles, pre-commit configuration,
   hook directories, and suspicious writer script names.
3. Requires executable evidence, such as a writer filename plus a write primitive,
   or a control-surface invocation of a known writer pattern.
4. Treats canonical immutable `Quantum-L9/l9-meta-injector@<sha>` invocation as
   canonical evidence rather than a conflict.
5. Excludes documentation, tests, fixtures, reports, generated output, dependencies,
   and VCS internals from active-writer conclusions.
6. Blocks `check` and `apply` when authority is missing, mismatched, malformed, or
   competing writer evidence is present.
7. Allows `inventory` to report conflicts without mutating or silently approving them.

The authority YAML parser accepts only the exact `l9.meta-authority/v1` shape and
fails on duplicate, unknown, nested, or unsupported constructs.

## Consequences

- Hidden governance surfaces become visible to authority judgment.
- The scan stays independent from normal mutation discovery.
- False-positive control requires executable-context fixtures.
- Future legacy dialects need explicit detection rules rather than permissive guesses.
- `check` and `apply` can fail before change planning begins.
