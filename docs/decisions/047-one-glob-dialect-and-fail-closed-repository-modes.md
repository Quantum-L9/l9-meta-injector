# ADR-047: One glob dialect, and repository modes that report instead of throw

## Status

Accepted

## Date

2026-09-03

## Context

A forensic audit of the repository-targeting modes — governed `check`, `apply` and
`skills`, the operation dispatcher behind `action.yml`, the authority scan, the carrier
policy, the metadata index and the whole-run file transaction — ran every mode against
realistic and adversarial repositories from the committed build and confirmed the
following defects at code depth.

**The discovery scope honored only an extension.** `discoverFiles` derived a single
`.ext` filter from a trailing `*.ext` and ignored every other character of the glob. A
governed check with `docs/**/*.md` planned `other/b.md`, and the matching apply
mutated it; `**/*.{md,txt}`, `**/[ab].md`, `docs/*` and `**` all discovered the same
full set. The repository authority's `inline_allow` used a separate, anchored, correct
matcher, so the same pattern meant one thing to the scope that chose the files and
another to the authority that licensed them.

**The transaction lost file modes to the umask.** `stageEntries` opened the staging
file with the recorded original mode, and `open` applies the process umask; under
`umask 077` an existing `0o775` target was committed as `0o700` and a new file asked
for as `0o664` was committed as `0o600`. The journal recorded the original mode and
never restored it — the same class of defect ADR-046 repaired in `durable_write.ts`.

**The transaction primitive accepted protected targets.** An intent for `.git/config`
or for `.l9/meta-authority.yaml` — the document that licenses the writer — was
accepted and committed. No governed caller plans such a path today, because discovery
excludes `.l9` and hidden control paths, so the exposure was defense-in-depth rather
than a live escape; but a primitive that writes Git internals or the authority on
request has no reason to exist.

**A hostile archive crashed the read-only check.** With `localFiles`, the governed
check listed ZIP members through the same reader that refuses an escaping member
path, and let the refusal escape as an exception, so the report was lost exactly when
it mattered. Bytes that were not a ZIP under a `.zip` name did the same. A `.tar`
beside them was not reported at all, because the inspection only found expandable
archives. An unreadable directory inside the before-snapshot likewise escaped as an
exception rather than a verdict.

**A nested authority was invisible.** A repository whose root declared
`legacy_writers: forbidden` and whose `vendor/.l9/meta-authority.yaml` declared
`allowed` passed the check with no conflict and no notice, and the files under
`vendor/` received carrier decisions under the root policy. The scanner considered only
control-surface names and prefixes; a second authority document was none of them.

**A BOM or a CRLF fence broke the apply that produced it.** The end-to-end run over a
mixed repository corpus found two more. The frontmatter patcher keeps a byte-order mark
at byte 0 and writes the opening fence after it, but header detection in `extract.ts`
tested the raw bytes for a leading `---`, so the file the transaction had just written
read as having no header and the whole governed apply failed its own verification and
rolled back — one BOM file blocked metadata for every file in the run. And after a
closing fence the same detector consumed only `\n`, so a CRLF file kept a stray `\r` at
the head of its body: the body hash recorded in the metadata index by the run that
injected the header differed from the one every later run computed, the next check
reported the index stale, and the second apply rewrote it.

The audit also confirmed, and now pins with tests, what was already correct: the
transaction's rename gives a replaced target a new inode, so a hard link from outside
the root keeps its bytes; the dispatcher's containment, boolean grammar, mode rules and
numeric bounds all fail closed; a second apply is a byte-identical no-op and a
check-then-apply race cannot commit over changed bytes because the transaction's
expected hash rejects a stale plan.

## Decision

1. **One glob dialect.** `src/glob.ts` owns the pattern language: `**/` matches zero or
   more directories, `**` elsewhere crosses separators, `*` stays inside a segment, `?`
   matches one character, everything else is literal. The repository authority's
   `inline_allow` compiles through it case-sensitively, exactly as before. The
   discovery scope compiles through it as a whole-path matcher, case-insensitively so a
   `*.MD` scope keeps matching `.md` as the former extension filter did.
