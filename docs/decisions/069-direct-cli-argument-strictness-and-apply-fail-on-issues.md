# ADR-069: Direct-CLI argument strictness and apply fail-on-issues semantics

## Status

Accepted

Amended by [ADR-076](076-errata-for-adr-058-and-adr-069.md): erratum to Consequences — the README `dry-run` / `fail-on-issues` rows were refreshed in `e17bd34`; the note that they are stale is historical.

## Date

2026-10-28

## Amends

[ADR-022: Contained Action and CLI Dispatch](022-contained-action-and-cli-dispatch.md)
(decision 8, per-mode boolean rules; consequence "direct lower-level CLIs remain
available").

## Context

Two defects share one boundary: the arguments a caller hands this package before any
engine runs.

**RC-101 (F-078): the direct CLIs parsed argv permissively.**
`scripts/lib/cli-args.js` (`flag` = `argv.includes`, `opt` = `argv[i+1]` whenever
truthy, `optAll` likewise) enumerated no allowed tokens. Its callers
(`scripts/inventory.js`, `pipeline-cli.js`, `check-cli.js`, `apply-cli.js`,
`skills-cli.js`, `repository-model-cli.js`) therefore:

- ignored unknown tokens, so `inventory.js src --dryrun` annotated the source tree,
  although `inventory.js` documents that it modifies the source by default and that
  `--dry-run` is the only observation switch;
- let a value option swallow an option token (`--out --dry-run` wrote into a directory
  named `--dry-run`);
- silently took the first of duplicated options;
- coerced `--near-dup` and `--hash-prefix-length` with an unchecked `Number()`, so
  `abc`, `5`, `-1`, `7` or `1.5` reached the engine, which does not validate them;
- accepted `--namespace-glob =ns` and `glob=` in `pipeline-cli.js` (`eq < 0` only),
  unlike `check-cli.js` and `apply-cli.js`.

The governed dispatcher (`scripts/lib/operation-dispatch.js` `parseArgOptions`) already
rejected all of these, so the same package had two argv grammars for the same options.

**RC-103 (F-142): `fail-on-issues: false` for apply was accepted and ignored.**
`action.yml` documented: *"check always fails on drift; apply may set false for
advisory verification."* `assertModeShape` refused `false` for check, inventory and
skills but not apply, and `resolveScriptAndArgs` forwarded `--no-fail-on-issues` to
`apply-cli.js`, which never read it. Apply has no verification-only failure to make
advisory: in `src/apply.ts` `passed` is `false` only on a repository authority
conflict; every other failure throws (exit 2). The only faithful implementation of
the advertised advisory mode would turn an authority refusal into a green step.

## Options Considered

### RC-103 option A: refuse `fail-on-issues=false` for apply in the dispatcher

- Pros: the contract and the behaviour agree; fail-closed; one-line rule beside the
  existing check/inventory/skills rules.
- Cons: breaking for callers that pass `false` with apply: the step now fails at input
  validation (exit 2) even when apply would have succeeded.

### RC-103 option B: honour it in apply-cli by exiting 0 when `passed=false`

- Pros: non-breaking for callers.
- Cons: converts repository authority refusals into green steps; contradicts
  fail-closed authority (INV-018).

### RC-103 option C: accept with a deprecation warning for one release, then refuse

- Pros: a transition period.
- Cons: keeps an input that does nothing; two changes. The only known consumer
  (`Quantum-L9/l9-constellation-topology`, `docs/package-publication-decision.json`)
  does not use the Action's apply mode.

### RC-101: strictness inside the shared helper versus per-script parsers

- Per-script parsers would duplicate the dispatcher's grammar six more times.
- A shared strict core with a per-script option declaration keeps one definition, and
  the dispatcher can use the same core.

## Decision

The repository owner adopted the recommended options.

1. **apply refuses `fail-on-issues=false`** (RC-103 option A). `assertModeShape` fails
   with `fail-on-issues=false is forbidden for apply`, for both the Action environment
   and `operation-cli.js apply ... --no-fail-on-issues`, before any child runs. The
   dispatcher never forwards `--no-fail-on-issues` to `apply-cli.js`. With this,
   `fail-on-issues` accepts only `true` (or empty, meaning `true`) in every mode;
   `action.yml` says so.
2. **One strict option core.** `scripts/lib/cli-args.js` `parseOptionArgv(args, spec)`
   implements the dispatcher's semantics: bare boolean flags, optional `--no-<flag>`
   negation (`spec.negatable`), unknown token rejected, a value option without a value
   or whose value is a known option token rejected, a non-repeatable option at most
   once. `operation-dispatch.parseArgOptions` delegates to it with the dispatcher's
   fixed option sets and `validateValues: false`, so its messages and behaviour are
   unchanged (`tests/cli_option_parsing.test.ts`).
3. **Every direct CLI declares its options.** `CLI_OPTION_SPECS` in `cli-args.js`,
   keyed by the label each script already passes to `parseCli(label, usage)`, lists
   that script's boolean, value and repeatable options exactly as its usage string
   does (`pipeline-cli.js` keeps both `--fail-on-issues` and `--no-fail-on-issues`;
   `apply-cli.js` declares no fail-on-issues flag). `parseCli` gains an optional
   `spec` parameter defaulting to that table, so no call site changes. The
   `flag()` / `opt()` / `optAll()` readers keep their API and defaults; reading an
   option the declaration does not name throws, so a declaration cannot drift from
   its script.
4. **Values are validated at parse time with the dispatcher's bounds.** `--near-dup`
   must be a finite number in [0, 1]; `--hash-prefix-length` an integer in 8..64
   (`NUMERIC_OPTION_BOUNDS`, which the dispatcher now also reads); `--namespace-glob`
   needs a non-empty glob and namespace (`isNamespaceGlobPair`, shared with the
   dispatcher), which aligns `pipeline-cli.js` with check and apply. An empty value
   keeps the reader's default, exactly as before.
5. Every rejection exits 2 with the offending token named and the usage printed,
   before any filesystem access beyond resolving the positional root.

## Consequences

- **A documented contract is broken, stated explicitly (DEC-GAR-04).** `action.yml`
  documented `fail-on-issues: false` as an advisory form of apply. That behaviour was
  never implemented (the flag had no reader), but the input combination was
  documented and accepted, and it is now an input error. DEC-GAR-04 ships behaviour
  changes within v4 only where the old behaviour was never a documented contract, and
  routes a broken documented contract to a major release (alternative B). This ADR
  therefore flags the apply `fail-on-issues=false` refusal as a documented-contract
  break: its release versioning (v4 fix versus v5) is an owner release decision this
  ADR does not make. Mitigating facts for that decision: the advertised semantics never
  existed, the only faithful implementation would violate fail-closed authority, and
  the only known consumer does not use the Action's apply mode. Callers must drop
  `fail-on-issues: 'false'` from `mode: apply` steps. Release itself requires separate
  authority.
- **Direct-CLI strictness ships within v4 as a fix** (DEC-GAR-04): only invocations
  that were already wrong change outcome — typos, options given to the wrong script,
  missing values, out-of-range thresholds, malformed namespace-glob pairs and extra
  positionals now exit 2 instead of being ignored or mis-parsed. Every option in each
  script's usage string keeps its semantics. Operator scripts that passed an option a
  script never declared (for example `--verbose` to `inventory.js`) fail loudly.
- The dispatcher's argv grammar and messages are unchanged; dispatcher-generated argv
  is accepted by every child's declaration (`tests/cli_strictness.test.ts`
  REG-WU-066-RC-101-h).
- `scripts/local-source-cli.js` keeps its own permissive parser; it is outside this
  decision and is a candidate follow-up finding.
- README input-table rows for `dry-run` / `fail-on-issues` still describe the legacy
  `pipeline` preview with `fail-on-issues: "false"`; they must be refreshed with this
  decision (CHANGELOG and README are integrator-owned in this remediation).

## Validation

- `tests/cli_strictness.test.ts`: REG-WU-066-RC-103-a..d and REG-WU-066-RC-101-a..h,
  including `inventory.js --dryrun` exiting 2 with the source byte-identical.
- `tests/cli_option_parsing.test.ts` and `tests/authority_semantic_binding.test.ts`
  unchanged and passing (dispatcher grammar and `pipeline-cli.js --no-fail-on-issues`
  preserved).
