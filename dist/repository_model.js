"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPOSITORY_MODEL_PRODUCER_NAME = exports.REPOSITORY_MODEL_PACKET_VERSION = exports.REPOSITORY_MODEL_PACKET_TYPE = void 0;
exports.buildRepositoryModelPacket = buildRepositoryModelPacket;
exports.validateRepositoryModelPacket = validateRepositoryModelPacket;
exports.emitRepositoryModelBundle = emitRepositoryModelBundle;
exports.observeRepositoryModel = observeRepositoryModel;
// repository_model.ts — Repository Model Packet (`l9.repository-model`) egress.
//
// Converts repository observations that this package already owns (inventory +
// classification evidence) into a deterministic, evidence-preserving packet that the
// l9-constellation-topology Repository Model consumer accepts without translation.
//
// Boundaries this module holds:
//   - No runtime dependency on the topology implementation, Python, or the network.
//     The wire contract is mirrored here from the bound consumer revision.
//   - Machine-specific absolute paths never participate in portable semantic identity.
//   - Capabilities and relationships are emitted only where repository evidence
//     supports them; absence stays absent and is reported as a diagnostic.
//   - Unknowns are preserved as explicit values and diagnostics, never silently
//     upgraded into certainty.
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const crypto = __importStar(require("node:crypto"));
const inventory_1 = require("./inventory");
const repository_interpretation_1 = require("./repository_interpretation");
const schema_1 = require("./schema");
exports.REPOSITORY_MODEL_PACKET_TYPE = "l9.repository-model";
exports.REPOSITORY_MODEL_PACKET_VERSION = "1.0.0";
exports.REPOSITORY_MODEL_PRODUCER_NAME = "l9-meta-injector.repository-model";
/** Profile identity for the observation policy this producer applies. */
const PROFILE_ID = "meta-injector-inventory-observation";
const PROFILE_VERSION = "1.0.0";
const OBSERVATION_STAGE = "meta-injector-inventory";
const RECEIPT_PACKET_TYPE = "l9.validation-receipt";
const RECEIPT_PACKET_VERSION = "1.0.0";
const RECEIPT_RELATIVE_PATH = "receipts/validation-receipt.json";
const PACKET_RELATIVE_PATH = "packet.json";
const MANIFEST_RELATIVE_PATH = "manifest.json";
const MANIFEST_VERSION = "1.0.0";
const JSON_MEDIA_TYPE = "application/json";
const SHA_PREFIX = "sha256:";
/**
 * Default emission timestamp. Mirrors the inventory default so a packet is
 * byte-deterministic unless the caller deliberately supplies a real clock value.
 * Timestamps never participate in semantic identity (the consumer strips them).
 */
const DEFAULT_GENERATED_AT = "1970-01-01T00:00:00.000Z";
const VOLATILE_KEYS = new Set([
    "created_at", "checked_at", "generated_at", "committed_at", "frozen_at",
    "run_id", "stage_id", "trace_id", "workflow_id",
    "artifact_hash", "semantic_hash", "packet_id", "receipt_id",
]);
/** Code-point ordering. Never locale-aware: ordering must not vary by environment. */
function compareCodePoints(a, b) {
    const left = [...a], right = [...b];
    const shared = Math.min(left.length, right.length);
    for (let i = 0; i < shared; i++) {
        const l = left[i].codePointAt(0) ?? 0, r = right[i].codePointAt(0) ?? 0;
        if (l !== r)
            return l < r ? -1 : 1;
    }
    return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}
