# ADR-015: Keep npm publication fail-closed until external evidence is resolved

## Status

Accepted (retrospective)

## Date

2026-07-23

## Context

The repository can build, test, pack, and validate locally, but publication affects external consumers and package identity. The current state lacks verified npm registry history, a complete constellation consumer inventory, and recorded distribution-owner approval for version 3.0.0.

Green implementation checks prove technical readiness, not authority to publish.

## Options Considered

### Option A: Publish automatically whenever CI is green

- Pros: minimal release friction; direct mapping from technical success to distribution.
- Cons: treats missing external evidence as approval; can overwrite or conflict with prior package history; bypasses consumer-impact and owner-authorization checks.

### Option B: Rely on an undocumented manual decision outside the repository

- Pros: flexible; avoids adding release-policy files and tests.
- Cons: not auditable or reproducible; future agents cannot distinguish approval from omission; release behavior depends on tribal knowledge.

### Option C: Encode an explicit fail-closed publication decision and evidence gate

- Pros: separates build readiness from release authority; preserves unknowns honestly; makes approval conditions reviewable and testable; blocks accidental publication.
- Cons: publication remains blocked until external checks are completed; requires deliberate evidence maintenance.

## Decision

We choose **Option C**. `prepublishOnly` runs the canonical validation chain and `npm run check:publication`. Publication remains blocked until every required evidence item is verified or marked not applicable with a reason, and the decision status is explicitly changed to `approved`.

## Consequences

- `npm pack`, local validation, and CI may succeed while `npm publish` remains blocked.
- Registry history, consumer inventory, and distribution-owner approval must be recorded as evidence.
- Unknown evidence remains `unknown`; absence of evidence is never converted to approval.
- Publication policy changes require an explicit reviewed decision, not a bypass of the readiness script.
- Agents must stop before publication unless authority is recorded.
