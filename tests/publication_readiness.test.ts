import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

describe("publication decision", () => {
  test("decision is internally coherent and fail-closed", () => {
    const doc = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "docs/package-publication-decision.json"), "utf8"),
    );
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
    // v2 adds approved_version, the owner approval's version binding (ADR-070).
    expect(doc.schema).toBe("l9.package-publication-decision/v2");
    expect(doc.package_name).toBe("l9-meta-injector");
    expect(doc.package_version).toBe(pkg.version);
    expect(doc.publication_command).toBe("npm publish");
    expect(Array.isArray(doc.evidence)).toBe(true);
    expect(doc.evidence.length).toBeGreaterThan(0);
    const resolved = doc.evidence.every((item: { status: string; result: string }) =>
      ["verified", "not_applicable_with_reason"].includes(item.status) &&
      typeof item.result === "string" && item.result.trim().length > 0,
    );
    if (doc.status === "approved") {
      expect(resolved).toBe(true);
      expect(doc.approved_version).toBe(pkg.version);
    } else {
      expect(doc.status).toBe("blocked_pending_history_check");
    }
  });
});

// --- RC-108: the gate requires the evidence set and a version-bound approval -----
//
// The gate used to validate only the shape of whatever evidence was listed and a
// free-form status, so one arbitrary verified item approved publication, the owner
// approval could be waived, and prepare-release restamped package_version so an
// approval for N silently became an approval for N+1 (ADR-070 amending ADR-015).
// These run the real scripts against a mirror so the committed decision is never
// touched.

const REPO = process.cwd();
type Evidence = { id: string; status: string; result: string } | null;
type Decision = Record<string, unknown> & { evidence: Evidence[] };

function committedDecision(): Decision {
  return JSON.parse(fs.readFileSync(path.join(REPO, "docs/package-publication-decision.json"), "utf8"));
}

