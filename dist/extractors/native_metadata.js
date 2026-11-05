"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeMetadataExtractor = void 0;
const native_metadata_1 = require("../native_metadata");
/** Field vocabulary of the native `L9_META` schemas, as observed in constellation repositories. */
const NATIVE_VOCABULARY = {
    id: "identity", origin: "identity", engine: "identity", namespace: "identity",
    component: "identity", canonical_path: "identity", version: "identity", title: "identity",
    source_repo: "identity", source_file: "identity", source_adr: "identity",
    layer: "classification", tags: "classification", artifact_type: "classification",
    status: "classification", ring: "classification", category: "classification",
    owner: "governance", ssot_for: "governance", canonical: "governance",
    canonical_source: "governance", single_source_rule: "governance",
    retrieval: "retrieval", load_when: "retrieval", load_condition: "retrieval",
    references: "retrieval", requires: "retrieval", amplifies: "retrieval",
    retrieval_keys: "retrieval", token_estimate: "retrieval",
};
/** Field vocabulary of the managed header this package writes. */
const MANAGED_VOCABULARY = {
    id: "identity", title: "identity", namespace: "identity", source_path: "identity",
    artifact_type: "classification", family: "classification", mcp_primitive: "classification",
    callable: "classification", retrievable: "classification", injectable: "classification",
    authority: "governance", owner: "governance", sharing_scope: "governance",
};
/** Declared schemas with a known field vocabulary, and the predicate namespace each uses. */
const KNOWN_SCHEMAS = {
    "l9_schema:1": { ns: "l9v1", vocabulary: NATIVE_VOCABULARY },
    "l9_schema:2": { ns: "l9v2", vocabulary: NATIVE_VOCABULARY },
    [native_metadata_1.MANAGED_DECLARED_SCHEMA]: { ns: "managed", vocabulary: MANAGED_VOCABULARY },
};
/** Extensions and basenames whose files can carry a native header. Path-only. */
const CARRIER_EXTENSIONS = new Set([
    ".md", ".markdown", ".mdx", ".py", ".pyi", ".yaml", ".yml", ".toml", ".sh", ".bash", ".zsh",
    ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".html", ".htm", ".xml",
    ".css", ".scss", ".sql", ".rb", ".go", ".rs", ".java", ".ini", ".cfg", ".conf",
    // Hash-comment formats the constellation's L9_META headers are observed in
    // (CEG main.tf, env.template, .env.template): measured, not assumed.
    ".tf", ".tfvars", ".hcl", ".template", ".example", ".dockerfile",
]);
const CARRIER_BASENAMES = new Set([
    "makefile", "dockerfile", "gnumakefile", "codeowners", ".cursorrules",
]);
function carriesHeaders(sourcePath) {
    const base = (sourcePath.split("/").pop() ?? sourcePath).toLowerCase();
    if (CARRIER_BASENAMES.has(base))
        return true;
    // `Dockerfile.prod`, `Dockerfile.chassis`: a Dockerfile named for its variant.
    if (base.startsWith("dockerfile."))
        return true;
    const dot = base.lastIndexOf(".");
    return dot > 0 && CARRIER_EXTENSIONS.has(base.slice(dot));
}
function draft(predicate, object, start, end, excerpt, evidenceClass, confidence) {
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
function fieldDrafts(declaration, field) {
    const known = KNOWN_SCHEMAS[declaration.declared_schema];
    if (!known) {
        // A schema this reader does not know: the key is preserved, its meaning is not assigned.
        return [draft("meta.unversioned.field", field.key, field.start_line, field.end_line, field.excerpt, "declared", "low")];
    }
    if (field.state === "unsupported") {
        return [draft(`meta.${known.ns}.unsupported_field`, field.key, field.start_line, field.end_line, field.excerpt, "observed", "high")];
    }
    if (field.state === "unresolved") {
        return [draft(`meta.${known.ns}.unresolved_field`, field.key, field.start_line, field.end_line, field.excerpt, "declared", "medium")];
    }
    const category = known.vocabulary[field.key];
    if (category === undefined) {
        return [draft(`meta.${known.ns}.unsupported_field`, field.key, field.start_line, field.end_line, field.excerpt, "observed", "high")];
    }
    // One claim per declared value, each cited at the line that wrote it. The
    // parse is exact; whether the claim is true is not this extractor's to say, so
    // the claim confidence stays medium.
    return field.values.map((value) => draft(`meta.${known.ns}.${category}.${field.key}`, value.text, value.line, value.line, value.line === field.start_line ? field.excerpt : `${field.key}: ${value.text}`, "declared", "medium"));
}
exports.nativeMetadataExtractor = {
    id: "native-metadata/v1",
    // 1.1.0: CODEOWNERS, .cursorrules, Dockerfile.<variant>, Terraform/HCL and
    // template files are header carriers too; before this, their declarations were
    // read nowhere and reported nowhere (PR #127 Phase 2 acceptance run).
    version: "1.1.0",
    // A header describes the file that carries it, never the repository.
    subjectScope: "artifact",
    matches: carriesHeaders,
    extract(input) {
        const parsed = (0, native_metadata_1.parseNativeMetadata)(input.sourcePath, input.content);
        for (const diagnostic of parsed.diagnostics) {
            input.report?.({
                code: diagnostic.code,
                severity: diagnostic.severity,
                message: diagnostic.line !== undefined ? `line ${diagnostic.line}: ${diagnostic.message}` : diagnostic.message,
            });
        }
        const drafts = [];
        for (const declaration of parsed.declarations) {
            const { start_line: start, end_line: end } = declaration.source_span;
            drafts.push(draft("meta.declaration.carrier", declaration.carrier, start, end, declaration.excerpt, "observed", "high"));
            drafts.push(draft("meta.declaration.schema", declaration.declared_schema, start, end, declaration.excerpt, "declared", "high"));
            for (const field of declaration.fields)
                drafts.push(...fieldDrafts(declaration, field));
        }
        return drafts;
    },
};
//# sourceMappingURL=native_metadata.js.map