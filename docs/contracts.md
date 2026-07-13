# Contracts

## consolidate_request (single ingress)

| Field | Type | Required | Notes |
|---|---|---|---|
| action | const | yes | "consolidate" |
| mode | enum | yes | repo-pack \| folder-artifact |
| inputs.source | path | yes | user-provided; never assumed |
| inputs.output | path | folder-artifact only | new sibling folder |
| constraints.source_mutation | bool | yes | must be false for folder-artifact |
| constraints.dry_run | bool | yes | |
| constraints.confidence_threshold | float | no | default 0.60 |
| trace_id | uuid | yes | assigned once at ingress |

Rules:
- Normalize input once.
- Validate once before routing.
- Reject if mode unknown (fail-closed).
- Never bypass ingress to call core or mode modules directly.

## move_map.csv (core output; B -> C contract for folder-artifact)

| Column | Required | Notes |
|---|---|---|
| source_path | yes | relative to source root |
| content_hash | yes | sha256 |
| artifact_type | yes | architecture\|contract\|node_spec\|infra\|template\|skill\|unknown |
| l9_domain | yes | inferred domain or generic |
| node_name | yes | inferred or unknown |
| output_path | yes | proposed destination path |
| renamed_from | yes | original filename |
| classification_confidence | yes | 0.00-1.00 |
| path_confidence | yes | 0.00-1.00 |
| dedup_status | yes | unique\|duplicate\|collision\|unknown |

## Manifest Gate (must pass before any write)
- move_map.csv exists and parses cleanly.
- Every row has source_path + content_hash + output_path (non-empty).
- No unresolved output_path collisions.
- Rows below confidence_threshold routed to 99_CONFLICTS_AND_UNKNOWN/.
- Gate failure -> HALT; do not proceed to injector.

## L9_META header (repo-pack)
```
<!-- L9_META
l9_schema: 1
origin: <repo/pack name>
layer: <layer>
tags: [...]
owner: <owner>
status: active
/L9_META -->
```
Idempotent: already-stamped files are skipped on re-run.

## L9_ARTIFACT_META header (folder-artifact, text files)
```
<!-- L9_ARTIFACT_META
schema: 1
mode: folder_artifact_consolidation
source_path: "<rel>"
output_path: "<rel>"
artifact_type: <type>
l9_domain: <domain>
content_hash: "<sha256>"
classification_confidence: <float>
renamed_from: "<filename>"
created_at: "<iso8601>"
/L9_ARTIFACT_META -->
```
Sidecars (.l9meta.yaml) used for binary/non-text files.

## Metadata v3 — nine-plane schema

v3 re-expresses the flat v1/v2 header as **nine orthogonal planes**, one per
concern of the metadata compilation engine. It is **additive**: v3 does not
replace v1/v2 and changes no existing behavior. Schema file:
`schemas/l9_meta_v3.schema.yaml`; TypeScript types: `src/schema.ts`
(`MetaV3`, `META_V3_PLANES`).

| # | Plane | Owns | Key fields |
|---|---|---|---|
| 1 | identity | who/what the artifact is | id, title, artifact_type, content_hash, version |
| 2 | taxonomy | classification & capability | family, mcp_primitive, callable, retrievable, injectable |
| 3 | placement | logical/physical location | namespace, source_path, output_path, layer, sharing_scope |
| 4 | routing | advisory route plan | advisory, activation_signals, input_contract, output_contract, targets |
| 5 | provenance | origin & generation history | created_or_detected_at, generated_by, upstream, snapshot_hash |
| 6 | governance | authority, ownership, lifecycle | authority, status, owner, decision_drivers |
| 7 | economics | cost/size budgeting | token_cost_estimate, size_bytes |
| 8 | assurance | fail-closed gates | validation_gates, stop_conditions |
| 9 | lineage | schema chain | schema_version, supersedes, chain |

Rules:
- A v3 record carries **exactly** the nine planes — no more, no fewer.
- `routing.advisory` is fixed `true`: the engine emits route *plans*, never live
  routing writes.
- `lineage.schema_version` is fixed `3`.
- Unset optional fields carry the `Unknown` sentinel rather than being omitted.
- Idempotent: skip if a v3 nine-plane record is already present for the artifact.