function canonicalize(value) {
    if (value === null)
        return null;
    if (Array.isArray(value))
        return value.map((item) => canonicalize(item));
    if (typeof value === "object") {
        const source = value;
        const out = {};
        for (const key of Object.keys(source).sort(compareCodePoints)) {
            const item = source[key];
            if (item === undefined)
                continue; // an absent field, not a null one
            out[key] = canonicalize(item);
        }
        return out;
    }
    if (typeof value === "number") {
        // The consumer rejects NaN/Infinity, and float repr differs between runtimes.
        // Keeping the packet integer-only removes that divergence class entirely.
        if (!Number.isFinite(value) || !Number.isInteger(value)) {
            throw new Error(`repository-model: only finite integer numbers are canonical, got ${String(value)}`);
        }
        return value;
    }
    if (typeof value === "string" || typeof value === "boolean")
        return value;
    throw new Error(`repository-model: unsupported canonical value of type ${typeof value}`);
}
/** Render already-canonical data. Written by hand so key order can never be re-sorted by the engine. */
function render(value) {
    if (value === null)
        return "null";
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (typeof value === "number")
        return String(value);
    if (typeof value === "string")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => render(item)).join(",")}]`;
    const keys = Object.keys(value).sort(compareCodePoints);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${render(value[key])}`).join(",")}}`;
}
/** Canonical JSON text for any packet-shaped value. */
function canonicalJson(value) {
    return render(canonicalize(value));
}
function stripVolatile(value) {
    if (Array.isArray(value))
        return value.map((item) => stripVolatile(item));
    if (value !== null && typeof value === "object") {
        const out = {};
        for (const [key, item] of Object.entries(value)) {
            if (VOLATILE_KEYS.has(key))
                continue;
            out[key] = stripVolatile(item);
        }
        return out;
    }
    return value;
}
function sha256Prefixed(content) {
    return SHA_PREFIX + crypto.createHash("sha256").update(content).digest("hex");
}
/** Content identity of exact bytes. */
function artifactHash(content) {
    return sha256Prefixed(content);
}
/** Semantic identity: volatile fields removed, then canonical bytes hashed. */
function semanticHash(value) {
    return sha256Prefixed(Buffer.from(render(stripVolatile(canonicalize(value))), "utf8"));
}
function stableId(prefix, value) {
    return `${prefix}:${semanticHash(value).slice(SHA_PREFIX.length)}`;
}
// ───────────────────────────── confidence ─────────────────────────────
function confidence(level, strength, method, authority, completeness) {
    return {
        level, evidence_strength: strength, derivation_method: method,
        authority, completeness, conflict_status: "none",
    };
}
/**
 * Map an inventory classification score onto the consumer's decomposed confidence.
 * The thresholds are fixed so the same observation always yields the same assessment.
 * A missing content hash caps completeness at `partial` — the observation is real but
 * incomplete, and that must not be rounded up.
 */
function artifactConfidence(score, hashed) {
    const completeness = hashed ? "sufficient" : "partial";
    if (score >= 0.9)
        return confidence("high", "corroborated", "deterministic", "validated-machine", completeness);
    if (score >= 0.5)
        return confidence("medium", "direct", "deterministic", "validated-machine", completeness);
    return confidence("low", "weak", "heuristic", "candidate", "partial");
}
/** Facts derived deterministically from observed repository paths. */
const DERIVED_CONFIDENCE = confidence("medium", "direct", "deterministic", "validated-machine", "sufficient");
/**
 * The repository record aggregates observed artifacts but leaves role, ownership and
 * dependency direction unresolved, so it is deliberately never better than `partial`.
 */
const REPOSITORY_CONFIDENCE = confidence("medium", "direct", "deterministic", "validated-machine", "partial");
// ───────────────────────────── path-evidence derivation ─────────────────────────────
const LANGUAGE_BY_EXTENSION = {
    ".ts": "TypeScript", ".tsx": "TypeScript", ".mts": "TypeScript", ".cts": "TypeScript",
    ".js": "JavaScript", ".jsx": "JavaScript", ".mjs": "JavaScript", ".cjs": "JavaScript",
    ".py": "Python", ".rs": "Rust", ".go": "Go", ".rb": "Ruby", ".java": "Java",
    ".kt": "Kotlin", ".kts": "Kotlin", ".swift": "Swift", ".cs": "C#", ".php": "PHP",
    ".c": "C", ".h": "C", ".cc": "C++", ".cpp": "C++", ".hpp": "C++",
    ".sh": "Shell", ".bash": "Shell", ".sql": "SQL",
};
const PACKAGE_MANAGER_BY_FILENAME = {
    "package.json": "npm", "package-lock.json": "npm", "npm-shrinkwrap.json": "npm",
    "pnpm-lock.yaml": "pnpm", "yarn.lock": "yarn",
    "requirements.txt": "pip", "poetry.lock": "poetry", "uv.lock": "uv", "Pipfile": "pipenv",
    "Cargo.toml": "cargo", "go.mod": "go", "Gemfile": "bundler",
    "pom.xml": "maven", "build.gradle": "gradle", "build.gradle.kts": "gradle",
    "composer.json": "composer",
};
/**
 * Manifests whose filename alone does not determine a package manager. `pyproject.toml` is
 * shared by Poetry, uv, PDM, Hatch and setuptools; the discriminator (`[tool.poetry]`,
 * `build-backend`, `[tool.uv]`) lives in the file body, which inventory observation does not
 * read. These are recorded as an explicit coverage gap rather than resolved to a guess.
 */
const AMBIGUOUS_PACKAGE_MANIFESTS = new Set(["pyproject.toml"]);
const GOVERNANCE_FILENAMES = new Set([
    "CODEOWNERS", "AGENTS.md", "CLAUDE.md", "GOVERNANCE.md", "SECURITY.md",
    "CONTRIBUTING.md", "LICENSE", "INVARIANTS.md", "CODE_OF_CONDUCT.md",
]);
const FAMILY_BY_INVENTORY_TYPE = {
    code: "code", test: "test", prompt: "prompt", archive: "archive",
    schema: "configuration", config: "configuration",
    spec: "documentation", documentation: "documentation",
    research_markdown: "documentation", research_pdf: "documentation",
};
function isWorkflowPath(relativePath) {
    return /^\.github\/workflows\/[^/]+\.(ya?ml)$/.test(relativePath);
}
function isAdrPath(relativePath) {
    if (/^docs\/(decisions|adr|adrs)\//.test(relativePath))
        return relativePath.endsWith(".md");
    return /(^|\/)adr-[^/]*\.md$/.test(relativePath);
}
function sortStrings(values) {
    return [...values].sort(compareCodePoints);
}
// ───────────────────────────── builder ─────────────────────────────
/** Deterministic identity of the observation set, independent of where it was checked out. */
function snapshotSemanticHash(records, sourceRevision) {
    return semanticHash({
        source_revision: sourceRevision,
        observations: records.map((record) => ({
            relative_path: record.relative_path,
            artifact_type: record.artifact_type,
            content_hash: record.content_hash ?? schema_1.UNKNOWN,
            unknowns: sortStrings(record.unknowns),
        })),
    });
}
/** Contract descriptor hash — changes whenever the emitted shape changes. */
const SCHEMA_HASH = semanticHash({
    packet_type: exports.REPOSITORY_MODEL_PACKET_TYPE,
    packet_version: exports.REPOSITORY_MODEL_PACKET_VERSION,
    shell: [
        "packet_type", "packet_version", "packet_id", "subject", "source_snapshot", "validation",
        "producer", "profile", "schema_hash", "semantic_hash", "artifact_hash", "payload_refs", "payload",
    ],
    payload_domains: ["repositories", "artifacts", "capabilities", "relationships", "evidence", "diagnostics"],
});
const OBSERVATION_PROFILE = {
    id: PROFILE_ID,
    version: PROFILE_VERSION,
    evidence_source: "l9-meta-injector.inventory",
    artifact_scope: "files",
    folders_emitted_as_artifacts: false,
    ordering: "code-point",
    capabilities_require_evidence: true,
    relationships_require_evidence: true,
    absolute_paths_in_identity: false,
};
/**
 * Profile hash — binds the policy that produced the packet.
 *
 * Both stages participate: the observation policy, and the interpretation policy when one
 * was applied. Changing how facts are extracted must change the packet's identity even if
 * not one repository byte moved, so a consumer can never confuse two different readings of
 * the same source for the same packet.
 */
function profileHashFor(interpretations) {
    return semanticHash({
        observation: OBSERVATION_PROFILE,
        interpretation: interpretations === undefined ? null : {
            id: interpretations.profile.id,
            version: interpretations.profile.version,
            hash: interpretations.profile.hash,
            extractor_versions: interpretations.profile.extractorVersions,
        },
    });
}
// ───────────────────────────── interpretation mapping ─────────────────────────────
/**
 * Confidence per interpretation fact kind.
 *
 * `declared` facts come from the repository's own manifest or spec, so their authority is
 * `source`. Observed route decorators are deliberately capped: the decorator is real, but
 * whether the route is implemented, mounted, or reachable is not established here, so
 * completeness stays `partial` and the level never reaches `high`.
 */
function interpretationConfidence(fact) {
    if (fact.evidenceClass === "declared") {
        return confidence("high", "direct", "declared", "source", "sufficient");
    }
    return confidence("medium", "direct", "deterministic", "validated-machine", "partial");
}
/** Which record a fact is evidence *about*, and which field of it. */
const EVIDENCE_FIELD_BY_KIND = Object.freeze({
    package_manager: "package_managers",
    package_identity: "package_identity",
    runtime_constraint: "runtime_constraint",
    declared_dependency: "dependencies",
    service_identity: "service_identity",
    declared_action: "name",
    declared_route: "entrypoints",
    implementation_marker: "implementation_marker",
});
/**
 * Facts the v1 consumer contract has no dedicated field for.
 *
 * They are preserved as first-class evidence and reported here, rather than being dropped
 * or smuggled into an unrelated field. Extending the wire schema is out of scope for a
 * repository-only repair.
 */
const FIELDS_WITHOUT_CONTRACT_SLOT = new Set(["package_identity", "runtime_constraint", "service_identity", "implementation_marker"]);
function emptyContribution() {
    return {
        evidence: [], capabilities: [], relationships: [], diagnostics: [],
        packageManagers: [], entrypoints: [], dependenciesByArtifact: new Map(),
        unresolvedDependencies: [], repositoryEvidenceRefs: [], interpretedPackageManagerPaths: new Set(),
    };
}
/** Translate deterministic interpretation facts into the existing v1 payload domains. */
function applyInterpretation(input) {
    const out = emptyContribution();
    const { repositoryId, producerVersion, generatedAt } = input;
    const capabilityByName = new Map();
    const packageManagers = new Set();
    const entrypoints = new Set();
    const unresolved = new Set();
    const missingContractSlot = new Set();
    for (const fact of input.interpretations.facts) {
        const artifactId = input.artifactIdByPath.get(fact.sourceRef.sourcePath);
        if (artifactId === undefined) {
            // The fact's source is not an emitted artifact (omitted, or a directory). A fact
            // with no resolvable subject is reported, never attached to a plausible neighbour.
            out.diagnostics.push({
                code: "interpretation-subject-unresolved",
                severity: "warning",
                message: `an interpretation fact references ${fact.sourceRef.sourcePath}, which is not an emitted artifact; the fact is not attached to this packet's graph`,
                stage: OBSERVATION_STAGE,
                category: "coverage",
                subject_id: repositoryId,
                details: { source_path: fact.sourceRef.sourcePath, extractor_id: fact.extractorId, value: fact.value },
            });
            continue;
        }
        const capabilityId = fact.kind === "declared_action"
            ? stableId("capability", { repository_id: repositoryId, name: fact.value })
            : undefined;
        const subjectId = fact.kind === "declared_action" ? capabilityId
            : fact.kind === "declared_dependency" || fact.kind === "implementation_marker" ? artifactId
                : repositoryId;
        const record = makeEvidence({
            subjectId,
            field: EVIDENCE_FIELD_BY_KIND[fact.kind],
            evidenceClass: fact.evidenceClass,
            sourceRef: {
                source_path: fact.sourceRef.sourcePath,
                source_revision: input.sourceRevision,
                ...(fact.sourceRef.lineNumber !== undefined ? { line_number: fact.sourceRef.lineNumber } : {}),
                ...(fact.sourceRef.contentHash !== undefined ? { content_hash: fact.sourceRef.contentHash } : {}),
            },
            value: { value: fact.value, extractor_id: fact.extractorId, extractor_version: fact.extractorVersion, ...fact.detail },
            confidence: interpretationConfidence(fact),
        }, producerVersion, generatedAt);
        out.evidence.push(record);
        if (subjectId === repositoryId)
            out.repositoryEvidenceRefs.push(record.evidence_id);
        if (FIELDS_WITHOUT_CONTRACT_SLOT.has(fact.kind))
            missingContractSlot.add(fact.kind);
        if (fact.kind === "package_manager") {
            packageManagers.add(fact.value);
            out.interpretedPackageManagerPaths.add(fact.sourceRef.sourcePath);
        }
        if (fact.kind === "declared_dependency") {
            unresolved.add(fact.value);
            const list = out.dependenciesByArtifact.get(artifactId) ?? [];
            if (!list.includes(fact.value))
                list.push(fact.value);
            out.dependenciesByArtifact.set(artifactId, list);
        }
        if (fact.kind === "declared_route") {
            entrypoints.add(fact.value);
            const edgeIdentity = { source_id: repositoryId, target_id: artifactId, edge_type: "ROUTES_TO", route: fact.value };
            out.relationships.push({
                edge_id: stableId("edge", edgeIdentity),
                source_id: repositoryId,
                target_id: artifactId,
                edge_type: "ROUTES_TO",
                direction: "outbound",
                properties: { route: fact.value, ...fact.detail },
                evidence_refs: [record.evidence_id],
                confidence: interpretationConfidence(fact),
            });
        }
        if (fact.kind === "declared_action" && capabilityByName.has(fact.value)) {
            // The same action name declared by two specs is a repository-level ambiguity. One
            // capability record is kept; the second declaration is reported rather than dropped.
            out.diagnostics.push({
                code: "duplicate-declared-action",
                severity: "warning",
                message: `action '${fact.value}' is declared more than once; ${fact.sourceRef.sourcePath} did not create a second capability record`,
                stage: OBSERVATION_STAGE,
                category: "observation",
                subject_id: repositoryId,
                evidence_refs: [record.evidence_id],
                details: { source_path: fact.sourceRef.sourcePath, action: fact.value },
            });
        }
        if (fact.kind === "declared_action" && capabilityId !== undefined && !capabilityByName.has(fact.value)) {
            const capability = {
                capability_id: capabilityId,
                name: fact.value,
                description: fact.detail.description ?? schema_1.UNKNOWN,
                // Which artifact implements, exposes, validates, or governs this action is not
                // established by a declaration. Absent stays absent.
                implemented_by: [],
                exposed_by: [],
                validated_by: [],
                governed_by: [],
                evidence_refs: [record.evidence_id],
                confidence: confidence("high", "direct", "declared", "source", "partial"),
            };
            capabilityByName.set(fact.value, capability);
            out.capabilities.push(capability);
            const edgeIdentity = { source_id: capabilityId, target_id: artifactId, edge_type: "DOCUMENTED_BY" };
            out.relationships.push({
                edge_id: stableId("edge", edgeIdentity),
                source_id: capabilityId,
                target_id: artifactId,
                edge_type: "DOCUMENTED_BY",
                direction: "outbound",
                properties: {},
                evidence_refs: [record.evidence_id],
                confidence: confidence("high", "direct", "declared", "source", "sufficient"),
            });
        }
        if (fact.kind === "implementation_marker") {
            out.diagnostics.push({
                code: "implementation-marker-observed",
                severity: "info",
                message: `${fact.sourceRef.sourcePath} contains a ${fact.value} marker inside the handler for ${fact.detail.route ?? schema_1.UNKNOWN}; the route decorator is observed, its implementation status is not established`,
                stage: OBSERVATION_STAGE,
                category: "observation",
                subject_id: artifactId,
                evidence_refs: [record.evidence_id],
                details: { source_path: fact.sourceRef.sourcePath, marker: fact.value, ...fact.detail },
            });
        }
    }
    for (const diagnostic of input.interpretations.diagnostics) {
        out.diagnostics.push({
            code: `interpretation-${diagnostic.code}`,
            severity: diagnostic.severity,
            message: diagnostic.message,
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: {
                ...(diagnostic.sourcePath !== undefined ? { source_path: diagnostic.sourcePath } : {}),
                ...(diagnostic.extractorId !== undefined ? { extractor_id: diagnostic.extractorId } : {}),
            },
        });
    }
    for (const kind of sortStrings(missingContractSlot)) {
        out.diagnostics.push({
            code: "contract-field-unavailable",
            severity: "info",
            message: `l9.repository-model ${exports.REPOSITORY_MODEL_PACKET_VERSION} has no dedicated field for '${kind}'; it is preserved as evidence rather than mapped into an unrelated field`,
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { field: kind },
        });
    }
    if (out.capabilities.length > 0) {
        out.diagnostics.push({
            code: "unsupported-by-evidence",
            severity: "info",
            message: "declared capabilities carry no implementation, exposure, validation, or governance links; a declaration does not establish which artifact realizes it.",
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { field: "capability_links" },
        });
    }
    if (entrypoints.size > 0) {
        out.diagnostics.push({
            code: "unsupported-by-evidence",
            severity: "info",
            message: "observed route decorators establish that a route is declared at a path and line; they do not establish that the handler is implemented, mounted, reachable, or deployed.",
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { field: "entrypoints" },
        });
    }
    out.packageManagers = sortStrings(packageManagers);
    out.entrypoints = sortStrings(entrypoints);
    out.unresolvedDependencies = sortStrings(unresolved);
    return out;
}
function makeEvidence(draft, producerVersion, generatedAt) {
    // Identity mirrors the consumer's make_evidence_record: confidence and created_at
    // are deliberately excluded so an identical observation keeps an identical id.
    const identity = {
        subject_id: draft.subjectId,
        field: draft.field ?? null,
        stage: OBSERVATION_STAGE,
        evidence_class: draft.evidenceClass,
        source_type: "file",
        source_ref: draft.sourceRef,
        value: draft.value,
        producer: exports.REPOSITORY_MODEL_PRODUCER_NAME,
        producer_version: producerVersion,
    };
    const record = {
        evidence_id: stableId("evidence", identity),
        subject_id: draft.subjectId,
        stage: OBSERVATION_STAGE,
        evidence_class: draft.evidenceClass,
        source_type: "file",
        source_ref: draft.sourceRef,
        value: draft.value,
        confidence: draft.confidence,
        producer: exports.REPOSITORY_MODEL_PRODUCER_NAME,
        producer_version: producerVersion,
        created_at: generatedAt,
    };
    if (draft.field !== undefined)
        record.field = draft.field;
    return record;
}
/**
 * Build a Repository Model Packet from an inventory observation.
 *
 * Every emitted assertion traces back to a real repository observation. Domains with
 * no supporting evidence stay empty and are reported as diagnostics rather than filled
 * with plausible-looking inference.
 */
