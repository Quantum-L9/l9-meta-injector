// extractors/native_metadata.ts — native metadata declarations as source claims (ADR-082).
//
// Translates what `parseNativeMetadata` read into assertion drafts about the file
// that declared them. Every claim stays exactly what it was in the source: a
// declaration. Nothing here resolves an owner, admits an `ssot_for` scope as
// authority, turns `references` into dependencies, or turns `load_when` into
// topology — those are Phase 2 mappings that need governed semantics this
// producer does not hold.
//
// Predicate grammar, so a consumer can tell versions apart without parsing text:
//
//   meta.declaration.carrier         <carrier>                       observed
//   meta.declaration.schema          <declared schema>               declared
//   meta.<ns>.<category>.<field>     <value as written>              declared
//   meta.<ns>.unresolved_field       <key>   (Unknown / empty / null) declared
//   meta.<ns>.unsupported_field      <key>   (outside the grammar)    observed
//   meta.unversioned.field           <key>   (schema absent or unknown) declared
//
// `<ns>` is `l9v1`, `l9v2` or `managed`. A field is categorized only under a
// schema this extractor knows; an unknown or absent schema assigns no semantics.
import { AssertionDraft, Extractor } from "../interpretation";
import {
  MANAGED_DECLARED_SCHEMA,
  NativeMetadataDeclaration,
  NativeMetadataField,
  parseNativeMetadata,
} from "../native_metadata";
import {
  HeaderFieldCategory,
  NATIVE_HEADER_FIELDS,
  RECOGNIZED_DECLARED_SCHEMAS,
} from "../semantic_mapping";

type Category = HeaderFieldCategory;

/**
 * Field vocabulary of the native `L9_META` schemas: exactly the fields
 * `l9.artifact-header-model/global@1` defines, read from the governed mapping so
 * there is one table (ADR-084). A field outside it has no meaning here.
 */
const NATIVE_VOCABULARY: Readonly<Record<string, Category>> = Object.fromEntries(
  NATIVE_HEADER_FIELDS.map((mapping) => [mapping.field, mapping.category]),
);

/** Field vocabulary of the managed header this package writes. */
const MANAGED_VOCABULARY: Readonly<Record<string, Category>> = {
  id: "identity",
  title: "identity",
  namespace: "identity",
  source_path: "identity",
  artifact_type: "classification",
  family: "classification",
  mcp_primitive: "classification",
  callable: "classification",
  retrievable: "classification",
  injectable: "classification",
  authority: "governance",
  owner: "governance",
  sharing_scope: "governance",
};

/** Declared schemas with a known field vocabulary, and the predicate namespace each uses. */
const KNOWN_SCHEMAS: Readonly<
  Record<string, { ns: string; vocabulary: Readonly<Record<string, Category>> }>
> = {
  ...Object.fromEntries(
    Object.entries(RECOGNIZED_DECLARED_SCHEMAS).map(([schema, ns]) => [
      schema,
      { ns, vocabulary: NATIVE_VOCABULARY },
    ]),
  ),
  // The managed header is this package's own; its meaning is producer-owned and is
  // not governed by the artifact-header ledger, which defines native L9_META only.
  [MANAGED_DECLARED_SCHEMA]: { ns: "managed", vocabulary: MANAGED_VOCABULARY },
};

/** Extensions and basenames whose files can carry a native header. Path-only. */
const CARRIER_EXTENSIONS: ReadonlySet<string> = new Set([
  ".md",
  ".markdown",
  ".mdx",
  ".py",
  ".pyi",
  ".yaml",
  ".yml",
  ".toml",
  ".sh",
  ".bash",
  ".zsh",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".html",
  ".htm",
  ".xml",
  ".css",
  ".scss",
  ".sql",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".ini",
  ".cfg",
  ".conf",
  // Hash-comment formats the constellation's L9_META headers are observed in
  // (CEG main.tf, env.template, .env.template): measured, not assumed.
  ".tf",
  ".tfvars",
  ".hcl",
  ".template",
  ".example",
  ".dockerfile",
]);
const CARRIER_BASENAMES: ReadonlySet<string> = new Set([
  "makefile",
  "dockerfile",
  "gnumakefile",
  "codeowners",
  ".cursorrules",
  // Hash-comment dotfiles the comment layer already supports (`comment.ts`
  // BASENAME_LINE_COMMENT). Their declarations were read nowhere (ADR-085).
  ".editorconfig",
  ".gitignore",
]);

