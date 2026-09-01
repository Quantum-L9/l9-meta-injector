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
exports.CanonicalFloat = exports.REPOSITORY_MODEL_PRODUCER_NAME = exports.REPOSITORY_MODEL_PACKET_VERSION = exports.REPOSITORY_MODEL_PACKET_TYPE = exports.compareCodePoints = void 0;
exports.canonicalFloat = canonicalFloat;
exports.canonicalJson = canonicalJson;
exports.sha256TextPrefixed = sha256TextPrefixed;
exports.semanticHash = semanticHash;
exports.stableId = stableId;
exports.repositoryModelArtifactId = repositoryModelArtifactId;
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
const ordering_1 = require("./ordering");
const interpretation_1 = require("./interpretation");
const extractors_1 = require("./extractors");
const schema_1 = require("./schema");
/** Re-exported so packet consumers keep one ordering import site. */
var ordering_2 = require("./ordering");
Object.defineProperty(exports, "compareCodePoints", { enumerable: true, get: function () { return ordering_2.compareCodePoints; } });
exports.REPOSITORY_MODEL_PACKET_TYPE = "l9.repository-model";
exports.REPOSITORY_MODEL_PACKET_VERSION = "1.1.0";
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
// ───────────────────────────── canonical form ─────────────────────────────
// Mirrors the bound consumer's canonical_data / canonical_json / semantic_hash rules:
// object keys sorted by code point, no separator whitespace, absent fields omitted,
// and a fixed set of volatile keys removed before hashing.
/**
 * A number the contract calls a measurement rather than a count.
 *
 * This runtime has one numeric type; CPython has two, and renders them
 * differently — a score of exactly `1` is `1` here and `1.0` there. Nothing
 * about the value says which it is, so the distinction is carried explicitly
 * rather than guessed from whether the value happens to be integral. Guessing
 * would be right for `0.85` and wrong for `1`, and `1` is the value a
 * categorical signal carries when it fires.
 */
class CanonicalFloat {
    constructor(value) {
        this.value = value;
        if (!Number.isFinite(value)) {
            throw new Error(`repository-model: a float measurement must be finite, got ${String(value)}`);
        }
    }
}
exports.CanonicalFloat = CanonicalFloat;
/** Mark a number as a float measurement. */
function canonicalFloat(value) {
    return new CanonicalFloat(value);
}
const VOLATILE_KEYS = new Set([
    "created_at", "checked_at", "generated_at", "committed_at", "frozen_at",
    "run_id", "stage_id", "trace_id", "workflow_id",
    "artifact_hash", "semantic_hash", "packet_id", "receipt_id",
]);
function canonicalize(value) {
    if (value === null)
        return null;
    // Ahead of the object branch: a marker is an instance, and destructuring one
    // key by key would canonicalize it as `{"value":0.85}`.
    if (value instanceof CanonicalFloat)
        return value;
    if (Array.isArray(value))
        return value.map((item) => canonicalize(item));
    if (typeof value === "object") {
        const source = value;
        const out = {};
        for (const key of Object.keys(source).sort(ordering_1.compareCodePoints)) {
            const item = source[key];
            // Absent and null are one thing here, because they are one thing on the
            // other side: the consumer canonicalizes through `model_dump(mode="json",
            // exclude_none=True)`, so a field it holds as `None` is not in the
            // document it hashes. Emitting `"root_packet_id":null` where the consumer
            // emits nothing is a different string, a different digest, and a bundle
            // rejected after every one of its byte-level hashes has verified.
            //
            // Safe because every nullable field in the consumer's models defaults to
            // `None`: an omitted field parses back to exactly the value that was
            // dropped. A nullable field without that default would already make the
            // consumer unable to read its own bundles.
            if (item === undefined || item === null)
                continue;
            out[key] = canonicalize(item);
        }
        return out;
    }
    if (typeof value === "number") {
        // NaN and Infinity have no JSON form and the consumer rejects both
        // (`json.dumps(..., allow_nan=False)`). Finite floats are canonical, and
        // `renderNumber` below is what makes them safe to cross the boundary.
        if (!Number.isFinite(value)) {
            throw new Error(`repository-model: only finite numbers are canonical, got ${String(value)}`);
        }
        return value;
    }
    if (typeof value === "string" || typeof value === "boolean")
        return value;
    throw new Error(`repository-model: unsupported canonical value of type ${typeof value}`);
}
/**
 * Serialize a number exactly as the consumer's `json.dumps` would.
 *
 * The packet was integer-only, and that was not conservatism: a float's decimal
 * *formatting* differs between this runtime and CPython even when the value and
 * its shortest round-trip digits are identical. `1.0` renders as `1` here and
 * `1.0` there; `1e-7` renders as `1e-7` here and `1e-07` there. Two sides that
 * hash the same packet then compute different digests, and the consumer rejects
 * a bundle whose bytes it has already verified.
 *
 * Integer-only avoided that by making the divergence unreachable. It also made
 * the Corpus Intelligence packet unemittable, because its pair scores are
 * measurements in [0,1] — and the value a categorical signal carries when it
 * fires is exactly `1`, the worst case above.
 *
 * So the formatting is reproduced instead of avoided. CPython's `repr` (which
 * `json.dumps` uses) is: shortest digits that round-trip — which this runtime
 * already agrees on — laid out in decimal when the decimal exponent is in
 * `(-4, 16]` and in exponential form otherwise, with `.0` appended to anything
 * that would otherwise read as an integer and an exponent padded to two digits.
 * The thresholds are CPython's, not this runtime's, which is the whole point:
 * this runtime switches to exponential at different magnitudes.
 *
 * Integers are untouched, so no packet that predates this renders differently.
 * `tests/canonical_float_parity.test.ts` checks the agreement differentially
 * against a real `json.dumps`, over the boundaries and a large random sample,
 * rather than trusting this description of the rules.
 */