function buildRepositoryModelPacket(input) {
    const generatedAt = input.generatedAt ?? DEFAULT_GENERATED_AT;
    const producerVersion = input.producerVersion;
    if (!input.repositoryName)
        throw new Error("repository-model: repositoryName is required");
    if (!input.sourceRevision)
        throw new Error("repository-model: sourceRevision is required and is never inferred");
    if (!producerVersion)
        throw new Error("repository-model: producerVersion is required");
    const repositoryId = `repo:${input.repositoryName}`;
    // Folders carry no artifact identity of their own; they are reported as a diagnostic
    // rather than silently dropped.
    const allRecords = [...input.inventory.records].sort((a, b) => compareCodePoints(a.relative_path, b.relative_path));
    const fileRecords = allRecords.filter((record) => record.artifact_type !== "folder");
    const folderCount = allRecords.length - fileRecords.length;
    const snapshotHash = snapshotSemanticHash(fileRecords, input.sourceRevision);
    const packetRef = `urn:l9:meta-injector:${input.repositoryName}:${snapshotHash}`;
    const evidence = [];
    const artifacts = [];
    const relationships = [];
    const diagnostics = [];
    const artifactIdByPath = new Map();
    const artifactById = new Map();
    const languages = new Map(); // language -> first evidencing path
    const packageManagers = new Map();
    const ambiguousManifests = new Map(); // manifest filename -> first evidencing path
    const workflows = [];
    const adrRefs = [];
    const governanceRefs = [];
    let unhashedCount = 0;
    for (const record of fileRecords) {
        const relativePath = record.relative_path;
        const hashed = record.content_hash !== null;
        if (!hashed)
            unhashedCount++;
        const contentHash = hashed ? `${SHA_PREFIX}${record.content_hash}` : schema_1.UNKNOWN;
        const artifactId = stableId("artifact", { repository_id: repositoryId, source_path: relativePath });
        const recordConfidence = artifactConfidence(record.classification_confidence, hashed);
        const observation = makeEvidence({
            subjectId: artifactId,
            field: "artifact_type",
            evidenceClass: "observed",
            sourceRef: {
                source_path: relativePath,
                source_revision: input.sourceRevision,
                ...(hashed ? { content_hash: contentHash } : {}),
            },
            value: {
                artifact_type: record.artifact_type,
                ...(record.evidence_excerpt !== null ? { evidence_excerpt: record.evidence_excerpt } : {}),
            },
            confidence: recordConfidence,
        }, producerVersion, generatedAt);
        evidence.push(observation);
        const artifact = {
            artifact_id: artifactId,
            repository_id: repositoryId,
            source_path: relativePath,
            artifact_type: record.artifact_type,
            content_hash: contentHash,
            capabilities: [],
            dependencies: [],
            evidence_refs: [observation.evidence_id],
            packet_ref: packetRef,
            confidence: recordConfidence,
        };
        const family = FAMILY_BY_INVENTORY_TYPE[record.artifact_type];
        if (family !== undefined)
            artifact.family = family;
        artifacts.push(artifact);
        artifactIdByPath.set(relativePath, artifactId);
        artifactById.set(artifactId, artifact);
        // CONTAINS is the one relationship the inventory directly observed: this repository
        // contains this file. Nothing beyond that is asserted.
        const edgeIdentity = { source_id: repositoryId, target_id: artifactId, edge_type: "CONTAINS" };
        relationships.push({
            edge_id: stableId("edge", edgeIdentity),
            source_id: repositoryId,
            target_id: artifactId,
            edge_type: "CONTAINS",
            direction: "outbound",
            properties: {},
            evidence_refs: [observation.evidence_id],
            confidence: recordConfidence,
        });
        // Preserve every inventory unknown as an explicit diagnostic.
        for (const unknown of sortStrings(record.unknowns)) {
            diagnostics.push({
                code: "inventory-unknown",
                severity: "warning",
                message: `Inventory recorded an unknown for ${relativePath}: ${unknown}`,
                stage: OBSERVATION_STAGE,
                category: "observation",
                subject_id: artifactId,
                evidence_refs: [observation.evidence_id],
                details: { source_path: relativePath, unknown },
            });
        }
        const extension = (record.extension ?? "").toLowerCase();
        const language = LANGUAGE_BY_EXTENSION[extension];
        if (language !== undefined && !languages.has(language))
            languages.set(language, relativePath);
        const manager = PACKAGE_MANAGER_BY_FILENAME[record.file_name];
        if (manager !== undefined && !packageManagers.has(manager))
            packageManagers.set(manager, relativePath);
        if (AMBIGUOUS_PACKAGE_MANIFESTS.has(record.file_name) && !ambiguousManifests.has(record.file_name)) {
            ambiguousManifests.set(record.file_name, relativePath);
        }
        if (isWorkflowPath(relativePath))
            workflows.push(relativePath);
        if (isAdrPath(relativePath))
            adrRefs.push(relativePath);
        if (GOVERNANCE_FILENAMES.has(record.file_name))
            governanceRefs.push(relativePath);
    }
    // Structured interpretation of the same observation, mapped into the existing v1 domains.
    const interpreted = input.interpretations === undefined
        ? emptyContribution()
        : applyInterpretation({
            interpretations: input.interpretations,
            repositoryId,
            sourceRevision: input.sourceRevision,
            producerVersion,
            generatedAt,
            artifactIdByPath,
        });
    for (const [artifactId, dependencies] of interpreted.dependenciesByArtifact) {
        const artifact = artifactById.get(artifactId);
        if (artifact)
            artifact.dependencies = sortStrings(dependencies);
    }
    evidence.push(...interpreted.evidence);
    relationships.push(...interpreted.relationships);
    diagnostics.push(...interpreted.diagnostics);
    // Repository-level facts derived from observed paths, each with its own evidence.
    const repositoryEvidenceRefs = [...interpreted.repositoryEvidenceRefs];
    const addDerived = (field, value, sourcePath) => {
        const record = makeEvidence({
            subjectId: repositoryId,
            field,
            evidenceClass: "derived",
            sourceRef: { source_path: sourcePath, source_revision: input.sourceRevision },
            value,
            confidence: DERIVED_CONFIDENCE,
        }, producerVersion, generatedAt);
        evidence.push(record);
        repositoryEvidenceRefs.push(record.evidence_id);
    };
    for (const language of sortStrings(languages.keys()))
        addDerived("languages", language, languages.get(language));
    for (const manager of sortStrings(packageManagers.keys()))
        addDerived("package_managers", manager, packageManagers.get(manager));
    for (const workflow of sortStrings(workflows))
        addDerived("workflows", workflow, workflow);
    for (const adr of sortStrings(adrRefs))
        addDerived("adr_refs", adr, adr);
    for (const governance of sortStrings(governanceRefs))
        addDerived("governance_refs", governance, governance);
    const artifactIds = artifacts.map((artifact) => artifact.artifact_id);
    const repository = {
        repository_id: repositoryId,
        name: input.repositoryName,
        source_revision: input.sourceRevision,
        packet_ref: packetRef,
        // Role classification is not derivable from inventory evidence alone. `unknown` is
        // the contract's explicit "not established" value, and it stays that way.
        primary_role: "unknown",
        secondary_roles: [],
        languages: sortStrings(languages.keys()),
        package_managers: sortStrings([...packageManagers.keys(), ...interpreted.packageManagers]),
        entrypoints: interpreted.entrypoints,
        workflows: sortStrings(workflows),
        adr_refs: sortStrings(adrRefs),
        governance_refs: sortStrings(governanceRefs),
        capability_ids: sortStrings(interpreted.capabilities.map((item) => item.capability_id)),
        artifact_ids: artifactIds,
        upstream_repository_ids: [],
        downstream_repository_ids: [],
        // Declared manifest dependencies are external distributions. They are real, and they
        // are deliberately not resolved to repositories: cross-repository resolution is the
        // consumer's job, not this producer's guess.
        unresolved_dependencies: interpreted.unresolvedDependencies,
        owner_ids: [],
        evidence_refs: repositoryEvidenceRefs,
        confidence: REPOSITORY_CONFIDENCE,
    };
    // Report — rather than invent — everything the observation could not establish. Each
    // entry is conditional: once interpretation supplies real evidence for a field, claiming
    // it is unavailable would itself be a false statement.
    const unsupported = [
        ["primary_role", "Repository role is not derivable from the available evidence; primary_role stays 'unknown'."],
        ...(interpreted.capabilities.length === 0
            ? [["capabilities", "No capability evidence is available to this producer; capabilities is empty by policy."]]
            : []),
        ...(interpreted.entrypoints.length === 0
            ? [["entrypoints", "No declared entrypoint was observed in a surface this producer interprets."]]
            : []),
        ["owner_ids", "Ownership is not observable from inventory evidence."],
        ...(interpreted.unresolvedDependencies.length === 0
            ? [["dependencies", "No declared manifest dependency was observed in a surface this producer interprets."]]
            : []),
    ];
    for (const [field, message] of unsupported) {
        diagnostics.push({
            code: "unsupported-by-evidence",
            severity: "info",
            message,
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { field },
        });
    }
    // A shared manifest filename is observable; the manager behind it is not — unless the
    // interpretation stage read the file body and established it from a declaration.
    for (const fileName of sortStrings(ambiguousManifests.keys())) {
        const sourcePath = ambiguousManifests.get(fileName);
        if (interpreted.interpretedPackageManagerPaths.has(sourcePath))
            continue;
        diagnostics.push({
            code: "unsupported-by-evidence",
            severity: "info",
            message: `${sourcePath} does not identify a package manager by filename alone; manifest interpretation is required.`,
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { field: "package_managers", source_path: sourcePath },
        });
    }
    if (folderCount > 0) {
        diagnostics.push({
            code: "folders-not-emitted",
            severity: "info",
            message: `${folderCount} observed directories are not emitted as artifacts; only files carry artifact identity.`,
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { directory_count: folderCount },
        });
    }
    if (unhashedCount > 0) {
        diagnostics.push({
            code: "content-hash-unavailable",
            severity: "warning",
            message: `${unhashedCount} observed files have no content hash; their content_hash is the explicit Unknown value.`,
            stage: OBSERVATION_STAGE,
            category: "observation",
            subject_id: repositoryId,
            details: { artifact_count: unhashedCount, placeholder: schema_1.UNKNOWN },
        });
    }
    for (const skipped of sortStrings(input.inventory.skippedDirs)) {
        diagnostics.push({
            code: "directory-unreadable",
            severity: "error",
            message: `A directory could not be read during observation; its subtree is absent from this packet: ${skipped}`,
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { directory: skipped },
        });
    }
    if (input.inventory.omittedPaths.length > 0) {
        diagnostics.push({
            code: "paths-omitted",
            severity: "info",
            message: `${input.inventory.omittedPaths.length} paths were excluded by the omit policy and are absent from this packet.`,
            stage: OBSERVATION_STAGE,
            category: "coverage",
            subject_id: repositoryId,
            details: { omitted_count: input.inventory.omittedPaths.length },
        });
    }
    const payload = {
        repositories: [repository],
        artifacts,
        capabilities: [...interpreted.capabilities].sort((a, b) => compareCodePoints(a.capability_id, b.capability_id)),
        relationships: relationships.sort((a, b) => compareCodePoints(a.edge_id, b.edge_id)),
        evidence: evidence.sort((a, b) => compareCodePoints(a.evidence_id, b.evidence_id)),
        diagnostics: diagnostics.sort((a, b) => compareCodePoints(a.code, b.code)
            || compareCodePoints(a.subject_id ?? "", b.subject_id ?? "")
            || compareCodePoints(a.message, b.message)),
    };
    const shell = {
        packet_type: exports.REPOSITORY_MODEL_PACKET_TYPE,
        packet_version: exports.REPOSITORY_MODEL_PACKET_VERSION,
        subject: { repository_id: repositoryId },
        source_snapshot: { revision: input.sourceRevision, semantic_hash: snapshotHash },
        producer: { name: exports.REPOSITORY_MODEL_PRODUCER_NAME, version: producerVersion },
        profile: { id: PROFILE_ID, version: PROFILE_VERSION, hash: profileHashFor(input.interpretations) },
        schema_hash: SCHEMA_HASH,
        payload_refs: {},
        payload,
    };
    // The consumer's semantic view is exactly these fields; `validation` and the
    // identity/volatile fields are excluded on both sides.
    const packetSemanticHash = semanticHash(shell);
    return {
        ...shell,
        packet_id: `packet:${packetSemanticHash.slice(SHA_PREFIX.length)}`,
        validation: { status: "passed", receipt_ref: RECEIPT_RELATIVE_PATH },
        semantic_hash: packetSemanticHash,
        // Informational content identity of the canonical payload bytes.
        artifact_hash: artifactHash(Buffer.from(canonicalJson(payload), "utf8")),
    };
}
// ───────────────────────────── producer-side validation ─────────────────────────────
function check(checkId, checkClass, rule, ok, message, details = {}) {
    return {
        check_id: checkId, check_class: checkClass, rule,
        status: ok ? "passed" : "failed", message, evidence_refs: [], details,
    };
}
/**
 * Validate a packet against the contract this producer is responsible for, before it
 * ever reaches a consumer. Failures are reported, never repaired silently.
 */
