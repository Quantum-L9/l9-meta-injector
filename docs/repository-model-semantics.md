# Repository Model semantics

This page is the reference for what the Repository Model Packet producer
observes and how much each observation claims. The decision is
[ADR-082](decisions/082-authority-bound-metadata-and-evidence-production.md),
the packet contract is ADR-030 / ADR-032, and the wire version is
`l9.repository-model` **1.1.0**. This page is not a second contract: the
executable validators in `src/repository_model.ts` and the tests under `tests/`
are the authority.

## Epistemic classes

| Class | Meaning | Where it appears |
|---|---|---|
| Declared | The source states it | `evidence_class: declared` assertions; `semantic_binding` evidence |
| Observed | A deterministic parser saw the construct | `evidence_class: observed` assertions |
| Validated | A named machine check passed, over a stated scope | `semantic_binding.verification` evidence (`evidence_class: validated`) |
| Unresolved | Identity, target or value could not be established | `…_unresolved` / `…unresolved_field` predicates, `semantic-binding-unresolved` |
| Candidate | Suggested, not admitted | Semantic Foundation `admission: candidate`, carried verbatim |
| Heuristic / model-assisted | Not produced by this producer | Refused by validation for relationships |

The rules that follow from these classes:

- **Parsing is not truth.** A claim's `confidence` describes the claim, not
  the parse. Header field claims are `medium` however cleanly they parse.
- **Authority stops at the source.** Every assertion's `authority` is `source`.
  Validation refuses `validated-machine` or `derived` on an assertion.
- **No new edges.** The only relationships this producer emits are `CONTAINS`
  and `DERIVED_FROM`. Every other edge is the consumer's projection of a claim.

## Semantic Foundation binding

| Evidence `field` | Class | Value |
|---|---|---|
| `semantic_binding` | `declared`, `source_type: file` | authority schema, foundation repository / revision / release / admission / ledgers, product id / owner / kind / archetype — as written |
| `semantic_binding.verification` | `validated`, `source_type: validation` | `status: verified`, the check scope, ledger count, `admission`, `admission_granted_by_verification: false` |

Both records cite `.l9/meta-authority.yaml` and the sha256 of its exact bytes.
The authority file is not an emitted artifact (inventory never emits `.l9/`), so
no assertion is filed against it.

Diagnostics:

- `semantic-binding-unresolved` (binding status `unbound`, `v1`, `invalid`);
- `semantic-binding-unverified`;
- `semantic-binding-not-admitted`;
- `semantic-binding-conflict`.

## Native metadata (`native-metadata/v1`, artifact-scoped)

**Carriers**

| Carrier | Form |
|---|---|
| `legacy-hash` | `# --- L9_META ---` … `# --- /L9_META ---` |
| `legacy-hash-bare` | `# L9_META` … `# /L9_META`, ` \| `-delimited pairs allowed |
| `legacy-html` | `<!-- L9_META` … `/L9_META -->` |
| `legacy-docstring` | `"""` / `--- L9_META ---` … `--- /L9_META ---` |
| `frontmatter` | `---` frontmatter naming `l9_schema` |
| `managed-frontmatter` | Frontmatter carrying `artifact_type`, `mcp_primitive` and `sharing_scope` |
| `managed-comment` | `>>> l9:meta >>>` / `l9:meta:start`, at the managed carrier position |

**Predicates**

| Predicate | Object |
|---|---|
| `meta.declaration.carrier` | carrier id |
| `meta.declaration.schema` | `l9_schema:<as written>`, `managed:l9-meta-injector`, or `none` |
| `meta.l9v1.<category>.<field>` | declared value (`l9_schema: 1`) |
| `meta.l9v2.<category>.<field>` | declared value (`l9_schema: 2`) |
| `meta.managed.<category>.<field>` | declared value (managed header) |
| `meta.<ns>.unresolved_field` | key whose value is `Unknown`, empty or null |
| `meta.<ns>.unsupported_field` | key outside the vocabulary or the grammar |
| `meta.unversioned.field` | key under an absent or unknown schema |