const mirrors: string[] = [];
afterEach(() => {
  for (const dir of mirrors.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** A throwaway copy of exactly the files the publication and release scripts read. */
function mirror(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-publication-"));
  mirrors.push(dir);
  for (const relative of [
    "package.json", "package-lock.json", "README.md", "CHANGELOG.md", "INVARIANTS.md",
    "docs/package-publication-decision.json", "docs/public-api-contract.json", "docs/package-contract.json",
    "docs/architecture.md", "docs/decision_log.md", "docs/decisions/029-v4-release-and-consumer-migration.md",
    "docs/decisions/050-release-version-authority-and-major-tags.md", "docs/release",
    "scripts/check-publication-readiness.js", "scripts/prepare-release.js", "scripts/lib/release-identity.js",
  ]) {
    fs.cpSync(path.join(REPO, relative), path.join(dir, relative), { recursive: true });
  }
  return dir;
}

function writeDecision(dir: string, doc: Decision): void {
  fs.writeFileSync(path.join(dir, "docs/package-publication-decision.json"), `${JSON.stringify(doc, null, 2)}\n`);
}

function readDecision(dir: string): Decision {
  return JSON.parse(fs.readFileSync(path.join(dir, "docs/package-publication-decision.json"), "utf8"));
}

function packageVersion(dir: string): string {
  return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")).version;
}

function setPackageVersion(dir: string, version: string): void {
  const file = path.join(dir, "package.json");
  const pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  pkg.version = version;
  fs.writeFileSync(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

function nextMinor(version: string): string {
  const [major, minor] = version.split(".").map(Number);
  return `${major}.${minor + 1}.0`;
}

function gate(dir: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [path.join(dir, "scripts/check-publication-readiness.js")], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function prepare(dir: string, version: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [path.join(dir, "scripts/prepare-release.js"), "--branch", `release/v${version}`], {
    encoding: "utf8", env: { ...process.env, GITHUB_REF_NAME: "" },
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

/** A decision that satisfies every rule for the mirror's current package version. */
function completeDecision(dir: string): Decision {
  const doc = committedDecision();
  const version = packageVersion(dir);
  return {
    ...doc,
    status: "approved",
    package_version: version,
    approved_version: version,
    evidence: doc.evidence.map((item) => (item && item.id === "distribution_owner_approval"
      ? { ...item, status: "verified", result: `Distribution owner approved npm publication of ${version} (test mirror).` }
      : item)),
  };
}

describe("publication gate requires the evidence set (RC-108)", () => {
  test("REG-WU-068-RC-108-a: one arbitrary verified item does not approve publication", () => {
    const dir = mirror();
    writeDecision(dir, { ...completeDecision(dir), evidence: [{ id: "anything", status: "verified", result: "x" }] });
    const result = gate(dir);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/BLOCKED/);
    expect(result.output).toMatch(/unknown evidence id 'anything'/);
    for (const id of ["npm_registry_history", "constellation_consumer_inventory", "distribution_owner_approval"]) {
      expect(result.output).toContain(`required evidence '${id}' is missing`);
    }
  });

  test("REG-WU-068-RC-108-b: flipping only the committed status to approved stays blocked", () => {
    const dir = mirror();
    writeDecision(dir, { ...committedDecision(), status: "approved" });
    const result = gate(dir);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/distribution_owner_approval must be verified/);
  });

  test("REG-WU-068-RC-108-c: an approval without distribution_owner_approval is blocked", () => {
    const dir = mirror();
    const doc = completeDecision(dir);
    writeDecision(dir, { ...doc, evidence: doc.evidence.filter((item) => item?.id !== "distribution_owner_approval") });
    const result = gate(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("required evidence 'distribution_owner_approval' is missing");
  });

  test("REG-WU-068-RC-108-d: a duplicated evidence id is blocked", () => {
    const dir = mirror();
    const doc = completeDecision(dir);
    writeDecision(dir, { ...doc, evidence: [...doc.evidence, doc.evidence.find((item) => item?.id === "npm_registry_history") ?? null] });
    const result = gate(dir);
    expect(result.status).toBe(1);
    expect(result.output).toContain("evidence id 'npm_registry_history' appears more than once");
  });

  test("REG-WU-068-RC-108-e: a null evidence item blocks with a message, not a TypeError", () => {
    const dir = mirror();
    const doc = completeDecision(dir);
    writeDecision(dir, { ...doc, evidence: [...doc.evidence, null] });
    const result = gate(dir);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/publication-readiness: BLOCKED/);
    expect(result.output).toMatch(/evidence\[\d+\] is not an object/);
    expect(result.output).not.toMatch(/TypeError/);
  });

  test("REG-WU-068-RC-108-f: the complete, version-bound approval is approved", () => {
    const dir = mirror();
    writeDecision(dir, completeDecision(dir));
    const result = gate(dir);
    expect(result.output).toMatch(/publication-readiness: APPROVED/);
    expect(result.status).toBe(0);
  });

  test("an approval bound to another version is blocked", () => {
    const dir = mirror();
    for (const approved of [null, nextMinor(packageVersion(dir))]) {
      writeDecision(dir, { ...completeDecision(dir), approved_version: approved });
      const result = gate(dir);
      expect(result.status).toBe(1);
      expect(result.output).toMatch(/approved_version/);
    }
  });
});

describe("release preparation never carries an approval to another version (RC-108)", () => {
  test("REG-WU-068-RC-108-g: preparing N+1 over an approval for N leaves the decision blocked", () => {
    const dir = mirror();
    writeDecision(dir, completeDecision(dir));
    expect(gate(dir).status).toBe(0);
    const next = nextMinor(packageVersion(dir));
    setPackageVersion(dir, next);
    const prepared = prepare(dir, next);
    expect(prepared.status, prepared.output).toBe(0);
    const doc = readDecision(dir);
    expect(doc.package_version).toBe(next);
    expect(doc.status).toBe("blocked_pending_history_check");
    const result = gate(dir);
    expect(result.status).toBe(1);
  });

  test("REG-WU-068-RC-108-h: re-preparing the same version changes nothing in the decision", () => {
    const dir = mirror();
    const next = nextMinor(packageVersion(dir));
    setPackageVersion(dir, next);
    expect(prepare(dir, next).status).toBe(0);
    const once = fs.readFileSync(path.join(dir, "docs/package-publication-decision.json"), "utf8");
    expect(prepare(dir, next).status).toBe(0);
    expect(fs.readFileSync(path.join(dir, "docs/package-publication-decision.json"), "utf8")).toBe(once);
  });

  test("REG-WU-068-RC-108-i: a blocked decision stays blocked through preparation", () => {
    const dir = mirror();
    const next = nextMinor(packageVersion(dir));
    setPackageVersion(dir, next);
    expect(prepare(dir, next).status).toBe(0);
    const doc = readDecision(dir);
    expect(doc.status).toBe("blocked_pending_history_check");
    expect(doc.approved_version ?? null).toBe(committedDecision().approved_version ?? null);
  });

  test("REG-AUDIT-N01-a: preparation keeps every ADR-050 'Amended by' line and is idempotent", () => {
    const dir = mirror();
    const adr = path.join(dir, "docs/decisions/050-release-version-authority-and-major-tags.md");
    const amendments = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("Amended by [ADR-"));
    const committed = amendments(fs.readFileSync(adr, "utf8"));
    expect(committed.length).toBeGreaterThan(0);
    const next = nextMinor(packageVersion(dir));
    setPackageVersion(dir, next);
    const first = prepare(dir, next);
    expect(first.status, first.output).toBe(0);
    const once = fs.readFileSync(adr, "utf8");
    expect(amendments(once)).toEqual(committed);
    // The amendment stays in the Status section, ahead of the Decision.
    expect(once.indexOf(committed[0])).toBeLessThan(once.indexOf("## Decision"));
    expect(once.indexOf(committed[0])).toBeGreaterThan(once.indexOf("## Status"));
    expect(prepare(dir, next).status).toBe(0);
    expect(fs.readFileSync(adr, "utf8")).toBe(once);
  });

  test("the committed decision remains blocked and unapproved", () => {
    const doc = committedDecision();
    expect(doc.status).toBe("blocked_pending_history_check");
    expect(doc.approved_version).toBe(null);
    const owner = doc.evidence.find((item) => item?.id === "distribution_owner_approval");
    expect(owner?.status).not.toBe("verified");
    const result = spawnSync(process.execPath, [path.join(REPO, "scripts/check-publication-readiness.js")], { encoding: "utf8" });
    expect(result.status).toBe(1);
  });
});