function validateRepositoryModelPacket(packet) {
    const checks = [];
    checks.push(check("packet-type", "schema", "packet_type_is_repository_model", packet.packet_type === exports.REPOSITORY_MODEL_PACKET_TYPE, `packet_type is ${packet.packet_type}`));
    checks.push(check("packet-version", "schema", "packet_version_is_supported", packet.packet_version === exports.REPOSITORY_MODEL_PACKET_VERSION, `packet_version is ${packet.packet_version}`));
    checks.push(check("source-revision", "schema", "source_revision_is_explicit", packet.source_snapshot.revision.length > 0, "source snapshot revision is present"));
    checks.push(check("payload-present", "schema", "payload_is_resolved", packet.payload !== undefined && packet.payload !== null, "payload is inline and resolved"));
    const { payload } = packet;
    const recomputed = semanticHash({
        packet_type: packet.packet_type,
        packet_version: packet.packet_version,
        subject: packet.subject,
        source_snapshot: packet.source_snapshot,
        producer: packet.producer,
        profile: packet.profile,
        schema_hash: packet.schema_hash,
        payload_refs: packet.payload_refs,
        payload,
    });
    checks.push(check("semantic-hash", "invariant", "semantic_hash_is_reproducible", recomputed === packet.semantic_hash, "declared semantic hash matches recomputation", { declared: packet.semantic_hash, calculated: recomputed }));
    checks.push(check("packet-id", "invariant", "packet_id_is_semantically_derived", packet.packet_id === `packet:${packet.semantic_hash.slice(SHA_PREFIX.length)}`, "packet id is derived from the semantic hash"));
    const absolute = payload.artifacts.filter((a) => a.source_path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(a.source_path) || a.source_path.includes("\\"));
    checks.push(check("portable-paths", "invariant", "source_paths_are_repository_relative", absolute.length === 0, "every artifact source path is a portable repository-relative POSIX path", { offending_count: absolute.length }));
    const orderedArtifacts = payload.artifacts.every((a, i) => i === 0 || compareCodePoints(payload.artifacts[i - 1].source_path, a.source_path) < 0);
    checks.push(check("stable-ordering", "invariant", "ordering_is_explicit_and_stable", orderedArtifacts, "artifacts are ordered by repository-relative path"));
    const evidenceIds = new Set(payload.evidence.map((e) => e.evidence_id));
    const danglingEvidence = [];
    const collect = (refs) => {
        for (const ref of refs)
            if (!evidenceIds.has(ref))
                danglingEvidence.push(ref);
    };
    payload.artifacts.forEach((a) => collect(a.evidence_refs));
    payload.repositories.forEach((r) => collect(r.evidence_refs));
    payload.capabilities.forEach((c) => collect(c.evidence_refs));
    payload.relationships.forEach((e) => collect(e.evidence_refs));
    checks.push(check("evidence-resolves", "evidence", "evidence_refs_resolve", danglingEvidence.length === 0, "every evidence reference resolves to an emitted evidence record", { dangling_count: danglingEvidence.length }));
    const preservedUnknowns = payload.artifacts.filter((a) => a.content_hash === schema_1.UNKNOWN).length;
    const declaredUnknowns = payload.diagnostics
        .filter((d) => d.code === "content-hash-unavailable")
        .reduce((total, d) => total + Number(d.details?.artifact_count ?? 0), 0);
    checks.push(check("unknowns-preserved", "evidence", "unknowns_are_explicit", preservedUnknowns === declaredUnknowns, "explicit Unknown content hashes are reported as diagnostics", { unknown_artifacts: preservedUnknowns }));
    const artifactIds = new Set(payload.artifacts.map((a) => a.artifact_id));
    const missingArtifacts = payload.repositories
        .flatMap((r) => r.artifact_ids)
        .filter((id) => !artifactIds.has(id));
    checks.push(check("artifact-cross-reference", "cross-reference", "repository_artifact_ids_resolve", missingArtifacts.length === 0, "every repository artifact reference resolves", { missing_count: missingArtifacts.length }));
    const repositoryIds = new Set(payload.repositories.map((r) => r.repository_id));
    const capabilityIds = new Set(payload.capabilities.map((c) => c.capability_id));
    const resolves = (id) => repositoryIds.has(id) || artifactIds.has(id) || capabilityIds.has(id);
    const danglingEdges = payload.relationships.filter((edge) => !resolves(edge.source_id) || !resolves(edge.target_id));
    checks.push(check("edge-cross-reference", "cross-reference", "relationship_endpoints_resolve", danglingEdges.length === 0, "every relationship endpoint resolves to an emitted record", { dangling_count: danglingEdges.length }));
    const missingCapabilities = payload.repositories
        .flatMap((r) => r.capability_ids)
        .filter((id) => !capabilityIds.has(id));
    checks.push(check("capability-cross-reference", "cross-reference", "repository_capability_ids_resolve", missingCapabilities.length === 0, "every repository capability reference resolves", { missing_count: missingCapabilities.length }));
    // No assertion without evidence. A capability or relationship the packet states but
    // cannot trace back to an evidence record would be exactly the kind of plausible,
    // unfalsifiable claim this producer exists to avoid.
    const unevidenced = [
        ...payload.capabilities.filter((c) => c.evidence_refs.length === 0).map((c) => c.capability_id),
        ...payload.relationships.filter((e) => e.evidence_refs.length === 0).map((e) => e.edge_id),
    ];
    checks.push(check("assertions-are-evidenced", "evidence", "every_assertion_cites_evidence", unevidenced.length === 0, "every capability and relationship cites at least one evidence record", { unevidenced_count: unevidenced.length }));
    const failed = checks.filter((c) => c.status !== "passed");
    return { status: failed.length === 0 ? "passed" : "failed", checks };
}
function buildReceipt(packet, result, producerVersion, generatedAt) {
    const byClass = (checkClass) => result.checks.filter((c) => c.check_class === checkClass);
    const view = {
        packet_type: RECEIPT_PACKET_TYPE,
        packet_version: RECEIPT_PACKET_VERSION,
        subject_packet_id: packet.packet_id,
        subject_semantic_hash: packet.semantic_hash,
        validator: { name: exports.REPOSITORY_MODEL_PRODUCER_NAME, version: producerVersion },
        status: result.status,
        schema_results: byClass("schema"),
        invariant_results: byClass("invariant"),
        evidence_results: byClass("evidence"),
        cross_reference_results: byClass("cross-reference"),
    };
    const digest = semanticHash(view);
    return {
        ...view,
        receipt_id: `receipt:${digest.slice(SHA_PREFIX.length)}`,
        created_at: generatedAt,
        semantic_hash: digest,
    };
}
// ───────────────────────────── emitter ─────────────────────────────
function writeCanonicalFile(absolutePath, value) {
    // The consumer reads canonical JSON with a single trailing newline.
    const content = Buffer.from(`${canonicalJson(value)}\n`, "utf8");
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, content);
    return { content_hash: artifactHash(content), size_bytes: content.length };
}
/**
 * Write a validated packet as a canonical packet-bundle directory:
 * `packet.json`, `receipts/validation-receipt.json`, and a hash-bound `manifest.json`.
 * Refuses to emit a packet that fails producer-side validation.
 */