2. **The scope is judged before the tree is read.** `assertDiscoveryGlob` refuses an
   absolute, `./`-prefixed, parent-relative, doubled-separator, backslash or
   control-character pattern, and refuses brace alternation, character classes and
   negation — syntax the dialect does not express — with the reason. A scope that
   silently matched nothing, or everything, would let a governed run report success
   over the wrong file set. The authority keeps treating that syntax as literal,
   because a pattern that never matches grants nothing.
3. **The ledger names the decision.** A file outside the scope is recorded as
   `glob_filtered`; a file whose extension fails a `*.ext` tail keeps the historical
   `extension_filtered` disposition so existing reports stay comparable.
4. **The transaction restores the mode it recorded.** The staging descriptor is
   `fchmod`ed to the original or intended mode before the bytes are written.
5. **The transaction refuses protected targets.** Any path with a `.git` segment, the
   authority document and the journal directory are refused by the primitive, whatever
   a caller plans. The canonical metadata index beside the authority stays writable.
6. **The read-only check reports every archive and never throws for one.** Inspection
   reads the before-snapshot: each archive name the format authority recognizes becomes
   `unsupported` drift; a ZIP that cannot be listed is reported with the reader's reason;
   a format the product never expands is reported as never opened. An entry the snapshot
   cannot read is recorded and reported, and the authority scan, which walks first,
   turns the same directory into a scan gap that fails the run closed.
7. **One repository has one authority.** Every `.l9/meta-authority.yaml` below the root
   is a `META_AUTHORITY_CONFLICT` naming its path, in code-point order, so the authority
   does not resolve and no carrier decision is made. A nested `.l9` without a document
   competes with nothing.
8. **A byte-order mark and a fence line ending are not content.** `splitContent` and
   `stripExistingFrontMatter` look past a leading BOM and consume the closing fence
   line as `\r?\n`, so the body — and the hash the index records for it — is the same
   before and after the header is injected, for LF and CRLF files alike.

## Consequences

- An operator's scope is honored literally or refused with the reason. A pattern that
  used to widen silently (`docs/**/*.md` mutating `other/`) now narrows to what it names;
  a pattern the dialect cannot express fails the run before discovery.
- `DiscoveryDisposition` gains `glob_filtered`; consumers enumerating dispositions see a
  new non-blocking key. `extension_filtered` keeps its meaning.
- Repositories with nested authority documents fail the governed modes until the
  nesting is resolved. That is the intended outcome: the alternative was applying the
  root policy to a subtree that declared a different one.
- A governed check over a hostile or unreadable tree now returns a failing report
  instead of an exception, so the action's report file is produced in every case.
- A repository with BOM-prefixed or CRLF markdown applies in one run and is idempotent
  afterwards; previously the BOM case failed the whole run and the CRLF case needed a
  second apply to settle the index.
- The `action.yml` composite exposes no `glob` input; the dispatcher's `L9_INPUT_GLOB`
  environment value passes through unchanged and is judged at discovery. Adding the
  input is a separate decision.

## Evidence

- `tests/discovery_glob_scope.test.ts` — prefix honored, root-only and recursive
  shapes, case-insensitive extension, every refused pattern, matcher agreement with the
  authority, governed check and apply scoped and refusing.
- `tests/file_transaction_mode_and_protected_paths.test.ts` — modes under `umask 077`,
  hard link from outside the root, every protected target refused, index still writable.
- `tests/check_archive_inspection.test.ts` and `tests/check_unreadable_entry.test.ts` —
  hostile, broken, tar and well-formed archives reported without a throw and without a
  write; unreadable directory reported as a scan gap.
- `tests/apply_bom_frontmatter.test.ts` — BOM and CRLF header detection; a governed apply
  over a BOM file commits with the BOM at byte 0 and re-checks clean; a CRLF file leaves
  the index consistent so check passes and a second apply is a no-op.
- `tests/authority_nested_declaration.test.ts` — nested declarations as conflicts,
  governed check fails closed, nested `.l9` without a document resolves.

## Related

- ADR-036 (read-only local-source observation), ADR-044/045/046 (archive authority and
  materialization), the authority-scan and file-transaction decisions this one extends.
