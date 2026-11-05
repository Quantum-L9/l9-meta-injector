// P1.1 — Semantic Foundation binding in Repository Model Packet provenance (ADR-082).
//
// A repository's v2 binding reaches the packet as evidence about the repository,
// citing the exact authority bytes; verification against an operator-supplied
// Foundation checkout is a separate validation record; nothing here becomes an
// owner, a repository identity, or semantic admission.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterAll, describe, expect, test } from "vitest";
import { observeSemanticBinding } from "../src/authority";
import {
  canonicalJson,
  observeRepositoryModel,
  validateRepositoryModelPacket,
  type RepositoryModelPacket,
} from "../src/repository_model";
import { cleanupGitFixtures, fixtureGit, scratchDirectory } from "./helpers/git_tree_fixtures";

afterAll(cleanupGitFixtures);

const LEDGER_IDS = [
  "l9.authority-model/global@1",
  "l9.artifact-model/global@1",
  "l9.vocabulary/global@1",
  "l9.identity-model/global@1",
  "l9.product-kinds/global@1",
  "l9.dependency-archetypes/global@1",
] as const;

const REVISION = "git:0000000000000000000000000000000000000000";

function sha256(bytes: string | Buffer): string {
  return `sha256:${crypto.createHash("sha256").update(bytes).digest("hex")}`;
}

interface Foundation {
  root: string;
  revision: string;
  ledgers: Record<string, string>;
}

/** A Git checkout holding one ledger file per cited id, committed once. */
function foundation(options: { origin?: string | null; duplicate?: string } = {}): Foundation {
  const root = scratchDirectory();
  fs.mkdirSync(path.join(root, "semantics"));
  const ledgers: Record<string, string> = {};
  for (const [index, id] of LEDGER_IDS.entries()) {
    const body = `schema: test\nartifact_id: ${id}\nterms: [t${index}]\n`;
    fs.writeFileSync(path.join(root, "semantics", `ledger-${index}.yaml`), body);
    ledgers[id] = sha256(body);
  }
  if (options.duplicate) {
    fs.writeFileSync(path.join(root, "semantics", "zz-duplicate.yaml"), `schema: test\nartifact_id: ${options.duplicate}\n`);
  }
  fixtureGit(root, ["init", "--initial-branch=main", "."]);
  fixtureGit(root, ["add", "."]);
  fixtureGit(root, ["commit", "-q", "-m", "ledgers"]);
  const origin = options.origin === undefined ? "https://github.com/Quantum-L9/.github" : options.origin;
  if (origin !== null) fixtureGit(root, ["remote", "add", "origin", origin]);
  return { root, revision: fixtureGit(root, ["rev-parse", "HEAD"]).toString("utf8").trim(), ledgers };
}

function v2Authority(found: Foundation, overrides: { revision?: string; ledgers?: Record<string, string>; ledgerText?: string; productId?: string } = {}): string {
  const ledgers = overrides.ledgers ?? found.ledgers;
  const ledgerText = overrides.ledgerText
    ?? Object.entries(ledgers).map(([id, digest]) => `    ${id}: ${digest}`).join("\n");
  return `schema: l9.meta-authority/v2
writer:
  repository: Example/bound-product
  ref: v1
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow: []
semantic_foundation:
  repository: Quantum-L9/.github
  revision: ${overrides.revision ?? found.revision}
  release: v3.6.0
  admission: candidate
  ledgers:
${ledgerText}
product:
  id: ${overrides.productId ?? "bound-product"}
  owner: Example/bound-product
  kind: dependency
  archetype: l9.dependency-archetype/semantic-subsystem@1
`;
}

const V1_AUTHORITY = `schema: l9.meta-authority/v1
writer:
  repository: Example/bound-product
  ref: v1
default_carrier: central_manifest
legacy_writers: forbidden
inline_allow: []
`;

function repository(authority?: string): string {
  const root = scratchDirectory();
  fs.writeFileSync(path.join(root, "README.md"), "# bound product\n");
  if (authority !== undefined) {
    fs.mkdirSync(path.join(root, ".l9"));
    fs.writeFileSync(path.join(root, ".l9", "meta-authority.yaml"), authority);
  }
  return root;
}

function observe(root: string, extra: { semanticsRoot?: string; requireSemanticBinding?: boolean; name?: string } = {}): RepositoryModelPacket {
  return observeRepositoryModel({
    root,
    repositoryName: extra.name ?? "bound-product",
    sourceRevision: REVISION,
    producerVersion: "4.0.0",
    interpret: false,
    ...(extra.semanticsRoot !== undefined ? { semanticsRoot: extra.semanticsRoot } : {}),
    ...(extra.requireSemanticBinding ? { requireSemanticBinding: true } : {}),
  });
}