function emitRepositoryModelBundle(packet, options) {
    const generatedAt = options.generatedAt ?? DEFAULT_GENERATED_AT;
    const producerVersion = options.producerVersion ?? packet.producer.version;
    const result = validateRepositoryModelPacket(packet);
    if (result.status !== "passed") {
        const failures = result.checks.filter((c) => c.status !== "passed").map((c) => `${c.check_id}: ${c.message}`);
        throw new Error(`repository-model: refusing to emit a packet that failed producer validation:\n  - ${failures.join("\n  - ")}`);
    }
    const bundleRoot = path.resolve(options.outDir);
    if (fs.existsSync(bundleRoot) && fs.readdirSync(bundleRoot).length > 0) {
        throw new Error(`repository-model: packet bundles are immutable; refusing to write into a non-empty directory: ${bundleRoot}`);
    }
    fs.mkdirSync(bundleRoot, { recursive: true });
    const receipt = buildReceipt(packet, result, producerVersion, generatedAt);
    const packetPath = path.join(bundleRoot, PACKET_RELATIVE_PATH);
    const receiptPath = path.join(bundleRoot, RECEIPT_RELATIVE_PATH);
    const packetFile = writeCanonicalFile(packetPath, packet);
    const receiptFile = writeCanonicalFile(receiptPath, receipt);
    const files = [
        { path: PACKET_RELATIVE_PATH, media_type: JSON_MEDIA_TYPE, ...packetFile },
        { path: RECEIPT_RELATIVE_PATH, media_type: JSON_MEDIA_TYPE, ...receiptFile },
    ].sort((a, b) => compareCodePoints(a.path, b.path));
    const manifestPath = path.join(bundleRoot, MANIFEST_RELATIVE_PATH);
    writeCanonicalFile(manifestPath, {
        manifest_version: MANIFEST_VERSION,
        packet_id: packet.packet_id,
        packet_type: packet.packet_type,
        packet_version: packet.packet_version,
        semantic_hash: packet.semantic_hash,
        // The consumer recomputes this over the file entries alone.
        artifact_hash: semanticHash(files),
        files,
        created_at: generatedAt,
    });
    return {
        bundleRoot,
        packetPath,
        receiptPath,
        manifestPath,
        packetId: packet.packet_id,
        semanticHash: packet.semantic_hash,
        files,
    };
}
// ───────────────────────────── observation entrypoint ─────────────────────────────
/**
 * Observe a repository with the existing inventory engine and build its Repository
 * Model Packet. The observation is read-only: inventory runs in dry-run mode and its
 * own manifests are written to a temporary directory that is removed afterwards, so
 * the observed repository is never mutated.
 */
