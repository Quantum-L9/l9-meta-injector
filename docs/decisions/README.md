# Architecture Decision Records

This directory contains the accepted decisions that govern the active `l9-meta-injector` architecture.

## Numbering

- ADR-001 through ADR-009 remain represented by the historical decision corpus under `docs/legacy/consolidation-v1/`.
- ADR-010 onward governs the active TypeScript package.
- Numbers are never reused.

## Status lifecycle

Use one of:

- `Proposed`
- `Accepted`
- `Deprecated`
- `Superseded by ADR-XXX`

Accepted ADRs are not deleted. A replacement ADR links back to the decision it supersedes, and the older ADR links forward to its replacement.

## Active ADRs

| ADR | Decision | Status |
|---|---|---|
| [ADR-010](010-typescript-pipeline-sole-active-engine.md) | TypeScript pipeline is the sole active engine | Accepted |
| [ADR-011](011-one-active-architecture-corpus.md) | Maintain one active architecture corpus | Accepted |
| [ADR-012](012-committed-dist-with-parity-proof.md) | Retain committed dist with source and tarball parity proof | Accepted |
| [ADR-013](013-orchestration-first-public-api.md) | Use an orchestration-first public API with explicit subpaths | Accepted |
| [ADR-014](014-layered-ci-gates.md) | Use layered CI with aggregate and independent gates | Accepted |
| [ADR-015](015-fail-closed-publication.md) | Keep npm publication fail-closed pending external evidence | Accepted |
| [ADR-016](016-local-files-archive-expansion.md) | Local-files mode expands zip archives before injection | Accepted |
| [ADR-017](017-omit-skill-protect-skills-mode.md) | Omit layer, SKILL.md protect, and Cursor-native skills mode | Accepted |
| [ADR-018](018-classification-injectability-coverage.md) | Classification injectability gate and coverage report persistence | Accepted, amended by ADR-054 |
| [ADR-046](046-archive-format-authority-and-fidelity-of-direct-mutation.md) | One archive-format authority, order-independent path conflicts, and byte-faithful direct mutation | Accepted |
| [ADR-047](047-one-glob-dialect-and-fail-closed-repository-modes.md) | One glob dialect, and repository modes that report instead of throw | Accepted |
| [ADR-048](048-organization-managed-l9-ci.md) | Organization L9 CI is centrally required, and the consumer owns no Core or SDK revision | Accepted |
| [ADR-049](049-inventory-archive-member-annotation.md) | Inventory-only archive member annotation, always-sidecar, and Darwin search projection | Accepted |
| [ADR-050](050-release-version-authority-and-major-tags.md) | One release version authority with maintained major consumer tags | Accepted |
| [ADR-051](051-inventory-derived-annotation-fields.md) | Inventory annotation fields are derived or Unknown | Accepted |
| [ADR-052](052-semantic-foundation-binding.md) | Semantic Foundation is cited by artifact_id and digest; headers derive from the v2 binding | Accepted |
| [ADR-053](053-semantic-binding-propagation.md) | A bound root stamps owner, refuses foreign namespace globs, relaxes the literal-namespace verify rule, and records run provenance | Accepted |
| [ADR-054](054-pipeline-identity-and-carrier-lifecycle.md) | Pipeline identity is path-derived and duplicate-refusing; classification is boundary-safe; carrier tiers gate the subject lifecycle | Accepted |
| [ADR-055](055-manifest-interpretation.md) | Every repository record is evidence-backed, and dependency coverage diagnostics defer to the manifest claims the seam already makes | Accepted, supersedes the ADR-031/032 manifest deferral |
| [ADR-056](056-dependency-updates-and-report-binding.md) | Dependency updates land through one maintainer rebind, and the validation report stays bound to the whole tree | Accepted |
| [ADR-057](057-comment-carrier-position-detection-and-value-safety.md) | Comment carriers sit after every mandatory prologue, are recognised only at the head, and escape what their host comment cannot hold | Accepted |
| [ADR-058](058-scoped-governed-runs-and-canonical-metadata-index-ordering-validation.md) | Scoped governed runs merge with the existing metadata index, which is code-point ordered and schema-enforced | Accepted |
| [ADR-059](059-corpus-cache-epoch-v2-and-decoder-dialect-identity.md) | The corpus cache verifies bytes before deriving, moves to epoch v2, and binds the decoder dialect into document identity | Accepted |
| [ADR-060](060-inventory-annotation-clock-convergence.md) | Inventory carrier clocks carry forward while carrier-free content is unchanged, and writers skip same-byte replaces | Accepted |
| [ADR-061](061-archive-admission-hardening-and-archive-reader-1-2-0.md) | ZIP admission bounds declared extents and produced sizes, folds file/directory conflicts, and moves the reader to 1.2.0 | Accepted |
| [ADR-062](062-repository-level-fact-scope-and-shared-manifest-evidence.md) | Repository-level facts are root-anchored, and `package.json` is a shared manifest | Accepted |
| [ADR-063](063-virtual-member-locator-collision-handling.md) | Archives that would mint an ambiguous member locator are held, and archive ancestry follows the parent chain | Accepted |
| [ADR-064](064-per-run-llm-adapter-scope-for-the-experimental-advanced-llm-subpath.md) | Each pipeline and skills run uses its own scoped LLM adapter; `setAdapter` sets the process-global default | Accepted |
| [ADR-065](065-inventory-content-hash-scope-versus-duplicate-cluster-byte-equality.md) | Inventory `content_hash` covers carrier-free content, and a duplicate cluster means same carrier-free content | Accepted |
| [ADR-066](066-generation-retention-order-and-exclusive-publisher-lock.md) | Generation retention follows recorded publication order, and one publisher holds an output root at a time | Accepted |
| [ADR-067](067-corpus-mode-index-schema-id.md) | The corpus-mode table of contents declares `l9.corpus-mode-index/v1` | Accepted |
| [ADR-068](068-not-run-versus-found-empty-in-corpus-packet-and-reports.md) | Passes that did not run are declared, not reported as empty or fully covered | Accepted |
| [ADR-069](069-direct-cli-argument-strictness-and-apply-fail-on-issues.md) | Direct CLIs share one strict option grammar, and apply refuses `fail-on-issues=false` | Accepted |
| [ADR-070](070-publication-evidence-set-and-version-bound-owner-approval.md) | Publication requires the ADR-015 evidence trio, a verified owner approval, and a version-bound `approved_version` | Accepted |
| [ADR-071](071-identity-stem-representation-of-non-ascii-path-segments.md) | Non-ASCII identity segments are NFC-normalised and encoded as ASCII tokens | Accepted |
| [ADR-072](072-nested-authority-discovery-exclusions.md) | Nested authority discovery descends writer-evidence exclusions and skips only VCS and dependency install trees | Accepted |
| [ADR-073](073-residual-duplicate-id-collisions-among-extracted-archive-members.md) | Duplicate-id refusal precedes tree mutation; collisions among extracted archive members are a documented residual | Accepted |

## Authority boundary

ADRs explain why decisions exist. Machine-readable contracts and executable validators remain the enforcement authority. When an ADR and an executable contract appear inconsistent, treat the state as drift and reconcile it through a reviewed change rather than silently choosing one.
