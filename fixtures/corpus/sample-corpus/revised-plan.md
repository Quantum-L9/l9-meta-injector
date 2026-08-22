---
title: Constellation Rollout Plan
kind: plan
status: draft
---

# Constellation Rollout Plan

The rollout moves the topology consumer onto the new packet contract without a
translation shim. Work proceeds in three stages, each gated on the previous one
producing a green conformance run against the bound consumer revision.

Depends on: docs/packet-contract.md

## Stage one — bind the consumer

Bind the exact consumer revision before any producer change lands. The revision
is recorded in the conformance probe so that a later reader can tell which
contract the evidence was gathered against, rather than assuming the tip of the
default branch at the time they happen to look.

A conformance run that cannot name the revision it ran against is not evidence,
because nothing in it can be reproduced. The probe therefore fails closed when
the revision cannot be resolved, instead of falling back to whatever is checked
out locally.

## Stage two — widen the producer

Artifact-scoped assertions are added to the interpretation pass. Existing
repository-scoped extractors keep their scope untouched, so widening the
interpreter never silently re-points a claim that was written to describe the
whole repository at one file inside it.

The packet builder stops rewriting assertion subjects. Validation is widened in
the same change to accept either a repository subject or an artifact subject,
and to reject anything else as an orphan.

## Stage three — prove and publish

Run the conformance probe against the bound revision, confirm the adapter
accepts the packet with no translation shim, and record the result. Publishing
happens only after that evidence exists.

## Tasks

- [ ] bind the consumer revision and record it in the conformance probe
- [ ] emit artifact-scoped assertions from the interpretation pass
- [x] agree the wire compatibility rule with the topology owner
- [ ] add a rollback note for the staging step

## Notes

Staging is intentionally boring. Nothing in this plan moves or deletes a file in
the observed source, and the acquisition layer stays read-only throughout. The
observed tree is treated as evidence, never as a workspace, and every derived
artifact is written outside it.