function carriesHeaders(sourcePath: string): boolean {
  const base = (sourcePath.split("/").pop() ?? sourcePath).toLowerCase();
  if (CARRIER_BASENAMES.has(base)) return true;
  // `Dockerfile.prod`, `Dockerfile.chassis`: a Dockerfile named for its variant.
  if (base.startsWith("dockerfile.")) return true;
  const dot = base.lastIndexOf(".");
  return dot > 0 && CARRIER_EXTENSIONS.has(base.slice(dot));
}

function draft(
  predicate: string,
  object: string,
  start: number,
  end: number,
  excerpt: string,
  evidenceClass: AssertionDraft["evidenceClass"],
  confidence: AssertionDraft["confidence"],
): AssertionDraft {
  return {
    predicate,
    object,
    sourceRange: { start_line: start, end_line: end },
    evidenceExcerpt: excerpt,
    evidenceClass,
    // A header is the file speaking for itself. However well it parses, it is
    // never more than a source claim.
    authority: "source",
    confidence,
  };
}

function fieldDrafts(
  declaration: NativeMetadataDeclaration,
  field: NativeMetadataField,
): AssertionDraft[] {
  const known = KNOWN_SCHEMAS[declaration.declared_schema];
  if (!known) {
    // A schema this reader does not know: the key is preserved, its meaning is not assigned.
    return [
      draft(
        "meta.unversioned.field",
        field.key,
        field.start_line,
        field.end_line,
        field.excerpt,
        "declared",
        "low",
      ),
    ];
  }
  if (field.state === "unsupported") {
    return [
      draft(
        `meta.${known.ns}.unsupported_field`,
        field.key,
        field.start_line,
        field.end_line,
        field.excerpt,
        "observed",
        "high",
      ),
    ];
  }
  if (field.state === "unresolved") {
    return [
      draft(
        `meta.${known.ns}.unresolved_field`,
        field.key,
        field.start_line,
        field.end_line,
        field.excerpt,
        "declared",
        "medium",
      ),
    ];
  }
  const category = known.vocabulary[field.key];
  if (category === undefined) {
    return [
      draft(
        `meta.${known.ns}.unsupported_field`,
        field.key,
        field.start_line,
        field.end_line,
        field.excerpt,
        "observed",
        "high",
      ),
    ];
  }
  // One claim per declared value, each cited at the line that wrote it. The
  // parse is exact; whether the claim is true is not this extractor's to say, so
  // the claim confidence stays medium.
  return field.values.map((value) =>
    draft(
      `meta.${known.ns}.${category}.${field.key}`,
      value.text,
      value.line,
      value.line,
      value.line === field.start_line ? field.excerpt : `${field.key}: ${value.text}`,
      "declared",
      "medium",
    ),
  );
}

export const nativeMetadataExtractor: Extractor = {
  id: "native-metadata/v1",
  // 1.1.0: CODEOWNERS, .cursorrules, Dockerfile.<variant>, Terraform/HCL and
  // template files are header carriers too; before this, their declarations were
  // read nowhere and reported nowhere (PR #127 Phase 2 acceptance run).
  // 1.2.0: the competing-declarations diagnostic follows the governed mapping's
  // cardinality and is scoped by declared schema (ADR-084): set-valued fields
  // aggregate, a single-valued field listing several values competes, and the
  // same key under two schemas does not.
  // 1.3.0: `.editorconfig` and `.gitignore` are header carriers too (ADR-085).
  version: "1.3.0",
  // A header describes the file that carries it, never the repository.
  subjectScope: "artifact",
  matches: carriesHeaders,
  extract(input) {
    const parsed = parseNativeMetadata(input.sourcePath, input.content);
    for (const diagnostic of parsed.diagnostics) {
      input.report?.({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message:
          diagnostic.line !== undefined
            ? `line ${diagnostic.line}: ${diagnostic.message}`
            : diagnostic.message,
      });
    }
    const drafts: AssertionDraft[] = [];
    for (const declaration of parsed.declarations) {
      const { start_line: start, end_line: end } = declaration.source_span;
      drafts.push(
        draft(
          "meta.declaration.carrier",
          declaration.carrier,
          start,
          end,
          declaration.excerpt,
          "observed",
          "high",
        ),
      );
      drafts.push(
        draft(
          "meta.declaration.schema",
          declaration.declared_schema,
          start,
          end,
          declaration.excerpt,
          "declared",
          "high",
        ),
      );
      for (const field of declaration.fields) drafts.push(...fieldDrafts(declaration, field));
    }
    return drafts;
  },
};