function observeRepositoryModel(input) {
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "l9-repository-model-"));
    try {
        const inventory = (0, inventory_1.inventoryTree)({
            root: input.root,
            outDir: path.join(scratch, "inventory"),
            dryRun: true,
            injectHeaders: false,
            writeSidecars: false,
            folderSidecars: false,
            sourceSystem: "local",
            now: input.generatedAt ?? DEFAULT_GENERATED_AT,
            ...(input.ignore !== undefined ? { ignore: input.ignore } : {}),
            ...(input.omitPatterns !== undefined ? { omitPatterns: input.omitPatterns } : {}),
            ...(input.omitFile !== undefined ? { omitFile: input.omitFile } : {}),
            ...(input.hashMaxBytes !== undefined ? { hashMaxBytes: input.hashMaxBytes } : {}),
        });
        // The interpretation stage reads a bounded set of structured surfaces from the same
        // observation. It is read-only, like the inventory pass that produced `inventory`.
        const interpretations = input.interpret === false ? undefined : (0, repository_interpretation_1.interpretRepository)({
            root: input.root,
            records: inventory.records,
            sourceRevision: input.sourceRevision,
        });
        return buildRepositoryModelPacket({
            inventory,
            ...(interpretations !== undefined ? { interpretations } : {}),
            repositoryName: input.repositoryName,
            sourceRevision: input.sourceRevision,
            producerVersion: input.producerVersion,
            ...(input.generatedAt !== undefined ? { generatedAt: input.generatedAt } : {}),
        });
    }
    finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
}
//# sourceMappingURL=repository_model.js.map