/**
 * Deterministic structured interpretation (finding F-T1).
 *
 * The producer may now read a bounded set of structured surfaces — package manifests,
 * service specs, Python route decorators — and turn them into evidence-backed facts. Two
 * things are being defended here at once:
 *
 *   coverage:  the facts a repository actually declares are extracted and reach the packet
 *   restraint: nothing beyond what the source states is ever asserted
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { inventoryTree } from "../src/inventory";
import {
  EXTRACTOR_VERSIONS,
  INTERPRETATION_PROFILE_ID,
  INTERPRETATION_PROFILE_VERSION,
  interpretRepository,
  type InterpretationFact,
  type InterpretationResult,
} from "../src/repository_interpretation";
import {
  buildRepositoryModelPacket,
  observeRepositoryModel,
  validateRepositoryModelPacket,
  type RepositoryModelPacket,
} from "../src/repository_model";

const REPO = path.resolve(__dirname, "..");
const FIXTURE = path.join(REPO, "fixtures", "repository-model", "interpreted-repo");
const REVISION = "git:0000000000000000000000000000000000000000";
const PRODUCER_VERSION = "4.0.0";

const scratchDirs: string[] = [];
function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l9-interp-${name}-`));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function interpret(root = FIXTURE): InterpretationResult {
  const inventory = inventoryTree({ root, outDir: path.join(scratch("inv"), "out"), dryRun: true, now: "1970-01-01T00:00:00.000Z" });
  return interpretRepository({ root, records: inventory.records, sourceRevision: REVISION });
}

function observe(root = FIXTURE, name = "interpreted-repo"): RepositoryModelPacket {
  return observeRepositoryModel({ root, repositoryName: name, sourceRevision: REVISION, producerVersion: PRODUCER_VERSION });
}

function values(facts: readonly InterpretationFact[], kind: InterpretationFact["kind"]): string[] {
  return facts.filter((fact) => fact.kind === kind).map((fact) => fact.value);
}

function makeRepo(name: string, files: Record<string, string>): string {
  const root = path.join(scratch(name), "repo");
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return root;
}

describe("package manifest interpretation", () => {
  it("reads Poetry identity, runtime constraint, dependencies, and packaging from the body", () => {
    const { facts } = interpret();
    expect(values(facts, "package_manager")).toEqual(["poetry"]);
    expect(values(facts, "package_identity")).toEqual(["example-service"]);
    expect(values(facts, "runtime_constraint")).toEqual(["python ^3.11"]);
    expect(values(facts, "declared_dependency")).toEqual(["fastapi", "uvicorn"]);

    const identity = facts.find((fact) => fact.kind === "package_identity");
    expect(identity?.detail.version).toBe("0.2.0");
    expect(identity?.sourceRef.sourcePath).toBe("pyproject.toml");
    expect(identity?.sourceRef.lineNumber).toBe(2);
    expect(identity?.sourceRef.contentHash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(identity?.evidenceClass).toBe("declared");
  });

  it("does not resolve a package manager the manifest body does not name", () => {
    const { facts, diagnostics } = interpret(makeRepo("bare-pyproject", {
      "pyproject.toml": '[project]\nname = "svc"\nversion = "1.0.0"\n',
    }));
    expect(values(facts, "package_manager")).toEqual([]);
    expect(values(facts, "package_identity")).toEqual(["svc"]);
    expect(diagnostics.some((item) => item.code === "package-manager-undetermined")).toBe(true);
  });

  it("reads PEP 621 dependencies without inventing versions or extras", () => {
    const { facts } = interpret(makeRepo("pep621", {
      "pyproject.toml": [
        "[project]",
        'name = "svc"',
        'requires-python = ">=3.12"',
        "dependencies = [",
        '  "fastapi>=0.135",',
        '  "uvicorn[standard]>=0.32",',
        "]",
        "[build-system]",
        'build-backend = "setuptools.build_meta"',
        "",
      ].join("\n"),
    }));
    expect(values(facts, "package_manager")).toEqual(["setuptools"]);
    expect(values(facts, "runtime_constraint")).toEqual(["python >=3.12"]);
    expect(values(facts, "declared_dependency")).toEqual(["fastapi", "uvicorn"]);
  });

  it("claims nothing at all from an unparsable manifest", () => {
    const { facts, diagnostics } = interpret(makeRepo("broken-json", { "package.json": "{ not json" }));
    expect(facts).toEqual([]);
    expect(diagnostics.some((item) => item.code === "manifest-unparsable")).toBe(true);
  });
});

describe("service spec interpretation", () => {
  it("reads the declared service identity and its declared actions", () => {
    const { facts } = interpret();
    expect(values(facts, "service_identity")).toEqual(["example-service"]);
    expect(values(facts, "declared_action").sort()).toEqual(["describe", "execute"]);
    const execute = facts.find((fact) => fact.kind === "declared_action" && fact.value === "execute");
    expect(execute?.detail.description).toBe("Execute an action request");
    expect(execute?.sourceRef.sourcePath).toBe("spec.yaml");
  });

  it("does not read nested schema structure it cannot interpret", () => {
    const facts = interpret().facts.filter((fact) => fact.sourceRef.sourcePath === "spec.yaml");
    // `input_schema` and its properties are structure, not identity, and stay unread.
    expect(facts.every((fact) => !JSON.stringify(fact.detail).includes("input_schema"))).toBe(true);
  });
});

describe("python route interpretation", () => {
  it("observes the decorator, method, path, and handler symbol", () => {
    const routes = interpret().facts.filter((fact) => fact.kind === "declared_route");
    expect(routes.map((fact) => fact.value)).toEqual(["GET /health", "POST /v1/execute"]);
    const execute = routes.find((fact) => fact.value === "POST /v1/execute");
    expect(execute?.detail.handler).toBe("execute");
    expect(execute?.detail.method).toBe("POST");
    expect(execute?.detail.route_path).toBe("/v1/execute");
    expect(execute?.sourceRef.sourcePath).toBe("service/api.py");
    expect(execute?.evidenceClass).toBe("observed");
  });

  it("records an implementation marker inside the handler, scoped to that handler", () => {
    const markers = interpret().facts.filter((fact) => fact.kind === "implementation_marker");
    expect(markers).toHaveLength(1);
    expect(markers[0].value).toBe("TODO");
    expect(markers[0].detail.route).toBe("POST /v1/execute");
    expect(markers[0].detail.handler).toBe("execute");
  });

  it("does not attribute a marker from one handler to another", () => {
    const { facts } = interpret(makeRepo("two-handlers", {
      "api.py": [
        "from fastapi import FastAPI",
        "app = FastAPI()",
        "",
        '@app.get("/a")',
        "async def a():",
        "    return 1",
        "",
        '@app.get("/b")',
        "async def b():",
        "    # TODO: finish",
        "    raise NotImplementedError",
        "",
      ].join("\n"),
    }));
    const markers = facts.filter((fact) => fact.kind === "implementation_marker");
    expect(markers.every((fact) => fact.detail.handler === "b")).toBe(true);
    expect(markers.map((fact) => fact.value).sort()).toEqual(["NotImplementedError", "TODO"]);
  });

  it("leaves the handler unknown rather than guessing when none follows the decorator", () => {
    const { facts, diagnostics } = interpret(makeRepo("orphan-decorator", {
      "api.py": '@app.get("/orphan")\nSOME_CONSTANT = 1\n',
    }));
    expect(values(facts, "declared_route")).toEqual([]);
    expect(diagnostics.some((item) => item.code === "route-handler-unresolved")).toBe(true);
  });
});

describe("epistemic restraint", () => {
  it("never marks an observed route as a high-confidence claim", () => {
    const packet = observe();
    const routeEvidence = packet.payload.evidence.filter((item) => item.field === "entrypoints");
    expect(routeEvidence.length).toBeGreaterThan(0);
    for (const item of routeEvidence) {
      expect(item.evidence_class).toBe("observed");
      expect(item.confidence.level).not.toBe("high");
      expect(item.confidence.completeness).toBe("partial");
    }
  });

  it("declares capabilities without claiming who implements, exposes, or validates them", () => {
    const packet = observe();
    expect(packet.payload.capabilities.map((item) => item.name).sort()).toEqual(["describe", "execute"]);
    for (const capability of packet.payload.capabilities) {
      expect(capability.implemented_by).toEqual([]);
      expect(capability.exposed_by).toEqual([]);
      expect(capability.validated_by).toEqual([]);
      expect(capability.evidence_refs.length).toBeGreaterThan(0);
      expect(capability.confidence.completeness).toBe("partial");
    }
    expect(packet.payload.diagnostics.some((item) => item.details?.field === "capability_links")).toBe(true);
  });

  it("does not conflate package identity with service identity", () => {
    const packet = observe();
    const fields = new Set(packet.payload.evidence.map((item) => item.field));
    expect(fields.has("package_identity")).toBe(true);
    expect(fields.has("service_identity")).toBe(true);
    // Neither is promoted into the repository's own name, which stays the caller's input.
    expect(packet.payload.repositories[0].name).toBe("interpreted-repo");
  });

  it("keeps declared dependencies unresolved rather than inventing upstream repositories", () => {
    const repository = observe().payload.repositories[0];
    expect(repository.unresolved_dependencies).toEqual(["fastapi", "uvicorn"]);
    expect(repository.upstream_repository_ids).toEqual([]);
    expect(repository.downstream_repository_ids).toEqual([]);
    expect(repository.primary_role).toBe("unknown");
    expect(repository.owner_ids).toEqual([]);
  });

  it("reports facts the v1 contract has no field for instead of dropping them", () => {
    const packet = observe();
    const preserved = packet.payload.diagnostics.filter((item) => item.code === "contract-field-unavailable");
    expect(preserved.map((item) => item.details?.field).sort())
      .toEqual(["implementation_marker", "package_identity", "runtime_constraint", "service_identity"]);
  });

  it("stops claiming a field is unavailable once evidence supplies it", () => {
    const diagnostics = observe().payload.diagnostics.filter((item) => item.code === "unsupported-by-evidence");
    const fields = diagnostics.map((item) => item.details?.field);
    expect(fields).toContain("primary_role");
    expect(fields).not.toContain("capabilities");
    expect(fields).not.toContain("dependencies");
  });
});

describe("determinism", () => {
  it("returns identical facts for identical bytes", () => {
    expect(JSON.stringify(interpret().facts)).toBe(JSON.stringify(interpret().facts));
  });

  it("is independent of where the repository is checked out", () => {
    const alternate = path.join(scratch("elsewhere"), "a-completely-different-directory-name");
    fs.cpSync(FIXTURE, alternate, { recursive: true });
    expect(JSON.stringify(interpret(alternate).facts)).toBe(JSON.stringify(interpret().facts));
    expect(observe(alternate).semantic_hash).toBe(observe().semantic_hash);
  });

  it("orders facts and diagnostics explicitly", () => {
    const { facts, diagnostics } = interpret();
    const factKeys = facts.map((fact) => `${fact.kind}:${fact.sourceRef.sourcePath}:${fact.value}`);
    expect([...factKeys].sort()).toEqual(factKeys);
    const diagnosticKeys = diagnostics.map((item) => `${item.code}:${item.sourcePath ?? ""}:${item.message}`);
    expect([...diagnosticKeys].sort()).toEqual(diagnosticKeys);
  });

  it("emits no clock, no absolute path, and no randomness into the packet", () => {
    const serialized = JSON.stringify(observe());
    expect(serialized).not.toContain(FIXTURE);
    expect(serialized).not.toContain(os.tmpdir());
    expect(serialized).not.toMatch(/20\d\d-\d\d-\d\dT(?!00:00:00\.000Z)/);
  });
});

describe("interpretation profile participates in packet identity", () => {
  it("names itself, its version, and every extractor version", () => {
    const { profile } = interpret();
    expect(profile.id).toBe(INTERPRETATION_PROFILE_ID);
    expect(profile.version).toBe(INTERPRETATION_PROFILE_VERSION);
    expect(profile.hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(profile.extractorVersions).toEqual(EXTRACTOR_VERSIONS);
  });

  it("changes the packet semantic hash when the extraction policy changes", () => {
    const inventory = inventoryTree({ root: FIXTURE, outDir: path.join(scratch("policy"), "out"), dryRun: true, now: "1970-01-01T00:00:00.000Z" });
    const base = interpretRepository({ root: FIXTURE, records: inventory.records, sourceRevision: REVISION });
    const shifted: InterpretationResult = {
      ...base,
      profile: { ...base.profile, version: "1.1.0", hash: `${base.profile.hash.slice(0, -1)}0` },
    };
    const build = (interpretations: InterpretationResult): RepositoryModelPacket => buildRepositoryModelPacket({
      inventory, interpretations, repositoryName: "interpreted-repo",
      sourceRevision: REVISION, producerVersion: PRODUCER_VERSION,
    });
    expect(build(shifted).semantic_hash).not.toBe(build(base).semantic_hash);
  });

  it("changes the packet semantic hash when a real repository semantic changes", () => {
    const mutated = path.join(scratch("mutated"), "repo");
    fs.cpSync(FIXTURE, mutated, { recursive: true });
    const spec = path.join(mutated, "spec.yaml");
    fs.writeFileSync(spec, fs.readFileSync(spec, "utf8").replace('- name: "describe"', '- name: "explain"'), "utf8");
    expect(observe(mutated).semantic_hash).not.toBe(observe().semantic_hash);
  });

  it("does not let the emission timestamp change semantic identity", () => {
    const withClock = observeRepositoryModel({
      root: FIXTURE, repositoryName: "interpreted-repo", sourceRevision: REVISION,
      producerVersion: PRODUCER_VERSION, generatedAt: "2026-08-16T12:34:56.000Z",
    });
    expect(withClock.semantic_hash).toBe(observe().semantic_hash);
    expect(withClock.packet_id).toBe(observe().packet_id);
  });

  it("keeps the interpreted packet valid against the producer's own contract", () => {
    expect(validateRepositoryModelPacket(observe()).status).toBe("passed");
  });
});
