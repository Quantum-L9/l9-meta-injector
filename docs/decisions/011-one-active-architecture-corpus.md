# ADR-011: Maintain one active architecture corpus

## Status

Accepted (retrospective)

## Date

2026-07-23

## Context

The repository contains current TypeScript package contracts and an older consolidation documentation corpus. Leaving both sets of documents active would create conflicting definitions of architecture, schemas, execution stages, and release obligations.

The project still benefits from preserving historical decisions and artifacts for traceability, but historical material must not compete with current machine-readable contracts.

## Options Considered

### Option A: Keep both documentation corpora active

- Pros: avoids classifying or relocating documents; preserves every statement as potentially authoritative.
- Cons: creates contradictory sources of truth; makes reviews subjective; allows agents to select whichever document supports a desired change.

### Option B: Delete the historical corpus

- Pros: produces the cleanest current tree; eliminates accidental references to obsolete material.
- Cons: destroys design history and provenance; removes evidence that may explain current decisions; makes future archaeology harder.

### Option C: Archive the historical corpus and designate one current authority set

- Pros: preserves traceability while keeping current contracts unambiguous; supports deterministic validation; gives agents a clear authority order.
- Cons: requires explicit archive labels and ongoing discipline not to reactivate historical material silently.

## Decision

We choose **Option C**. Current architecture authority lives in the active TypeScript documents and machine-readable contracts. Historical consolidation documentation remains under `docs/legacy/consolidation-v1/` and related reference paths, where it is non-normative.

## Consequences

- Current package contracts override archived consolidation documents.
- Historical files are retained for reference, provenance, and comparison, not implementation authority.
- A historical concept becomes active only through an explicit current contract and validation change.
- Agent instructions must follow the documented authority order and preserve `Unknown` rather than resolving conflicts by preference.
- Superseded architecture decisions remain available and are linked forward rather than deleted.
