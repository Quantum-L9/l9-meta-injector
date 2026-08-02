# ADR-022: Contained Action and CLI Dispatch

- Status: Accepted
- Date: 2026-08-01
- Decision owners: Quantum-L9 repository maintainers
- Supersedes: composite Action mode branching in `action.yml`

## Context

The composite Action previously embedded caller-controlled inputs directly into a
Bash program, treated every unknown mode as inventory, accepted path traversal
through `root` and `out`, and referenced external Actions through mutable major
version tags. Separate check and pipeline branches also duplicated dispatch
policy and made mode behavior easier to drift.

The repository already defines exhaustive canonical operation contracts. The
invocation boundary must enforce those contracts before any repository-specific
engine executes.

## Decision

1. One Node dispatcher, `scripts/operation-cli.js`, owns canonical mode routing
   for both direct CLI use and the composite Action.
2. Canonical modes are `inventory`, `check`, `apply`, and `skills`.
   `pipeline` is accepted temporarily only as a deprecated alias for `apply`.
   Empty and unknown modes fail.
3. Composite Action inputs cross into the dispatcher through environment
   variables. No caller input is interpolated into shell source.
4. Child commands are executed with argument arrays and `shell: false`.
5. `root` must resolve to an existing directory inside `GITHUB_WORKSPACE`.
   `out` must remain under the resolved target root. Absolute paths, lexical
   traversal, and symlink escapes fail before execution.
6. Check reports are placed under `RUNNER_TEMP`, outside the target repository.
7. Check and apply require an explicit authority input. The Action does not
   assume `l9.doctrine.platform` for arbitrary repositories.
8. Boolean inputs accept only `true`, `false`, or an empty value with an
   operation-specific default. Contradictory combinations fail closed.
9. External Actions are pinned to full release commit SHAs.

## Consequences

- Action behavior becomes deterministic and auditable across modes.
- Shell metacharacters remain inert argument data.
- Existing callers using `mode: pipeline` continue to work with a deprecation
  warning, but callers relying on unknown-mode fallback now fail.
- Check/apply callers must declare authority explicitly.
- Direct lower-level CLIs remain available, while `npm run operate -- ...`
  becomes the governed multi-mode entrypoint.

## Validation

- Mode-parity tests compare the JavaScript dispatcher with the TypeScript
  operation contract.
- Traversal, absolute-path, and symlink-escape fixtures must fail.
- Action source tests forbid input expressions in `run:` shell source.
- Action source tests require full 40-character SHA pins.
- Hostile shell metacharacters must remain one argv element with `shell: false`.