function renderNumber(value) {
    // A plain number is a count. CPython would hold it as an `int`, which prints
    // its exact digits at every magnitude — unlike this runtime, which switches to
    // exponential notation past 1e21. `BigInt` gives those digits directly.
    if (Number.isInteger(value) && !Object.is(value, -0))
        return BigInt(value).toString();
    return renderFloat(value);
}
/**
 * Render a float exactly as CPython's `json.dumps` would.
 *
 * CPython's shortest-repr layout: decimal notation when the decimal exponent is
 * in `(-4, 16]` and exponential otherwise, `.0` appended to anything that would
 * otherwise read as an integer, and an exponent padded to two digits. The
 * thresholds are CPython's, not this runtime's — this runtime stays decimal from
 * 1e-6 to 1e21, which is a wider window, and every value in the gap between the
 * two windows is a divergence.
 *
 * The digits themselves need no translation: both runtimes emit the shortest
 * decimal that round-trips the double, and agree on it.
 */
function renderFloat(value) {
    const negative = value < 0 || Object.is(value, -0);
    const magnitude = Math.abs(value);
    if (magnitude === 0)
        return negative ? "-0.0" : "0.0";
    // `toExponential()` with no argument yields the shortest digits that uniquely
    // identify the double.
    const [mantissa, exponentText] = magnitude.toExponential().split("e");
    const digits = mantissa.replace(".", "");
    // `decpt` positions the decimal point: value = 0.<digits> x 10^decpt.
    const decpt = Number(exponentText) + 1;
    let rendered;
    if (decpt <= -4 || decpt > 16) {
        const exponent = decpt - 1;
        const sign = exponent < 0 ? "-" : "+";
        const padded = String(Math.abs(exponent)).padStart(2, "0");
        const fraction = digits.length > 1 ? `.${digits.slice(1)}` : "";
        rendered = `${digits[0]}${fraction}e${sign}${padded}`;
    }
    else if (decpt <= 0) {
        rendered = `0.${"0".repeat(-decpt)}${digits}`;
    }
    else if (decpt >= digits.length) {
        // Would read as an integer, so CPython appends `.0` to keep it a float.
        rendered = `${digits}${"0".repeat(decpt - digits.length)}.0`;
    }
    else {
        rendered = `${digits.slice(0, decpt)}.${digits.slice(decpt)}`;
    }
    return negative ? `-${rendered}` : rendered;
}
/** Render already-canonical data. Written by hand so key order can never be re-sorted by the engine. */
function render(value) {
    if (value === null)
        return "null";
    if (typeof value === "boolean")
        return value ? "true" : "false";
    if (value instanceof CanonicalFloat)
        return renderFloat(value.value);
    if (typeof value === "number")
        return renderNumber(value);
    if (typeof value === "string")
        return JSON.stringify(value);
    if (Array.isArray(value))
        return `[${value.map((item) => render(item)).join(",")}]`;
    const keys = Object.keys(value).sort(ordering_1.compareCodePoints);
    return `{${keys.map((key) => `${JSON.stringify(key)}:${render(value[key])}`).join(",")}}`;
}
/** Canonical JSON text for any packet-shaped value. */
function canonicalJson(value) {
    return render(canonicalize(value));
}
function stripVolatile(value) {
    if (value instanceof CanonicalFloat)
        return value;
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
/** Content identity of exact text, used by interpretation evidence. */
function sha256TextPrefixed(value) {
    return sha256Prefixed(Buffer.from(value, "utf8"));
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
/**
 * Stable identity of one artifact inside a repository.
 *
 * Interpretation needs this to point an assertion at the exact file that made a
 * declaration, and the packet builder needs it to emit that file's artifact
 * record. Two implementations of the same formula would eventually disagree and
 * strand every artifact-scoped assertion, so both call this one.
 *
 * `sourcePath` is the repository-relative POSIX path, or a virtual archive
 * member locator such as `Bundle.zip!/docs/a.md`. Absolute paths never
 * participate.
 */
function repositoryModelArtifactId(repositoryId, sourcePath) {
    return stableId("artifact", { repository_id: repositoryId, source_path: sourcePath });
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
    return [...values].sort(ordering_1.compareCodePoints);
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
    payload_domains: [
        "repositories", "artifacts", "capabilities", "relationships", "evidence", "diagnostics",
        // 1.1.0 adds semantic assertions as a first-class domain.
        "assertions",
    ],
});
/** Profile hash — binds the observation policy that produced the packet. */
const PROFILE_HASH = semanticHash({
    id: PROFILE_ID,
    version: PROFILE_VERSION,
    evidence_source: "l9-meta-injector.inventory",
    artifact_scope: "files",
    folders_emitted_as_artifacts: false,
    ordering: "code-point",
    capabilities_require_evidence: true,
    relationships_require_evidence: true,
    absolute_paths_in_identity: false,
});
/**
 * Identity of the local-source observation policy.
 *
 * A local filesystem source is observed under different rules than a Git
 * checkout: archives are staged rather than extracted beside the source,
 * symlinks are recorded but never followed, and a resource budget bounds what an
 * archive may expand into. Those rules belong in packet identity, so a
 * local-source packet declares its own profile instead of borrowing the
 * repository-inventory one. Repository packets keep the identity they had.
 */
const LOCAL_SOURCE_PROFILE_ID = "meta-injector-local-source-observation";
const LOCAL_SOURCE_PROFILE_VERSION = "1.0.0";
function localSourceProfile(input) {
    return {
        id: LOCAL_SOURCE_PROFILE_ID,
        version: LOCAL_SOURCE_PROFILE_VERSION,
        hash: semanticHash({
            id: LOCAL_SOURCE_PROFILE_ID,
            version: LOCAL_SOURCE_PROFILE_VERSION,
            evidence_source: "l9-meta-injector.local-source",
            source_kind: input.sourceKind,
            archive_formats_expanded: ["zip"],
            archive_policy_version: input.archivePolicyVersion,
            archive_members_are_virtual_artifacts: true,
            archive_expansion_mutates_source: false,
            symlinks_followed: false,
            ordering: "code-point",
            absolute_paths_in_identity: false,
            scratch_paths_in_identity: false,
        }),
    };
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
    const allRecords = [...input.inventory.records].sort((a, b) => (0, ordering_1.compareCodePoints)(a.relative_path, b.relative_path));
    const fileRecords = allRecords.filter((record) => record.artifact_type !== "folder");
    const folderCount = allRecords.length - fileRecords.length;
    const snapshotHash = snapshotSemanticHash(fileRecords, input.sourceRevision);
    const packetRef = `urn:l9:meta-injector:${input.repositoryName}:${snapshotHash}`;
    const evidence = [];
    const artifacts = [];
    const relationships = [];
    const diagnostics = [];
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
        const artifactId = repositoryModelArtifactId(repositoryId, relativePath);
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
    // Archive provenance. Members already exist as artifacts because acquisition
    // reported them as inventory records; what is added here is the ancestry that
    // binds each member to the archive it came from, and each nested archive to the
    // archive that contained it, all the way back to a physical source file.
    const emittedArtifactIds = new Set(artifacts.map((artifact) => artifact.artifact_id));
    const artifactIdFor = (sourcePath) => repositoryModelArtifactId(repositoryId, sourcePath);
    if (input.localSource) {
        const local = input.localSource;
        // A local source is not a Git checkout, and nothing here should be read as a
        // claim that one exists. The observation states what it observed.
        diagnostics.push({
            code: "local-source-observation",
            severity: "info",
            message: `This packet describes a local ${local.sourceKind} source observed read-only; ` +
                "no Git repository is claimed and the source revision uses a local-source scheme.",
            stage: OBSERVATION_STAGE,
            category: "observation",
            subject_id: repositoryId,
            details: {
                source_kind: local.sourceKind,
                source_revision: input.sourceRevision,
                archive_policy_version: local.archivePolicyVersion,
                archives_observed: local.archives.length,
                archive_members_observed: local.members.length,
            },
        });
        for (const archive of [...local.archives].sort((a, b) => (0, ordering_1.compareCodePoints)(a.sourcePath, b.sourcePath))) {
            if (archive.expanded)
                continue;
            // A held archive is still an observation: its bytes were hashed, its members
            // were not claimed, and the reason is explicit rather than an absence.
            diagnostics.push({
                code: "archive-held",
                severity: "warning",
                message: `Archive ${archive.sourcePath} was observed and hashed but not expanded; ` +
                    "none of its members are claimed as observed.",
                stage: OBSERVATION_STAGE,
                category: "observation",
                subject_id: emittedArtifactIds.has(artifactIdFor(archive.sourcePath))
                    ? artifactIdFor(archive.sourcePath)
                    : repositoryId,
                details: {
                    source_path: archive.sourcePath,
                    archive_digest: archive.contentHash,
                    nested_depth: archive.nestedDepth,
                    hold_codes: sortStrings(archive.holdCodes),
                },
            });
        }
        const orderedMembers = [...local.members].sort((a, b) => (0, ordering_1.compareCodePoints)(a.virtualSourcePath, b.virtualSourcePath));
        for (const member of orderedMembers) {
            const memberArtifactId = artifactIdFor(member.virtualSourcePath);
            const archiveArtifactId = artifactIdFor(member.parentArchivePath);
            if (!emittedArtifactIds.has(memberArtifactId) || !emittedArtifactIds.has(archiveArtifactId)) {
                // An edge whose endpoints are not both emitted would not resolve, so the
                // gap is reported instead of asserted.
                diagnostics.push({
                    code: "archive-provenance-unresolved",
                    severity: "warning",
                    message: `Archive member ${member.virtualSourcePath} could not be linked to ` +
                        `${member.parentArchivePath}; one endpoint is not an emitted artifact.`,
                    stage: OBSERVATION_STAGE,
                    category: "coverage",
                    subject_id: repositoryId,
                    details: { member_path: member.virtualSourcePath, archive_path: member.parentArchivePath },
                });
                continue;
            }
            // Member identity is the triple the contract requires: which archive, which
            // path inside it, and which exact bytes. It deliberately excludes anything
            // about where the member was staged.
            const memberId = stableId("member", {
                parent_archive_hash: member.parentArchiveHash,
                member_path: member.memberPath,
                member_content_hash: member.contentHash,
            });
            const provenance = makeEvidence({
                subjectId: memberArtifactId,
                field: "derived_from",
                evidenceClass: "observed",
                sourceRef: {
                    source_path: member.virtualSourcePath,
                    source_revision: input.sourceRevision,
                    content_hash: member.contentHash,
                },
                value: {
                    member_id: memberId,
                    member_path: member.memberPath,
                    nested_depth: member.nestedDepth,
                    archive_digest: member.parentArchiveHash,
                    archive_source_path: member.parentArchivePath,
                },
                confidence: DERIVED_CONFIDENCE,
            }, producerVersion, generatedAt);
            evidence.push(provenance);
            const derivedIdentity = {
                source_id: memberArtifactId,
                target_id: archiveArtifactId,
                edge_type: "DERIVED_FROM",
            };
            relationships.push({
                edge_id: stableId("edge", derivedIdentity),
                source_id: memberArtifactId,
                target_id: archiveArtifactId,
                edge_type: "DERIVED_FROM",
                direction: "outbound",
                properties: {
                    member_id: memberId,
                    member_path: member.memberPath,
                    nested_depth: member.nestedDepth,
                    archive_digest: member.parentArchiveHash,
                },
                evidence_refs: [provenance.evidence_id],
                confidence: DERIVED_CONFIDENCE,
            });
        }
        for (const diagnostic of [...local.diagnostics].sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code)
            || (0, ordering_1.compareCodePoints)(a.sourcePath ?? "", b.sourcePath ?? "")
            || (0, ordering_1.compareCodePoints)(a.message, b.message))) {
            const subjectId = diagnostic.sourcePath !== undefined
                && emittedArtifactIds.has(artifactIdFor(diagnostic.sourcePath))
                ? artifactIdFor(diagnostic.sourcePath)
                : repositoryId;
            diagnostics.push({
                code: diagnostic.code,
                severity: diagnostic.severity,
                message: diagnostic.message,
                stage: OBSERVATION_STAGE,
                category: "observation",
                subject_id: subjectId,
                details: diagnostic.sourcePath !== undefined ? { source_path: diagnostic.sourcePath } : {},
            });
        }
    }
    // Repository-level facts derived from observed paths, each with its own evidence.
    const repositoryEvidenceRefs = [];
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
        package_managers: sortStrings(packageManagers.keys()),
        entrypoints: [],
        workflows: sortStrings(workflows),
        adr_refs: sortStrings(adrRefs),
        governance_refs: sortStrings(governanceRefs),
        capability_ids: [],
        artifact_ids: artifactIds,
        upstream_repository_ids: [],
        downstream_repository_ids: [],
        unresolved_dependencies: [],
        owner_ids: [],
        evidence_refs: repositoryEvidenceRefs,
        confidence: REPOSITORY_CONFIDENCE,
    };
    // Report — rather than invent — everything the inventory could not establish.
    const unsupported = [
        ["primary_role", "Repository role is not derivable from inventory evidence; primary_role stays 'unknown'."],
        ["capabilities", "No capability evidence is available to this producer; capabilities is empty by policy."],
        ["entrypoints", "Entrypoints require package-manifest interpretation beyond inventory observation."],
        ["owner_ids", "Ownership is not observable from inventory evidence."],
        ["dependencies", "Dependency edges require manifest interpretation beyond inventory observation."],
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
    // A shared manifest filename is observable; the manager behind it is not.
    for (const fileName of sortStrings(ambiguousManifests.keys())) {
        const sourcePath = ambiguousManifests.get(fileName);
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
        capabilities: [],
        relationships: relationships.sort((a, b) => (0, ordering_1.compareCodePoints)(a.edge_id, b.edge_id)),
        evidence: evidence.sort((a, b) => (0, ordering_1.compareCodePoints)(a.evidence_id, b.evidence_id)),
        diagnostics: diagnostics.sort((a, b) => (0, ordering_1.compareCodePoints)(a.code, b.code)
            || (0, ordering_1.compareCodePoints)(a.subject_id ?? "", b.subject_id ?? "")
            || (0, ordering_1.compareCodePoints)(a.message, b.message)),
        // Already ordered by the interpretation pass; re-sorted here so the packet's
        // ordering guarantee does not depend on the producer of the input.
        //
        // The subject each assertion arrived with is preserved. Rewriting every
        // subject to the repository — which this builder used to do — collapsed
        // "this plan declares itself WIP" into "the repository declares itself WIP",
        // which is a different and much weaker claim. Validation below refuses an
        // assertion whose subject is neither an emitted repository nor an emitted
        // artifact, so preserving the subject cannot strand one.
        assertions: [...(input.interpretation?.assertions ?? [])]
            .sort((a, b) => (0, ordering_1.compareCodePoints)(a.source_path, b.source_path)
            || a.source_range.start_line - b.source_range.start_line
            || (0, ordering_1.compareCodePoints)(a.predicate, b.predicate)
            || (0, ordering_1.compareCodePoints)(a.object, b.object)
            || (0, ordering_1.compareCodePoints)(a.extractor_id, b.extractor_id)
            || (0, ordering_1.compareCodePoints)(a.subject_id, b.subject_id)),
    };
    const shell = {
        packet_type: exports.REPOSITORY_MODEL_PACKET_TYPE,
        packet_version: exports.REPOSITORY_MODEL_PACKET_VERSION,
        subject: { repository_id: repositoryId },
        source_snapshot: { revision: input.sourceRevision, semantic_hash: snapshotHash },
        producer: { name: exports.REPOSITORY_MODEL_PRODUCER_NAME, version: producerVersion },
        profile: input.localSource
            ? localSourceProfile(input.localSource)
            : { id: PROFILE_ID, version: PROFILE_VERSION, hash: PROFILE_HASH },
        schema_hash: SCHEMA_HASH,
        payload_refs: {},
        payload,
        // Bound into semantic identity only when interpretation ran, so a packet
        // built without it keeps the identity it had before the profile existed.
        ...(input.interpretation
            ? {
                interpretation_profile: {
                    profile_id: input.interpretation.profile.profile_id,
                    profile_version: input.interpretation.profile.profile_version,
                    profile_hash: input.interpretation.profile.profile_hash,
                    extractor_versions: input.interpretation.profile.extractor_versions,
                },
            }
            : {}),
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
        // Mirrors the producer: the interpretation profile participates in identity
        // exactly when it is present, and an absent one is omitted rather than
        // hashed as null, so an inventory-only packet keeps its prior identity.
        ...(packet.interpretation_profile
            ? { interpretation_profile: packet.interpretation_profile }
            : {}),
    });
    checks.push(check("semantic-hash", "invariant", "semantic_hash_is_reproducible", recomputed === packet.semantic_hash, "declared semantic hash matches recomputation", { declared: packet.semantic_hash, calculated: recomputed }));
    checks.push(check("packet-id", "invariant", "packet_id_is_semantically_derived", packet.packet_id === `packet:${packet.semantic_hash.slice(SHA_PREFIX.length)}`, "packet id is derived from the semantic hash"));
    const absolute = payload.artifacts.filter((a) => a.source_path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(a.source_path) || a.source_path.includes("\\"));
    checks.push(check("portable-paths", "invariant", "source_paths_are_repository_relative", absolute.length === 0, "every artifact source path is a portable repository-relative POSIX path", { offending_count: absolute.length }));
    const orderedArtifacts = payload.artifacts.every((a, i) => i === 0 || (0, ordering_1.compareCodePoints)(payload.artifacts[i - 1].source_path, a.source_path) < 0);
    checks.push(check("stable-ordering", "invariant", "ordering_is_explicit_and_stable", orderedArtifacts, "artifacts are ordered by repository-relative path"));
    // An assertion without a resolvable, hashed span is not evidence of anything,
    // so the producer refuses to emit one rather than letting it reach a consumer.
    const unsupportedAssertions = payload.assertions.filter((assertion) => !assertion.source_path
        || !/^sha256:[a-f0-9]{64}$/.test(assertion.source_content_hash)
        || assertion.source_range.start_line < 1
        || assertion.source_range.end_line < assertion.source_range.start_line
        || assertion.evidence_excerpt.length === 0
        || !assertion.extractor_id);
    checks.push(check("assertion-evidence", "evidence", "assertions_cite_exact_sources", unsupportedAssertions.length === 0, "every assertion cites an exact source span and a hashed source file", { unsupported_count: unsupportedAssertions.length }));
    // An assertion may attach to the repository as a whole or to one artifact in
    // it. Both are emitted records in this packet, and an assertion pointing at
    // neither would be a claim about something the consumer cannot resolve.
    const assertionSubjects = new Set([
        ...payload.repositories.map((r) => r.repository_id),
        ...payload.artifacts.map((a) => a.artifact_id),
    ]);
    const orphanAssertions = payload.assertions.filter((assertion) => !assertionSubjects.has(assertion.subject_id));
    checks.push(check("assertion-subject", "cross-reference", "assertions_resolve_to_a_subject", orphanAssertions.length === 0, "every assertion attaches to a repository or an artifact in this packet", { orphan_count: orphanAssertions.length }));
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
    const danglingEdges = payload.relationships.filter((edge) => !(repositoryIds.has(edge.source_id) || artifactIds.has(edge.source_id))
        || !(repositoryIds.has(edge.target_id) || artifactIds.has(edge.target_id)));
    checks.push(check("edge-cross-reference", "cross-reference", "relationship_endpoints_resolve", danglingEdges.length === 0, "every relationship endpoint resolves to an emitted record", { dangling_count: danglingEdges.length }));
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
    ].sort((a, b) => (0, ordering_1.compareCodePoints)(a.path, b.path));
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
        const interpretation = input.interpret === false
            ? undefined
            : (0, interpretation_1.interpretRepository)({
                root: input.root,
                subjectId: `repo:${input.repositoryName}`,
                inventory,
                extractors: (0, extractors_1.defaultExtractors)(),
            });
        return buildRepositoryModelPacket({
            inventory,
            ...(interpretation ? { interpretation } : {}),
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