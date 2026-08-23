import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildRepositoryModelPacket,
  canonicalJson,
  emitRepositoryModelBundle,
  observeRepositoryModel,
  validateRepositoryModelPacket,
  REPOSITORY_MODEL_PACKET_TYPE,
  REPOSITORY_MODEL_PACKET_VERSION,
  REPOSITORY_MODEL_PRODUCER_NAME,
  type RepositoryModelPacket,
} from "../src/repository_model";
import { inventoryTree } from "../src/inventory";
import { UNKNOWN } from "../src/schema";

const REPO = path.resolve(__dirname, "..");
const SAMPLE_ROOT = path.join(REPO, "fixtures", "repository-model", "sample-repo");
const GOLDEN = path.join(REPO, "fixtures", "repository-model", "expected-bundle");
const REVISION = "git:0000000000000000000000000000000000000000";
const PRODUCER_VERSION = "4.0.0";

const scratchDirs: string[] = [];
function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l9-rm-${name}-`));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function observeSample(root: string = SAMPLE_ROOT): RepositoryModelPacket {
  return observeRepositoryModel({
    root,
    repositoryName: "sample-repo",
    sourceRevision: REVISION,
    producerVersion: PRODUCER_VERSION,
  });
}

function emitTo(packet: RepositoryModelPacket, name: string): string {
  const bundleRoot = path.join(scratch(name), "bundle");
  emitRepositoryModelBundle(packet, { outDir: bundleRoot });
  return bundleRoot;
}

function bundleFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else out.push(path.relative(root, abs).split(path.sep).join("/"));
    }
  };
  walk(root);
  return out.sort((a, b) => a.localeCompare(b));
}

describe("repository model packet contract", () => {
  it("emits the bound consumer's packet shell", () => {
    const packet = observeSample();
    expect(packet.packet_type).toBe(REPOSITORY_MODEL_PACKET_TYPE);
    expect(packet.packet_version).toBe(REPOSITORY_MODEL_PACKET_VERSION);
    expect(packet.producer.name).toBe(REPOSITORY_MODEL_PRODUCER_NAME);
    for (const key of [
      "packet_type", "packet_version", "packet_id", "subject", "source_snapshot", "validation",
      "producer", "profile", "schema_hash", "semantic_hash", "artifact_hash", "payload_refs", "payload",
    ]) {
      expect(packet).toHaveProperty(key);
    }
    for (const domain of ["repositories", "artifacts", "capabilities", "relationships", "evidence", "diagnostics"]) {
      expect(packet.payload).toHaveProperty(domain);
    }
  });

  it("derives the packet id from the semantic hash and keeps the source revision explicit", () => {
    const packet = observeSample();
    expect(packet.packet_id).toBe(`packet:${packet.semantic_hash.slice("sha256:".length)}`);
    expect(packet.source_snapshot.revision).toBe(REVISION);
    expect(packet.payload.repositories[0].source_revision).toBe(REVISION);
  });

  it("refuses to infer a source revision", () => {
    const inventory = inventoryTree({ root: SAMPLE_ROOT, outDir: path.join(scratch("inv"), "out"), dryRun: true });
    expect(() => buildRepositoryModelPacket({
      inventory, repositoryName: "sample-repo", sourceRevision: "", producerVersion: PRODUCER_VERSION,
    })).toThrow(/sourceRevision is required/);
  });
});

describe("repository model determinism", () => {
  it("repeats the same semantic hash and packet id", () => {
    const first = observeSample();
    const second = observeSample();
    expect(second.semantic_hash).toBe(first.semantic_hash);
    expect(second.packet_id).toBe(first.packet_id);
  });

  it("keeps canonical serialization byte-stable across emissions", () => {
    const a = emitTo(observeSample(), "det-a");
    const b = emitTo(observeSample(), "det-b");
    expect(bundleFiles(b)).toEqual(bundleFiles(a));
    for (const rel of bundleFiles(a)) {
      expect(fs.readFileSync(path.join(b, rel))).toEqual(fs.readFileSync(path.join(a, rel)));
    }
  });

  it("does not let the local checkout path change semantic identity", () => {
    const alternate = path.join(scratch("alt"), "a-completely-different-directory-name");
    fs.cpSync(SAMPLE_ROOT, alternate, { recursive: true });
    const here = observeSample();
    const there = observeSample(alternate);
    expect(there.semantic_hash).toBe(here.semantic_hash);
    expect(there.packet_id).toBe(here.packet_id);
    const serialized = fs.readFileSync(path.join(emitTo(there, "alt-bundle"), "packet.json"), "utf8");
    expect(serialized).not.toContain(alternate);
    expect(serialized).not.toContain(os.tmpdir());
  });

  it("orders every emitted collection explicitly", () => {
    const { payload } = observeSample();
    const ordered = (values: string[]): boolean => values.every((v, i) => i === 0 || values[i - 1] < v);
    expect(ordered(payload.artifacts.map((a) => a.source_path))).toBe(true);
    expect(ordered(payload.evidence.map((e) => e.evidence_id))).toBe(true);
    expect(ordered(payload.relationships.map((e) => e.edge_id))).toBe(true);
  });

  it("reproduces the committed golden bundle byte for byte", () => {
    const emitted = emitTo(observeSample(), "golden");
    expect(bundleFiles(emitted)).toEqual(bundleFiles(GOLDEN));
    for (const rel of bundleFiles(GOLDEN)) {
      expect(fs.readFileSync(path.join(emitted, rel)).toString("utf8"))
        .toBe(fs.readFileSync(path.join(GOLDEN, rel)).toString("utf8"));
    }
  });
});

describe("repository model evidence discipline", () => {
  it("emits no capability that evidence does not support", () => {
    const packet = observeSample();
    expect(packet.payload.capabilities).toEqual([]);
    const declared = packet.payload.diagnostics.filter((d) => d.code === "unsupported-by-evidence");
    expect(declared.map((d) => d.details?.field)).toContain("capabilities");
  });

  it("emits only the CONTAINS relationships the inventory observed", () => {
    const packet = observeSample();
    const artifactIds = new Set(packet.payload.artifacts.map((a) => a.artifact_id));
    expect(packet.payload.relationships).toHaveLength(packet.payload.artifacts.length);
    for (const edge of packet.payload.relationships) {
      expect(edge.edge_type).toBe("CONTAINS");
      expect(edge.source_id).toBe("repo:sample-repo");
      expect(artifactIds.has(edge.target_id)).toBe(true);
    }
  });

  it("leaves role, ownership and dependency direction unresolved rather than inventing them", () => {
    const repository = observeSample().payload.repositories[0];
    expect(repository.primary_role).toBe("unknown");
    expect(repository.secondary_roles).toEqual([]);
    expect(repository.owner_ids).toEqual([]);
    expect(repository.entrypoints).toEqual([]);
    expect(repository.upstream_repository_ids).toEqual([]);
    expect(repository.downstream_repository_ids).toEqual([]);
    expect(repository.capability_ids).toEqual([]);
  });

  it("derives repository facts only from observed paths", () => {
    const repository = observeSample().payload.repositories[0];
    expect(repository.languages).toEqual(["Python", "TypeScript"]);
    expect(repository.package_managers).toEqual(["npm"]);
    expect(repository.workflows).toEqual([".github/workflows/ci.yml"]);
    expect(repository.adr_refs).toEqual(["docs/decisions/adr-001-example.md"]);
    expect(repository.governance_refs).toEqual(["CODEOWNERS"]);
  });

  it("does not resolve a shared manifest filename to a guessed package manager", () => {
    const root = path.join(scratch("ambiguous-manifest"), "repo");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "pyproject.toml"), '[tool.poetry]\nname = "svc"\n');

    const packet = observeSample(root);
    const repository = packet.payload.repositories[0];
    expect(repository.package_managers).toEqual([]);
    expect(packet.payload.diagnostics.some(
      (d) => d.code === "unsupported-by-evidence"
        && d.details?.field === "package_managers"
        && d.details?.source_path === "pyproject.toml",
    )).toBe(true);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  it("resolves a package manager from a lockfile, which does identify one", () => {
    const root = path.join(scratch("lockfiles"), "repo");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, "pyproject.toml"), '[tool.poetry]\nname = "svc"\n');
    fs.writeFileSync(path.join(root, "poetry.lock"), "# generated\n");

    expect(observeSample(root).payload.repositories[0].package_managers).toEqual(["poetry"]);

    const uvRoot = path.join(scratch("uv-lock"), "repo");
    fs.mkdirSync(uvRoot, { recursive: true });
    fs.writeFileSync(path.join(uvRoot, "pyproject.toml"), "[project]\nname = \"svc\"\n");
    fs.writeFileSync(path.join(uvRoot, "uv.lock"), "version = 1\n");

    expect(observeSample(uvRoot).payload.repositories[0].package_managers).toEqual(["uv"]);
  });

  it("resolves every evidence reference it emits", () => {
    const { payload } = observeSample();
    const ids = new Set(payload.evidence.map((e) => e.evidence_id));
    const refs = [
      ...payload.artifacts.flatMap((a) => a.evidence_refs),
      ...payload.repositories.flatMap((r) => r.evidence_refs),
      ...payload.relationships.flatMap((e) => e.evidence_refs),
    ];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) expect(ids.has(ref)).toBe(true);
  });

  it("preserves unknowns instead of converting absence into certainty", () => {
    const inventory = inventoryTree({ root: SAMPLE_ROOT, outDir: path.join(scratch("unknown"), "out"), dryRun: true });
    const target = inventory.records.find((r) => r.artifact_type !== "folder");
    expect(target).toBeDefined();
    if (!target) return;
    target.content_hash = null;
    target.unknowns = [...target.unknowns, "content_hash_skipped:file_too_large"];

    const packet = buildRepositoryModelPacket({
      inventory, repositoryName: "sample-repo", sourceRevision: REVISION, producerVersion: PRODUCER_VERSION,
    });
    const artifact = packet.payload.artifacts.find((a) => a.source_path === target.relative_path);
    expect(artifact?.content_hash).toBe(UNKNOWN);
    expect(artifact?.confidence.completeness).toBe("partial");
    expect(packet.payload.diagnostics.some((d) => d.code === "content-hash-unavailable")).toBe(true);
    expect(packet.payload.diagnostics.some(
      (d) => d.code === "inventory-unknown" && d.details?.unknown === "content_hash_skipped:file_too_large",
    )).toBe(true);
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
  });

  it("keeps machine-specific absolute paths out of every artifact identity", () => {
    const packet = observeSample();
    for (const artifact of packet.payload.artifacts) {
      expect(artifact.source_path.startsWith("/")).toBe(false);
      expect(artifact.source_path).not.toContain("\\");
      expect(artifact.source_path).not.toContain(SAMPLE_ROOT);
    }
  });
});

describe("repository model producer validation", () => {
  it("passes a freshly built packet", () => {
    const result = validateRepositoryModelPacket(observeSample());
    expect(result.status).toBe("passed");
    expect(result.checks.every((c) => c.status === "passed")).toBe(true);
    for (const checkClass of ["schema", "invariant", "evidence", "cross-reference"]) {
      expect(result.checks.some((c) => c.check_class === checkClass)).toBe(true);
    }
  });

  it("detects a tampered payload through the semantic hash", () => {
    const packet = observeSample();
    const tampered: RepositoryModelPacket = {
      ...packet,
      payload: {
        ...packet.payload,
        repositories: [{ ...packet.payload.repositories[0], primary_role: "library" }],
      },
    };
    const result = validateRepositoryModelPacket(tampered);
    expect(result.status).toBe("failed");
    expect(result.checks.find((c) => c.check_id === "semantic-hash")?.status).toBe("failed");
  });

  it("detects a dangling evidence reference", () => {
    const packet = observeSample();
    const artifacts = [...packet.payload.artifacts];
    artifacts[0] = { ...artifacts[0], evidence_refs: ["evidence:does-not-exist"] };
    const result = validateRepositoryModelPacket({ ...packet, payload: { ...packet.payload, artifacts } });
    expect(result.checks.find((c) => c.check_id === "evidence-resolves")?.status).toBe("failed");
  });

  it("refuses to emit a packet that fails validation", () => {
    const packet = observeSample();
    const broken: RepositoryModelPacket = { ...packet, semantic_hash: "sha256:0000" };
    expect(() => emitRepositoryModelBundle(broken, { outDir: path.join(scratch("broken"), "bundle") }))
      .toThrow(/failed producer validation/);
  });

  it("treats packet bundles as immutable", () => {
    const bundleRoot = emitTo(observeSample(), "immutable");
    expect(() => emitRepositoryModelBundle(observeSample(), { outDir: bundleRoot }))
      .toThrow(/immutable/);
  });
});

/** JSON.parse preserves source order for non-numeric keys, so this reads the file's real key order. */
function expectSortedKeys(value: unknown, label: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => expectSortedKeys(item, label));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const keys = Object.keys(value as Record<string, unknown>);
  expect(keys, `${label} key order`).toEqual([...keys].sort());
  for (const key of keys) expectSortedKeys((value as Record<string, unknown>)[key], label);
}

describe("repository model bundle shape", () => {
  it("writes a canonical bundle the consumer can verify", () => {
    const bundleRoot = emitTo(observeSample(), "shape");
    expect(bundleFiles(bundleRoot)).toEqual(["manifest.json", "packet.json", "receipts/validation-receipt.json"]);

    for (const rel of bundleFiles(bundleRoot)) {
      const text = fs.readFileSync(path.join(bundleRoot, rel), "utf8");
      // Canonical form: exactly one trailing newline, no separator whitespace,
      // and object keys serialized in ascending order at every depth.
      expect(text.endsWith("\n")).toBe(true);
      expect(text.slice(0, -1)).not.toContain("\n");
      // Re-render the parsed document and require an exact match. A substring
      // check for ": " / ", " cannot express this: an evidence excerpt may
      // legitimately contain either sequence inside a string value.
      expect(text.slice(0, -1)).toBe(canonicalJson(JSON.parse(text)));
      expectSortedKeys(JSON.parse(text), rel);
    }

    const manifest = JSON.parse(fs.readFileSync(path.join(bundleRoot, "manifest.json"), "utf8"));
    const packet = JSON.parse(fs.readFileSync(path.join(bundleRoot, "packet.json"), "utf8"));
    const receipt = JSON.parse(fs.readFileSync(path.join(bundleRoot, "receipts/validation-receipt.json"), "utf8"));

    expect(manifest.packet_id).toBe(packet.packet_id);
    expect(manifest.semantic_hash).toBe(packet.semantic_hash);
    expect(receipt.subject_packet_id).toBe(packet.packet_id);
    expect(receipt.subject_semantic_hash).toBe(packet.semantic_hash);
    expect(receipt.status).toBe("passed");
    expect(packet.validation).toEqual({ status: "passed", receipt_ref: "receipts/validation-receipt.json" });
    expect(packet.payload_refs).toEqual({});

    for (const entry of manifest.files) {
      const abs = path.join(bundleRoot, entry.path);
      expect(fs.statSync(abs).size).toBe(entry.size_bytes);
      expect(entry.media_type).toBe("application/json");
    }
  });
});

describe("topology conformance evidence", () => {
  const evidence = JSON.parse(fs.readFileSync(path.join(REPO, "docs", "topology-conformance.json"), "utf8"));

  it("records acceptance by the bound topology consumer without a translation shim", () => {
    expect(evidence.schema).toBe("l9.topology-conformance/v1");
    expect(evidence.consumer.repository).toBe("Quantum-L9/l9-constellation-topology");
    expect(evidence.consumer.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(evidence.result.status).toBe("passed");
    expect(evidence.result.translation_shim_required).toBe(false);
  });

  it("stays bound to every golden bundle it describes", () => {
    // The record carries one subject per committed bundle. Reading only the first
    // would let a second bundle drift unnoticed, which is exactly what happened
    // while the record still used a single `subject` object.
    expect(Array.isArray(evidence.subjects)).toBe(true);
    expect(evidence.subjects.length).toBeGreaterThanOrEqual(2);
    for (const subject of evidence.subjects) {
      const packet = JSON.parse(fs.readFileSync(path.join(REPO, subject.bundle, "packet.json"), "utf8"));
      expect(subject.packet_id).toBe(packet.packet_id);
      expect(subject.semantic_hash).toBe(packet.semantic_hash);
      expect(subject.packet_type).toBe(REPOSITORY_MODEL_PACKET_TYPE);
      expect(subject.packet_version).toBe(REPOSITORY_MODEL_PACKET_VERSION);
    }
    expect(evidence.subjects.map((subject: { id: string }) => subject.id).sort())
      .toEqual(["inventory", "local-source"]);
    expect(evidence.subjects.some((subject: { bundle: string }) => subject.bundle === path.relative(REPO, GOLDEN)))
      .toBe(true);
  });

  it("binds the record to the exact bytes of every file in each bundle", () => {
    // Packet id and semantic hash cover `packet.json`. The manifest and the
    // receipt are the two files a bundle carries beside it, and a record that
    // did not name their bytes could describe a bundle whose receipt had since
    // been rewritten.
    for (const subject of evidence.subjects) {
      expect(Array.isArray(subject.files)).toBe(true);
      expect(subject.files.map((file: { path: string }) => file.path).sort())
        .toEqual(["manifest.json", "packet.json", "receipts/validation-receipt.json"]);
      for (const file of subject.files) {
        const absolute = path.join(REPO, subject.bundle, ...file.path.split("/"));
        const digest = `sha256:${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`;
        expect(digest, `${subject.id}/${file.path}`).toBe(file.content_hash);
      }
    }
  });

  it("proves the local-source packet reached the consumer with its archive provenance", () => {
    const localSource = evidence.subjects.find((subject: { id: string }) => subject.id === "local-source");
    expect(localSource).toBeDefined();
    const packet = JSON.parse(fs.readFileSync(path.join(REPO, localSource.bundle, "packet.json"), "utf8"));
    // The consumer normalizes what it accepted; these counts are the proof that
    // archive member artifacts and DERIVED_FROM edges survived the boundary rather
    // than being dropped on the way in.
    expect(localSource.normalized_counts.artifacts).toBe(packet.payload.artifacts.length);
    expect(localSource.normalized_counts.relationships).toBe(packet.payload.relationships.length);
    expect(packet.payload.relationships.some(
      (edge: { edge_type: string }) => edge.edge_type === "DERIVED_FROM")).toBe(true);
    expect(packet.source_snapshot.revision).toMatch(/^fs:sha256:[a-f0-9]{64}$/);
  });
});