Categories are `identity`, `classification`, `governance` and `retrieval`. The
vocabularies are `NATIVE_VOCABULARY` and `MANAGED_VOCABULARY` in
`src/extractors/native_metadata.ts`.

**What these claims are not.** `ssot_for` is not authority, `references` is not
a dependency, `load_when` is not topology, and `owner` is not ownership. Each is
a declaration awaiting governed mapping (Phase 2).

**Diagnostics.** `native_metadata.duplicate_field`, `.malformed`,
`.unterminated`, `.frontmatter_unsupported`, `.unsupported_carrier`,
`.marker_outside_header`, `.competing_declarations`.

## Workflow structure (`workflow-structure/v1`, artifact-scoped, root `.github/workflows/` only)

| Predicate | Object |
|---|---|
| `workflow.job` | job id |
| `workflow.job_needs` | `<job> -> <needed>`, both defined in this file |
| `workflow.job_needs_unresolved` | `<job> -> <needed>`, needed job not defined here |
| `workflow.uses_action` | `owner/repo[/path]@ref` (step) |
| `workflow.uses_reusable_workflow` | `owner/repo/path@ref` (job) |
| `workflow.uses_local` | observed local action `action.yml` or reusable workflow path |
| `workflow.uses_local_unresolved` | local reference as written |
| `workflow.uses_docker` | image reference |

A `needs` edge orders jobs within one workflow. An external action is code
GitHub fetches at run time. Neither is a repository dependency.

## Static imports (`static-imports/v1`, artifact-scoped)

| Predicate | Object |
|---|---|
| `source.import.local` | observed repository path the relative specifier resolves to |
| `source.import.local_unresolved` | specifier as written (no observed target, escapes the root, or an alias) |
| `source.import.absolute` | package or module name, unclassified (stdlib, third-party and first-party read alike) |
| `source.import.builtin` | `node:` specifier |
| `source.import.url` | URL specifier |

Resolution precedence is the importer's own:

- **TypeScript.** ESM `.js` → `.ts` mapping, then `.ts`, `.tsx`, `.d.ts`, `.js`,
  `.jsx`, then the `index` forms.
- **Node CommonJS.** Exact path, then `.js`, `.json`, `.cjs`, then the `index`
  forms.
- **ESM `.mjs`.** Exact path only.
- **Python.** A regular package (`__init__.py`) before a module.

Dynamic imports are counted (`source_import.dynamic_not_interpreted`). A file
that cannot be scanned to its end yields no imports
(`source_import.scan_incomplete`).

## Manifests and contracts

- **Pip requirements.** `manifest/v1` 1.2.0 reads `requirements*.txt` as
  `package.dependency`. These are the only new claims the consumer projects
  (`DEPENDS_ON` to an external package node, ADR-055). Repository-subject claims
  come only from a root-level file (ADR-062). Options, paths and URL-only lines
  are reported (`manifest.requirement_lines_not_interpreted`), never guessed
  into a name.
- **API contracts.** `contract-references/v1` reports literal external `$ref`s
  in OpenAPI, Swagger and AsyncAPI documents:
  - `contract.reference.local` — an observed path;
  - `contract.reference.unresolved` — as written;
  - `contract.reference.remote` — a URL.

  In-document pointers (`#/…`) are not reported.

## Hash scopes

- **An assertion's hash.** `source_content_hash` is the sha256 of the exact
  file bytes the extractor parsed.
- **An artifact's hash.** `content_hash` is inventory's identity. For a file
  carrying a managed or frontmatter carrier it is the carrier-free body hash
  (ADR-051, ADR-065).

The two differ on purpose. A consumer must not use either in place of the other.

## Diagnostics from interpretation

Every interpretation diagnostic reaches the packet:

- stage `meta-injector-interpretation`, category `interpretation`;
- filed against the artifact it concerns when that artifact is emitted;
- `details.source_path` and `details.extractor_id` set.

An extractor may report at most `MAX_EXTRACTOR_DIAGNOSTICS_PER_FILE` (8) per
file; further ones are summarized.
