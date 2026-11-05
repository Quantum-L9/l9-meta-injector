# Native header semantic mapping

The governed meaning of every native `L9_META` header predicate this producer emits. The meanings are not this package's. They are `l9.artifact-header-model/global@1` in the Semantic Foundation (`Quantum-L9/.github` v3.27.0, ADR-024), which `.l9/meta-authority.yaml` binds at revision `b3755ad778eef6d8a465c593d1b5870534ce4ede` and digest `sha256:0f9e3265…6bf1`.

[`src/semantic_mapping.ts`](../src/semantic_mapping.ts) transcribes that ledger. [ADR-084](decisions/084-governed-native-header-semantic-mapping.md) records why.

## Applies to

| Aspect | Rule |
|---|---|
| Carriers | Every carrier `native-metadata/v1` reads: legacy hash, HTML-comment, pipe and docstring blocks, and L9 frontmatter. Carrier syntax is the producer's; meaning does not depend on the carrier. |
| Declared schemas | `l9_schema: 1` (namespace `l9v1`) and `l9_schema: 2` (namespace `l9v2`), both using the native vocabulary. |
| Unrecognized or absent schema | The key is preserved as `meta.unversioned.field`, with no meaning assigned. |
| Managed header (`meta.managed.*`) | This package's own header. It is not governed by the artifact-header ledger and has no entry here. |

## Common to every governed field

| Property | Value |
|---|---|
| Subject | The artifact that carries the header, never the repository. |
| Predicate | `meta.<l9v1\|l9v2>.<category>.<field>` |
| Object normalization | None. The declared value is carried verbatim, and synonyms stay distinct claims (`enrich` ≠ `enrichment`). |
| Evidence class / authority | `declared` / `source`. Parsing a header proves the claim was made, not that it is true. |
| Authority requirements | None to hold the claim. Any projection requires a separate admitted decision naming the relation's owner. |
| Conflict | Single-valued: every claim is preserved and a conflict is raised, with no winner chosen. Set-valued: distinct values aggregate. |
| Unknown | An empty, `Unknown` or `null` value is `meta.<ns>.unresolved_field`. A field outside the vocabulary is `meta.<ns>.unsupported_field`. Both are preserved and neither is given a meaning. |
| Topology projection eligibility | **None** for all thirty fields (ledger `projection_boundary.canonical_relations: none`). |

## Fields

The cardinality column is derived from the ledger's value kind: list kinds are `set`, everything else is `single`.

| Field | Category | Value kind | Cardinality | Meaning (ledger) | Must not become |
|---|---|---|---|---|---|
| `id` | identity | label | single | identifier the file declares for itself | any identity dimension |
| `origin` | identity | label | single | provenance class it declares | L9-PROV-001 provenance |
| `engine` | identity | label | single | engine it declares it belongs to | product, node or deployment identity |
| `namespace` | identity | label | single | namespace it declares | a registered namespace |
| `component` | identity | label | single | component name it declares | an architecture element or port |
| `canonical_path` | identity | path | single | where it declares its authoritative copy lives | a canonical source |
| `version` | identity | label | single | version it declares | a release or compatibility claim |
| `title` | identity | text | single | human title | identity |
| `source_repo` | identity | text | single | repository it declares it came from | provenance |
| `source_file` | identity | text | single | file it declares it came from | provenance |
| `source_adr` | identity | label | single | decision it declares it implements | proof that the decision governs it |
| `layer` | classification | label_list | set | layers it declares (open set) | architecture layering or a dependency rule |
| `tags` | classification | label_list | set | free classification labels | a Foundation classification or capability |
| `artifact_type` | classification | label | single | kind it declares (open set) | an `artifact_model.yaml` kind |
| `status` | classification | label | single | maintenance state: `active`, `deprecated`, `candidate`, `stub` | lifecycle, admission or capability state |
| `ring` | classification | label | single | ring it declares | ordering, trust or authority |
| `category` | classification | label | single | category it declares | a Foundation classification |
| `owner` | governance | label | single | steward label | ActorIdentity, product owner, `owner_ids`, OWNED_BY |
| `ssot_for` | governance | label_list | set | topics it claims to be the source of truth for | a canonical source or GOVERNED_BY |
| `canonical` | governance | label | single | whether it declares itself canonical | canonical status |
| `canonical_source` | governance | url | single | source it declares it copies | registration or provenance |
| `single_source_rule` | governance | text | single | copying instruction | a rule binding on consumers |
| `retrieval` | retrieval | label | single | retrieval mode it declares | consumer loading behavior |
| `load_when` | retrieval | label_list | set | situations it should be loaded in | topology, routing or a dependency |
| `load_condition` | retrieval | text | single | load condition, verbatim | an evaluable rule |
| `references` | retrieval | reference_list | set | artifacts it refers to | DEPENDS_ON |
| `requires` | retrieval | reference_list | set | artifacts to load with it | a dependency or contract obligation |
| `amplifies` | retrieval | reference_list | set | artifacts it strengthens | any relation |
| `retrieval_keys` | retrieval | text | single | search keys, verbatim | an index or capability |
| `token_estimate` | retrieval | count | single | declared size in tokens | a measured size or budget |

## Not mapped

| Requested meaning (Phase 2 pack §4) | Why it has no entry |
|---|---|
| `role` | Not a field of the native vocabulary, and the ledger does not define it. A header that writes it yields `meta.<ns>.unsupported_field: role`. |
| Capability references | No header field is a capability claim. `capabilities.yaml` admits nothing, and the ledger says no field establishes a capability. |
| Ownership resolution to an identity | The ledger forbids it (`header_owner_does_not_resolve_to_actor_identity`). The only bound owner is the repository's own `product.owner` in `.l9/meta-authority.yaml`, carried as repository-scoped declared evidence and never written to `owner_ids`. |

## Integrity

- The mapping's identity (id, version, ledger digest, schemas, policy and fields) is hashed into the interpretation profile hash (profile 1.4.0). Changing any meaning changes every packet's semantic identity.
- `tests/semantic_mapping.test.ts` fails if the mapping cites a different digest from `.l9/meta-authority.yaml`, or if the extractor's vocabulary diverges from the table.
- `npm run semantics:verify -- --semantics-root <Quantum-L9/.github checkout at the bound revision>` also checks that the table transcribes the ledger's field definitions exactly: field set, category, value kind and declared values.
