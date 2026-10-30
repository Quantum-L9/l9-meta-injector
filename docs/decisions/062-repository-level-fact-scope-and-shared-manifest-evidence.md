# ADR-062: Repository-level fact scope and shared-manifest evidence

## Status

Accepted. Amends [ADR-030](030-repository-model-packet-egress.md),
[ADR-031](031-shared-manifest-filenames-are-not-package-manager-evidence.md) and
[ADR-055](055-manifest-interpretation.md); each of those decisions otherwise stands.

## Date

2026-10-28

## Context

The Repository Model Packet states facts about one repository: `package_managers`,
`governance_refs` and `adr_refs` on the repository record, and `assertions` whose
`subject_id` is the repository. Two defects made those facts describe files that are not
the repository.

**RC-033 (F-043): repository-level facts were keyed on a basename at any depth.**
`buildRepositoryModelPacket` (`src/repository_model.ts`, derivation loop) looked up
`PACKAGE_MANAGER_BY_FILENAME[record.file_name]`, `GOVERNANCE_FILENAMES.has(record.file_name)`
and `isAdrPath(relativePath)` — whose second branch matched `adr-*.md` anywhere — for every
inventoried file, so the first evidencing path in code-point order won wherever it lived.
In the interpretation seam (`src/interpretation.ts`), `extractorSubjectScope` defaults to
`repository` and `interpretDocumentContent` filed every repository-scoped extractor's
assertions against the repository subject regardless of path; `manifest/v1`,
`repository-status/v1`, `declared-authority/v1` and `service-spec/v1` all match their file
by basename at any depth (`basenameIs`). `declaresDependencies` was then satisfied by any
repository-subject `package.dependency`, including a fixture's. Self-observation of this
repository at bf66978 reported `package_managers ['npm','pnpm']` with npm evidenced by
`fixtures/local-source/sample-source/package.json`, a `governance_refs` entry from
`fixtures/repository-model/sample-repo/CODEOWNERS`, an `adr_refs` entry from that fixture's
`docs/decisions/`, and four `package.name` claims (three fixtures and the root). The
committed local-source golden carried a repository-subject `repository.status` assertion
from the archive member `Bundle.zip!/README.md`. ADR-055 Decision item 2 makes the
consequence concrete: the consumer projects every repository `package.dependency` into a
`DEPENDS_ON` edge, so a nested claim becomes a false edge.

**RC-034 (F-109): `package.json` resolved to `npm` by filename alone.**
`PACKAGE_MANAGER_BY_FILENAME` mapped `package.json` to `npm` with the derived confidence
`(medium, direct, deterministic, validated-machine, sufficient)`, while
`AMBIGUOUS_PACKAGE_MANIFESTS` contained only `pyproject.toml`. `package.json` is shared by
npm, pnpm, Yarn and Bun exactly as `pyproject.toml` is shared by Poetry, uv, PDM and Hatch.
ADR-031's title and consequence ("No evidence record claims `direct` strength for a
filename-only inference") state the principle; its decision text addressed only
`pyproject.toml`. A pnpm repository reported `['npm','pnpm']`, and both committed goldens
asserted `npm` evidenced only by `package.json`.

## Options Considered

### Option A: Root-anchored facts; nested matches become artifact-scoped claims

Repository-level derivation reads only root-level paths (plus GitHub's community-health
locations for governance), and the rule is applied at the interpretation seam for every
repository-scoped extractor: a match at a non-root path is filed against its own artifact.

- Pros: uniform and deterministic; no content reading in the builder; fixes manifests,
  README status, AGENTS/CLAUDE authority and `spec.yaml` alike; the existing
  `toPortableAssertions` / `bindPortableAssertions` round trip already carries artifact
  subjects, so caches need no new shape.
- Cons: monorepo workspace dependencies stop being repository claims; the local-source
  golden's archive-member status assertion moves subject; consumer re-conformance is
  required.

### Option B: Root plus declared workspaces

Resolve `package.json` `workspaces`, `pnpm-workspace.yaml` and Cargo `[workspace]` and treat
declared member packages as repository-level.

- Pros: most faithful for monorepos.
- Cons: requires content interpretation feeding the builder, which ADR-031 rejected
  (builder filesystem access); a larger, separate design.

### Option C: Root-anchored derivation; nested manifests produce no claims, only a diagnostic

