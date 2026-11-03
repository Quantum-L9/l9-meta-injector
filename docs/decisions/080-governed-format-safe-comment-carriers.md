# ADR-080: Governed format-safe comment carriers and explicit inline exceptions

## Status

Accepted

## Date

2026-11-03

## Supersedes

[ADR-024](024-explicit-metadata-carrier-policy.md), only its source/configuration
prohibition (Decision items 3–4 and the first consequence). Its single policy resolver,
safety-first carrier classes, explicit authority requirement, and path-validation rules
remain in force. ADR-024 is retained as historical evidence; ADR-057's statement that
comment carriers were outside governed apply describes the policy before this decision.

## Context

The governed path has an explicit repository authority, one check/apply plan, and a
whole-run transaction. The existing comment renderer also preserves mandatory prologues,
BOMs, newline conventions and the carrier-free body, and escapes values that cannot
appear literally in a host comment (ADR-046, ADR-057). Nevertheless, ADR-024 prevents an
owner from authorizing even a safe Python or YAML metadata header. Source and
configuration need a narrow opt-in, not a new default writer or an unrestricted blanket
grant. Fixture bytes, generated state, secrets and comment-less formats require
exceptions independent of an operator's allow list.

## Options Considered

### Option A: Retain central-only source and configuration

- Pros: no expansion of inline mutation authority.
- Cons: rejects explicit owner authorization even when the established renderer and
  transaction can preserve the host format and body.

### Option B: Explicit safe comment authorization with higher-precedence exceptions

- Pros: reuses the existing renderer and governed transaction; unchanged configurations
  retain central defaults; exclusions can narrow an allow list without hiding files.
- Cons: carrier policy must distinguish comment capability from permission and protect
  hidden controls, fixtures and secrets before considering any allow match.

## Decision

We choose **Option B**. `src/mutation_policy.ts` remains the sole carrier-policy resolver;
syntax compatibility alone never grants mutation authority.

1. `default_carrier: central_manifest` remains the default. Even
   `default_carrier: inline_managed` requires an explicit safe `inline_allow` match.
   An allow match may authorize supported `line-comment` or `block-comment` headers in
   source, ordinary tests, scripts, configuration, workflows and infrastructure. Existing
   approved Markdown/YAML-frontmatter eligibility is retained, not broadened to arbitrary
   frontmatter formats.
2. Safety classes win first: `.git`, `.l9`, dependency internals, injector-owned outputs
   and binary/media content are `hard_skip`; generated, vendored, environment-managed
   and lock-state artifacts remain `inventory_only`. Neither is writable under any allow
   pattern. Secret-bearing `.env` files are hard-protected; the explicitly named,
   non-secret template `.env.example` is a separate safe comment-carrier case.
3. Canonical fixture directory families (`fixture`, `fixtures`, `__fixtures__`),
   `golden_tests` and `datasets`, at any depth, remain centrally indexed and are never
   inline-mutated, even with `inline_allow: ["**"]`. These are policy protections, not
   discovery omissions; ordinary test source outside these directories can be allowed.
4. Authority v1 and v2 may add optional `inline_exclude?: string[]`. Omission is equivalent
   to `[]`, preserving existing authority files. It uses the same validated,
   repository-relative POSIX glob dialect as `inline_allow` (ADR-047), and a matching
   exclusion outranks every allow match. It suppresses inline mutation, not discovery or
   central metadata coverage; it cannot weaken a higher safety class.
5. A hidden control surface requires a named safe allow pattern that explicitly names
   its hidden component, such as `.github/workflows/*.yml`, `.gitignore` or `.editorconfig`.
   A blanket `**` or ordinary `**/*.yaml` grant never unlocks hidden controls. Naming a
   hidden path still cannot unlock `.git`, `.l9`, secrets or an unsupported carrier.
   Admitted hidden controls must be representable in the canonical index: a leading-dot
   name is not traversal, while absolute paths, `.`/`..` segments, control characters
   and paths longer than 4096 characters remain refused.
6. JSON, JSONL, plaintext, unknown text and files without a safe inert comment position
   remain central or retain an existing external carrier without modifying it. Governed
   apply inserts no comments into these formats and creates no adjacent sidecars.
   `inline_allow` does not override this limitation. Normal-mode `SKILL.md` protection
   and the separate authority-governed skills operation are unchanged.
7. Check and apply consume the same decisions. An inline target must be the source itself
   and use an approved frontmatter, line-comment or block-comment strategy. Rendering
   reuses the existing prologue-aware implementation, preserves shebangs, BOMs, encoding
   cookies, CRLF and body bytes, and creates no auxiliary carrier. Rendered bytes must
   match the plan; every changed inline target and the canonical index commit in the
   existing compare-and-swap transaction with body and metadata post-verification and
   whole-run rollback on failure. Non-UTF-8 bytes are not transcoded to make them writable.

## Review corrections (2026-11-03)

Filename-only comment capability must be unambiguous. `.s` can mean GNU assembly,
where `;` is not a portable comment delimiter, and `.m` can mean Objective-C rather
than MATLAB. Neither extension grants governed comment-carrier eligibility without
a verified dialect-specific rule; explicit authorization cannot make an unsafe
delimiter safe. These paths remain central and their source bytes are preserved.

The GitHub operational hidden-control exception applies only to root `.github/`.
`nested/.github/workflows/` and `nested/.github/CODEOWNERS` are not GitHub control
surfaces, even if an allow pattern explicitly names them. Neither discovery nor
mutation may admit them through this exception. Other supported named harmless
dotfile controls retain their existing independent admission rules.

This ADR remains the narrow opt-in comment-carrier contract. It does not assert
exact Git-tree-wide coverage, symlink/binary metadata materialization, path-exact
identity migration, or completion of the separately proposed universal campaign.

## Consequences

- Authority files without inline allow grants keep source/configuration central.
  Consumers that already allowed those paths will see eligible headers change on their
  next governed apply; review the patterns and use `inline_exclude` to narrow them.
  The README provides an opt-in example, not a recommended blanket grant.
- Inventory/scanned counts and metadata-index record counts measure observation and
  coverage, not source mutation. Non-`hard_skip` subjects remain indexed even when inline;
  `inlineChanged` counts changed source carriers and `metadataIndexChanged` reports the
  separate index write. Discovery omissions, hard skips, encoding/unsupported-entry holds
  and carrier fallbacks remain named exceptions, not claims of universal inline coverage.
- Regression proof must cover exclusion-over-allow precedence, fixture and hidden-control
  blanket-grant refusal, secret protection, comment-less fallback, prologue/body fidelity,
  read-only check, transactional rollback and a zero-write second apply.
- This is an unreleased carrier-policy change. Package version remains 4.3.0 pending a
  separately authorized
  release; release identity, publication evidence and publication authorization do not
  change.
