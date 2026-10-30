# ADR-070: Publication evidence set and version-bound owner approval

## Status

Accepted

## Date

2026-10-28

## Amends

[ADR-015: Keep npm publication fail-closed until external evidence is resolved](015-fail-closed-publication.md)
— its Decision ("every required evidence item is verified or marked not applicable with
a reason") named no required set and, read literally, let the owner approval be waived.

## Context

RC-108 (F-080, F-081). `scripts/check-publication-readiness.js` checked the schema,
the package identity, `status === "approved"`, a non-empty evidence list and the shape
of each listed item (string id, status `verified` or `not_applicable_with_reason`,
non-empty result). It declared no required evidence set, no uniqueness, and no rule
for the owner approval:

- a decision with `status: approved` and one arbitrary item
  (`{id: "anything", status: "verified"}`) was APPROVED;
- the committed decision with only its status flipped was APPROVED, although its
  `distribution_owner_approval` item records that no owner approval exists
  (`not_applicable_with_reason`);
- duplicated ids were accepted; a `null` item crashed the script with a `TypeError`
  (fail-closed by accident).

Its only version binding was `package_version === package.json#version`.
`scripts/prepare-release.js` restamps `package_version` from `package.json#version`
and left `status` and evidence untouched, and `.github/workflows/release-prep.yml`
runs it automatically on release branches. An approval recorded for version N
therefore became an approval for N+1 through the sanctioned preparation path.

INV-011 requires publication to fail closed "until every required external evidence
item is resolved and owner approval is recorded"; ADR-015's Consequences require
registry history, consumer inventory and distribution-owner approval to be recorded.

## Options Considered

### Option A: Required ids and owner-approval rule in the script; preparation resets status

- Pros: smallest; the decision document cannot weaken its own requirements.
- Cons: the version binding relies on `prepare-release.js` being the only restamper;
  a manual edit of `package_version` could still carry an approval forward.

### Option B: Option A plus an explicit approval binding never written by automation (schema v2)

- Pros: an approval cannot survive any restamp, manual or automated.
- Cons: schema bump, document migration, test update.

### Option C: Required ids declared inside the decision document

- Pros: flexible.
- Cons: self-certifying: editing the document drops requirements; contrary to the
  intent of ADR-015.

## Decision

The repository owner adopted **Option B** (DEC-RC-108) with the required set
recommended by DEC-GAR-03. Publication stays fail-closed and unauthorized; this
decision changes what an approval must contain, not whether one exists.

1. **Required evidence, declared in the gate.** `check-publication-readiness.js`
   requires `npm_registry_history`, `constellation_consumer_inventory` and
   `distribution_owner_approval` (the ADR-015 trio), each exactly once.
   `github_release_validation` and `l9_deploy_migration_validation` are allowed
   optional ids: when present they must be resolved like any item, but their absence
   does not block (GitHub tag consumption is a separate channel, ADR-050). Any other
   id, any duplicated id, any non-object item and any item without an id, a resolved
   status or a non-empty result blocks, one error per defect.
2. **The owner approval is never waivable.** `distribution_owner_approval` must be
   `verified`; `not_applicable_with_reason` blocks.
3. **Approval is bound to a version.** Schema `l9.package-publication-decision/v2`
   adds top-level `approved_version`. The gate requires it to equal
   `package.json#version`. Only a recorded owner approval sets it; no automation
   writes it. The committed decision carries `approved_version: null`.
4. **Preparation never carries an approval forward.** When the decision's
   `package_version` differs from the version being prepared, `prepare-release.js`
   sets `status` to `blocked_pending_history_check` before restamping
   `package_version`. Re-preparing the same version changes nothing (idempotent); a
   blocked decision stays blocked.

## Consequences

- No effect on the current state: the committed decision is
  `blocked_pending_history_check` with `approved_version: null`, and
  `npm run check:publication` stays BLOCKED (now also naming the non-verified owner
  approval and the missing approval binding).
- Any future approval must list the three required ids once each, a `verified`
  distribution-owner approval and `approved_version` equal to the package version. A
  decision that would previously have passed with a waived owner approval now blocks.
- Every release branch preparing a new version commits a reset status when the
  decision was approved; a fresh owner approval is required per version.
- `tests/publication_readiness.test.ts` asserts schema v2 (schema bump required by
  this decision) and executes both scripts against a repository mirror.
- Follow-ups outside this change's owner files: INV-011's "Enforced by" text,
  `docs/release-checklist.md` (approval step should name `approved_version` and the
  required ids), `docs/contracts.md:74`, and the decision log / ADR index rows.
- Agents must still stop before publication unless authority is recorded; nothing in
  this decision records or implies such authority.

## Validation

- `tests/publication_readiness.test.ts`: REG-WU-068-RC-108-a..i, plus a mismatched or
  absent `approved_version` blocking and the committed decision remaining blocked.
