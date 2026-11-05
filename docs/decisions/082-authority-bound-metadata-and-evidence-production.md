# ADR-082: Authority-bound metadata and evidence production (Phase 1 producer foundation)

## Status

Accepted

## Date

2026-11-05

## Context

The Repository Model Packet producer (ADR-030, ADR-032) emitted inventory
observations and a fixed set of manifest, prose and work-intelligence assertions.
It carried nothing about:

- the repository's Semantic Foundation binding (ADR-052);
- the native metadata headers that constellation repositories already write;
- the architectural constructs that are explicit in their source.

The constructs in question are workflow jobs, `needs` and `uses` references,
static imports, requirements files and literal contract references. Phase 1 of
the metadata-to-constellation integration asks the existing producer to carry
these as source-evidenced observations, with:

- exact identity and provenance;
- no second writer, packet producer, authority file or graph representation;
- no promotion of a declaration into an architectural fact.

Evidence read before deciding:

- **Native headers.** Real header syntax was read from `Quantum-L9/L9-Ops-MCP`
  `main@fecdd927` (114 hash blocks, 83 frontmatter blocks, 20 HTML-comment
  blocks, pipe-delimited kernel blocks, PR #41's managed blocks). Header fragments
  of `Cognitive.Engine.Graphs` (docstring carrier) and
  `Enrichment.Inference.Engine` (`ssot_for`, `load_when`, `references`) came from
  code search. `l9_schema: 2` was found only in a CEG test and in
  Cursor-Governance.
- **Consumer behaviour.** The bound consumer
  (`l9-constellation-topology@2c2c628`) preserves an assertion whose predicate
  its registry does not name. It records the assertion as an `unsupported` claim
  with its evidence, a diagnostic and an unknown, and never projects it. Only
  registered predicates project (`package.dependency` to `DEPENDS_ON` against
  an external package node).

## Options Considered

### Option A: A new metadata pipeline and packet domain

- Pros: free to model headers natively.
- Cons:
  - a second producer and a wire-schema change;
  - a consumer migration;
  - exactly the parallel architecture the pack forbids.

### Option B: New observations as assertions in the existing 1.1.0 packet, under predicate namespaces the consumer does not project

- Pros:
  - no wire change;
  - the consumer already preserves unregistered predicates with their evidence
    and refuses to project them, which is the Phase 1 epistemic boundary;
  - Phase 2 decides projection by registering predicates in the consumer.
- Cons: every interpreted packet's semantic identity moves once, because the
  extractor registry is part of the interpretation profile.

### Option C: Option B, plus projecting workflow and import observations into producer relationships

- Pros: richer packets.
- Cons:
  - invents canonical edges from syntax;
  - ADR-055 already places projection on the consumer;
  - violates "no canonical relationship without supported source evidence".

## Decision

We choose **Option B**. The decision has seven parts.

### 1. Semantic Foundation binding (P1.1)

`observeSemanticBinding` (`src/authority.ts`) reads the binding through
`loadRepositoryAuthority`, which now records the digest of the exact bytes it
parsed. It reuses `verifySemanticFoundation`. Verification against an
operator-supplied `Quantum-L9/.github` checkout requires all of the following:

- the binding names `Quantum-L9/.github`;
- the checkout's GitHub origin names it;
- checkout HEAD equals the bound revision;
- every cited ledger is claimed once, with a matching digest;
- `product.id` equals the observed repository name.

Nothing is fetched. The packet carries the outcome as follows:

- **Declared binding.** One `declared` evidence record (`semantic_binding`),
  citing `.l9/meta-authority.yaml` and its digest. `.l9/` is never an emitted
  artifact, so no artifact-scoped assertion is fabricated for it.
- **Verified binding.** A separate `validated` / `validation` record
  (`semantic_binding.verification`) whose value states the checks it covers and
  `admission_granted_by_verification: false`.
- **Identity.** `owner_ids` and `repository_id` are unchanged.
- **Diagnostics.** Unbound, v1 and conflicting bindings are reported as
  diagnostics.

The compatibility policy:

- Without a checkout, observation never fails on authority.
- Supplying a checkout requests verification; a failed verification refuses to
  build.
- `requireSemanticBinding` (CLI `--require-semantic-binding`) refuses anything
  short of a verified v2 binding.
- An invalid v2 file was already refused by inventory (ADR-052), and still is.

### 2. Native headers (P1.2)

`parseNativeMetadata` (`src/native_metadata.ts`) is the single, pure reader of:

- legacy hash, bare-hash, pipe-delimited, HTML-comment and Python-docstring
  `L9_META` blocks;
- L9 frontmatter (through `inspectFrontMatterDocument`);
- managed `l9:meta` blocks (through the new read-only `injectedBlockSpan`, which
  exposes the existing carrier-position detection).

A carrier is read only at the file head, and it may be stacked after a BOM, a
shebang, a cookie, a language-server line or non-L9 frontmatter. The reader
rejects a duplicate key or a non-`key: value` line, marks a nested or
block-scalar field unsupported, and reports a marker elsewhere without reading
it.

`native-metadata/v1` files claims against the declaring artifact as follows:

| Predicate | Object | Evidence class | Confidence |
|---|---|---|---|
| `meta.declaration.carrier` | the carrier | `observed` | — |
| `meta.declaration.schema` | `l9_schema:<as written>`, or `managed:l9-meta-injector` | `declared` | — |
| `meta.<l9v1\|l9v2\|managed>.<category>.<field>` | the declared value | `declared` | `medium` |
| `…unresolved_field` | the key | — | — |
| `…unsupported_field` | the key | — | — |
| `meta.unversioned.field` | the key (for an absent or unknown schema) | — | — |

Schema 1 and schema 2 never share a predicate. `ssot_for`, `references` and
`load_when` remain declarations.

### 3. Architectural observers (P1.3)

- **`workflow-structure/v1`.** Reads root `.github/workflows/*` and reports:
  - `workflow.job`, `workflow.job_needs` and `…_unresolved`, which name jobs of
    one file and are never repository dependencies;
  - `workflow.uses_action`, `…_reusable_workflow`, `…_local`,
    `…_local_unresolved` and `…_docker`.

  Block scalars are skipped whole. Expressions and flow mappings are reported,
  not read.
- **`static-imports/v1`.** Reads the static Python and TS/JS import forms with a
  tokenizer that excludes comments, strings, templates and regular expressions.
  It classifies specifiers as:
  - `source.import.local`, resolved only to an observed path in the importer's
    documented resolver precedence;
  - `…local_unresolved`;
  - `…absolute`, deliberately unclassified;
  - `…builtin`;
  - `…url`.

  Dynamic imports are counted and reported. A file that cannot be scanned to its
  end yields no imports.
- **`contract-references/v1`.** Reports literal external `$ref`s in
  OpenAPI/Swagger/AsyncAPI documents.
- **`manifest/v1` 1.2.0.** Reads pip requirements files, as ADR-055 admitted.
  Options, paths and URL-only lines are reported, never guessed into a name.
- **Unchanged.** Route and service observers are unchanged. No documented
  relationship grammar exists for prose, so prose is not read for relationships.

### 4. Diagnostic channel and packet integration (P1.4)

Extractors receive an optional `report` channel, bounded to
`MAX_EXTRACTOR_DIAGNOSTICS_PER_FILE` (8) per extractor and file. The builder now
carries interpretation diagnostics into the packet, under stage
`meta-injector-interpretation`.

Producer validation adds these checks:

- assertion authority no higher than `source`;
- portable assertion paths;
- unique assertion ids;
- secret-free excerpts;
- relationships limited to observed `CONTAINS` / `DERIVED_FROM` with evidence;
- `owner_ids` never promoted;
- verification never claiming admission.

### 5. No double-reading of headers

`document-structure/v1` and `work-intelligence/v1` (now 1.2.0) treat non-frontmatter
header blocks as non-prose. An EIE-style `# --- L9_META ---` line therefore no
longer becomes a Markdown title, which had produced a false `document.title`
conflict at the consumer.

### 6. Cacheable root-dependent interpretation

The corpus cache previously stored nothing for a document that consulted its
root, so the new local-resolution observers would have made every warm run miss.
It now stores a level-one index of the paths a document probed, plus a level-two
entry keyed on those paths' answers. The result is a function of the bytes and
of those answers, so a hit can never serve an answer the current root would not
give.

### 7. Versions

`INTERPRETATION_PROFILE_VERSION` moves 1.2.0 → 1.3.0. `l9.repository-model`
stays **1.1.0**: no field or domain is added, and the assertion shape is
unchanged.

## Consequences

- **Semantic identity moves.** Every interpreted packet's identity changes once,
  through the profile hash. Both golden bundles were regenerated. The diff is the
  profile identity, one `workflow.job` assertion and one
  `semantic-binding-unresolved` diagnostic in the sample repository, with 21
  receipt checks.
- **Conformance recorded.** `docs/topology-conformance.json` was re-recorded
  against the consumer at the bound revision `2c2c628`. That run showed:
  - acceptance without a translation shim;
  - a byte-unchanged consumer checkout.

  A separate compile of the Phase 1 fixture and of this repository's bound
  packet showed every new-predicate claim preserved as `unsupported`, with zero
  projected edges.
- **Hash scopes stay distinct.** Assertion `source_content_hash` remains the
  whole-file hash. Artifact `content_hash` remains inventory's carrier-free body
  hash for files with a managed carrier (ADR-065). The two differ by design, and
  Phase 2 must not equate them.
- **Deferred to Phase 2:**
  - governed mapping of `meta.*` predicates onto Semantic Foundation vocabulary;
  - consumer registration of any predicate that should project;
  - ownership and capability resolution;
  - cross-repository exact-revision acceptance.
- **Recorded, not fixed here.** `document-structure/v1` reads a `# …` comment in
  a `.txt` file (for example `requirements.txt`) as a heading. That predates this
  decision and changes text-document semantics broadly, so it needs its own
  decision.

## References

- ADR-030, ADR-032, ADR-052, ADR-053, ADR-055, ADR-057, ADR-062, ADR-065, ADR-080
- `docs/repository-model-semantics.md`
- `fixtures/repository-model/phase1-semantics/`