function bindingEvidence(packet: RepositoryModelPacket) {
  return packet.payload.evidence.filter((record) => record.field?.startsWith("semantic_binding"));
}

function codes(packet: RepositoryModelPacket): string[] {
  return packet.payload.diagnostics.map((diagnostic) => diagnostic.code);
}

function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else out[path.relative(root, absolute)] = sha256(fs.readFileSync(absolute));
    }
  };
  walk(root);
  return out;
}

describe("P1.1 a valid pinned v2 binding", () => {
  test("is carried as declared evidence and, when verified, as a separate validation record", () => {
    const found = foundation();
    const authority = v2Authority(found);
    const root = repository(authority);
    const packet = observe(root, { semanticsRoot: found.root, requireSemanticBinding: true });
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");

    const [declared, verified] = [...bindingEvidence(packet)].sort((a, b) => (a.field ?? "").localeCompare(b.field ?? ""));
    expect(declared.field).toBe("semantic_binding");
    expect(declared.evidence_class).toBe("declared");
    expect(declared.source_ref).toMatchObject({ source_path: ".l9/meta-authority.yaml", content_hash: sha256(authority) });
    expect(declared.value).toMatchObject({
      authority_schema: "l9.meta-authority/v2",
      semantic_foundation: { repository: "Quantum-L9/.github", revision: found.revision, admission: "candidate" },
      product: { id: "bound-product", owner: "Example/bound-product" },
    });
    expect(verified.field).toBe("semantic_binding.verification");
    expect(verified.evidence_class).toBe("validated");
    expect(verified.source_type).toBe("validation");
    expect(verified.value).toMatchObject({ status: "verified", ledgers_verified: 6, admission: "candidate", admission_granted_by_verification: false });
    const repositoryRecord = packet.payload.repositories[0];
    expect(repositoryRecord.evidence_refs).toEqual(expect.arrayContaining([declared.evidence_id, verified.evidence_id]));
  });

  test("never promotes declared product identity into owner_ids or repository_id", () => {
    const found = foundation();
    const packet = observe(repository(v2Authority(found)), { semanticsRoot: found.root });
    expect(packet.subject.repository_id).toBe("repo:bound-product");
    expect(packet.payload.repositories[0].owner_ids).toEqual([]);
    expect(codes(packet)).toContain("unsupported-by-evidence");
    expect(packet.payload.diagnostics.find((d) => d.details?.field === "owner_ids")?.message).toMatch(/not promoted/);
  });

  test("keeps candidate admission a candidate", () => {
    const found = foundation();
    const packet = observe(repository(v2Authority(found)), { semanticsRoot: found.root });
    expect(codes(packet)).toContain("semantic-binding-not-admitted");
    const tampered = structuredClone(packet);
    const record = tampered.payload.evidence.find((e) => e.field === "semantic_binding.verification");
    (record!.value as Record<string, unknown>).admission_granted_by_verification = true;
    const failed = validateRepositoryModelPacket(tampered).checks.filter((c) => c.status === "failed").map((c) => c.check_id);
    expect(failed).toContain("semantic-admission");
  });

  test("keeps the absolute Foundation checkout path out of the packet and its identity", () => {
    const found = foundation();
    const root = repository(v2Authority(found));
    const packet = observe(root, { semanticsRoot: found.root });
    const text = canonicalJson(packet);
    expect(text).not.toContain(found.root);
    expect(text).not.toContain(root);
  });

  test("reports a declared binding as unverified when no checkout is supplied", () => {
    const found = foundation();
    const packet = observe(repository(v2Authority(found)));
    expect(bindingEvidence(packet).map((e) => e.field)).toEqual(["semantic_binding"]);
    expect(codes(packet)).toContain("semantic-binding-unverified");
  });

  test("observes the repository read-only", () => {
    const found = foundation();
    const root = repository(v2Authority(found));
    const before = snapshot(root);
    const foundationBefore = snapshot(path.join(found.root, "semantics"));
    observe(root, { semanticsRoot: found.root });
    expect(snapshot(root)).toEqual(before);
    expect(snapshot(path.join(found.root, "semantics"))).toEqual(foundationBefore);
  });
});