- Pros: no consumer-conformance risk for artifact-scoped `package.*` claims.
- Cons: discards nested information entirely.

## Decision

The owner chose **Option A**. Option B is recorded as an explicitly deferred follow-up.
Option C is the fallback for `package.*` predicates only, and only if the topology consumer
rejects artifact-scoped package claims during re-conformance.

1. **Repository-level derivation is root-anchored.** Only a file directly at the
   repository root (a path with no `/`; an archive member `x.zip!/y` never is) determines
   `package_managers` or contributes an ambiguous-manifest diagnostic. Governance refs come
   from the root and GitHub's community-health locations, `.github/` and `docs/` (direct
   children only). ADR refs come from the root-level ADR directories `docs/decisions/`,
   `docs/adr/` and `docs/adrs/` (unchanged), and from an `adr-*.md` file at the root or in
   a root-level `adr/`, `adrs/` or `decisions/` directory. `languages` remains an aggregate
   over every observed file, and `workflows` was already anchored at `.github/workflows/`.
2. **`package.json` is a shared manifest.** It is removed from
   `PACKAGE_MANAGER_BY_FILENAME` and added to `AMBIGUOUS_PACKAGE_MANIFESTS`. Alone it
   resolves no manager and yields the existing `unsupported-by-evidence`
   `{field: package_managers, source_path: package.json}` diagnostic. Lockfiles stay
   determinative: `package-lock.json` / `npm-shrinkwrap.json` → npm, `pnpm-lock.yaml` →
   pnpm, `yarn.lock` → yarn. Deriving the manager from the `packageManager` field is not
   adopted: it would link interpretation assertions into derived facts, a separate
   decision.
3. **The interpretation seam resolves the subject from scope and path.** A
   repository-scoped extractor files its claims against the repository only for a
   root-level path; any other match is filed against
   `repositoryModelArtifactId(repositorySubjectId, sourcePath)`. This applies to every
   repository-scoped extractor (`manifest/v1`, `repository-status/v1`,
   `declared-authority/v1`, `service-spec/v1`, `python-route-observation/v1`,
   `contract-invariants/v1`); artifact-scoped extractors are unchanged. A nested manifest
   therefore never satisfies `declaresDependencies`, because that check reads only
   repository-subject claims.
4. **The profile names the rule.** `INTERPRETATION_PROFILE_VERSION` moves from 1.1.0 to
   1.2.0 and the profile hash binds `repository_subject_paths: "repository-root"`, so every
   interpreted packet's semantic identity — and every interpretation cache key — moves with
   the rule. ADR-055 Decision item 4 ("the interpretation profile stays at 1.1.0") is
   superseded for this change only.

## Consequences

- **Packet bytes change** for every interpreted packet (profile hash and version are in
  semantic identity), and for every repository containing `package.json` without a
  lockfile. Both committed golden bundles change: `package_managers` `["npm"]` → `[]`, the
  `package_managers` evidence record from `package.json` is removed (evidence count −1),
  one `unsupported-by-evidence` `package_managers` diagnostic for `package.json` is added
  (diagnostics +1), `interpretation_profile.profile_version` 1.1.0 → 1.2.0 with a new
  `profile_hash`, and `semantic_hash` / `packet_id` / receipt / manifest change. The
  local-source golden additionally moves the `repository.status=deprecated` assertion from
  `Bundle.zip!/README.md` to the archive-member artifact subject. Golden regeneration and
  topology re-conformance (ADR-030 Consequences) are required before publication.
- The consumer (`l9-constellation-topology`, `RepositoryModelV1Adapter`) must accept
  `package.*` and `repository.status` claims on artifact subjects; that is unproven until
  re-conformance. If it refuses, Decision item 3 falls back to Option C for `package.*`
  predicates before publication.
- Monorepos lose repository-level `package.*` claims from workspace packages until the
  deferred Option B is decided. Consumers that read `npm` for every JavaScript repository
  see an explicit coverage gap instead — the same honest-coverage trade ADR-031 accepted
  for `pyproject.toml`.
- Public API: only the value of the exported `INTERPRETATION_PROFILE_VERSION` changes.
- Follow-ups (separate decisions): declared-workspace resolution (Option B); `bun.lock` /
  `bun.lockb` in the lockfile table; manager resolution from the `packageManager` field.