describe("P1.1 compatibility policy", () => {
  test("a missing binding stays unresolved and invents no owner", () => {
    const packet = observe(repository());
    expect(bindingEvidence(packet)).toEqual([]);
    expect(packet.payload.repositories[0].owner_ids).toEqual([]);
    const unresolved = packet.payload.diagnostics.find((d) => d.code === "semantic-binding-unresolved");
    expect(unresolved?.details).toMatchObject({ binding_status: "unbound" });
  });

  test("a valid v1 binding stays supported without pretending to v2 semantics", () => {
    const packet = observe(repository(V1_AUTHORITY));
    expect(validateRepositoryModelPacket(packet).status).toBe("passed");
    expect(bindingEvidence(packet)).toEqual([]);
    expect(packet.payload.diagnostics.find((d) => d.code === "semantic-binding-unresolved")?.details)
      .toMatchObject({ binding_status: "v1", authority_schema: "l9.meta-authority/v1" });
  });

  test("a structurally invalid v2 binding (a duplicated ledger) fails closed", () => {
    const found = foundation();
    const duplicateLedger = `    ${LEDGER_IDS[0]}: ${found.ledgers[LEDGER_IDS[0]]}\n${Object.entries(found.ledgers).map(([id, d]) => `    ${id}: ${d}`).join("\n")}`;
    const root = repository(v2Authority(found, { ledgerText: duplicateLedger }));
    const observation = observeSemanticBinding(root);
    expect(observation.status).toBe("invalid");
    expect(observation.conflicts.map((c) => c.code)).toEqual(["META_SEMANTIC_BINDING_INVALID"]);
    // Inventory already refuses to observe under an invalid binding (ADR-052);
    // the packet producer inherits that refusal in every mode.
    expect(() => observe(root)).toThrow(/META_SEMANTIC_BINDING_INVALID: duplicate ledger/);
    expect(() => observe(root, { semanticsRoot: found.root, requireSemanticBinding: true })).toThrow(/invalid/);
  });

  test("a strict request without a Foundation checkout fails explicitly", () => {
    const found = foundation();
    expect(() => observe(repository(v2Authority(found)), { requireSemanticBinding: true })).toThrow(/requires a Semantic Foundation checkout/);
  });

  test("a v1 binding is refused when authority is required", () => {
    const found = foundation();
    expect(() => observe(repository(V1_AUTHORITY), { semanticsRoot: found.root, requireSemanticBinding: true })).toThrow(/is v1/);
  });
});

describe("P1.1 verification fails closed", () => {
  test("on a ledger digest mismatch", () => {
    const found = foundation();
    const ledgers = { ...found.ledgers, [LEDGER_IDS[1]]: sha256("something else") };
    expect(() => observe(repository(v2Authority(found, { ledgers })), { semanticsRoot: found.root })).toThrow(/digest mismatch/);
  });

  test("on a revision mismatch", () => {
    const found = foundation();
    const revision = "1".repeat(40);
    expect(() => observe(repository(v2Authority(found, { revision })), { semanticsRoot: found.root })).toThrow(/does not match bound revision/);
  });

  test("on a ledger claimed by more than one Foundation file", () => {
    const found = foundation({ duplicate: LEDGER_IDS[2] });
    expect(() => observe(repository(v2Authority(found)), { semanticsRoot: found.root })).toThrow(/claimed by more than one file/);
  });

  test("on a checkout whose origin names another repository, or none", () => {
    const elsewhere = foundation({ origin: "https://github.com/Someone/.github" });
    expect(() => observe(repository(v2Authority(elsewhere)), { semanticsRoot: elsewhere.root })).toThrow(/origin names Someone\/\.github/);
    const anonymous = foundation({ origin: null });
    expect(() => observe(repository(v2Authority(anonymous)), { semanticsRoot: anonymous.root })).toThrow(/identity could not be established/);
  });

  test("on an operator identity that conflicts with the bound product", () => {
    const found = foundation();
    const root = repository(v2Authority(found));
    expect(() => observe(root, { semanticsRoot: found.root, name: "someone-else" })).toThrow(/does not match bound product.id/);
    // Without a request for authority the conflict is reported, never fatal.
    const packet = observe(root, { name: "someone-else" });
    expect(packet.payload.diagnostics.find((d) => d.code === "semantic-binding-conflict")?.details)
      .toMatchObject({ conflict_code: "META_AUTHORITY_IDENTITY_MISMATCH" });
  });

  test("the binding observer reports conflicts without absolute paths", () => {
    const found = foundation();
    const ledgers = { ...found.ledgers, [LEDGER_IDS[0]]: sha256("x") };
    const observation = observeSemanticBinding(repository(v2Authority(found, { ledgers })), { semanticsRoot: found.root });
    expect(observation.verification.status).toBe("failed");
    expect(JSON.stringify(observation.conflicts)).not.toContain(found.root);
  });
});
