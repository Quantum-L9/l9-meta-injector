// repository_model_validation_stamp.test.ts — a packet's validation field reports
// a validation that actually ran (RC-035).
//
// A built packet carries the outcome of validating it, and no receipt reference
// until a receipt exists; an emitted bundle's packet.json carries `passed` and the
// receipt it ships beside. A packet that fails validation never reports passed.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { buildCorpusIntelligencePacket } from "../src/corpus_intelligence";
import { corpusIntelligenceInput } from "../src/corpus_intelligence_input";
import { runCorpusScan } from "../src/corpus_scan";
import { defaultExtractors } from "../src/extractors";
import { interpretRepository } from "../src/interpretation";
import { inventoryTree } from "../src/inventory";
import {
  buildRepositoryModelPacket,
  emitRepositoryModelBundle,
  observeRepositoryModel,
  validateRepositoryModelPacket,
} from "../src/repository_model";

const REPO = path.resolve(__dirname, "..");
const SAMPLE_ROOT = path.join(REPO, "fixtures", "repository-model", "sample-repo");
const GOLDEN = path.join(REPO, "fixtures", "repository-model", "expected-bundle");
const REVISION = "git:0000000000000000000000000000000000000000";
const PRODUCER_VERSION = "4.0.0";

const scratchDirs: string[] = [];
function scratch(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `l9-rm-validation-${name}-`));
  scratchDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratchDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function observeSample() {
  return observeRepositoryModel({
    root: SAMPLE_ROOT,
    repositoryName: "sample-repo",
    sourceRevision: REVISION,
    producerVersion: PRODUCER_VERSION,
  });
}

describe("the validation stamp records an executed validation (RC-035)", () => {
  it("REG-WU-030-RC-035-a: a packet that fails validation never reports passed", () => {
    const inventory = inventoryTree({
      root: SAMPLE_ROOT,
      outDir: path.join(scratch("inventory"), "out"),
      dryRun: true,
      injectHeaders: false,
      writeSidecars: false,
      folderSidecars: false,
      now: "1970-01-01T00:00:00.000Z",
    });
    const interpretation = interpretRepository({
      root: SAMPLE_ROOT,
      subjectId: "repo:sample-repo",
      inventory,
      extractors: defaultExtractors(),
    });
    expect(interpretation.assertions.length).toBeGreaterThan(0);
    const broken = {
      ...interpretation,
      assertions: interpretation.assertions.map((assertion, index) =>
        index === 0 ? { ...assertion, subject_id: "artifact:not-in-packet" } : assertion),
    };
    const packet = buildRepositoryModelPacket({
      inventory,
      interpretation: broken,
      repositoryName: "sample-repo",
      sourceRevision: REVISION,
      producerVersion: PRODUCER_VERSION,
    });
    expect(validateRepositoryModelPacket(packet).status).toBe("failed");
    expect(packet.validation.status).not.toBe("passed");
    expect(packet.validation.status).toBe("failed");
    expect(packet.validation.receipt_ref).toBeUndefined();
  });

  it("REG-WU-030-RC-035-b: a valid packet that was not emitted reports passed with no receipt reference", () => {
    const packet = observeSample();
    expect(packet.validation).toEqual({ status: "passed" });
  });

  it("REG-WU-030-RC-035-c: the emitted bundle carries passed and its receipt, byte-identical to the golden", () => {
    const emitted = path.join(scratch("emit"), "bundle");
    emitRepositoryModelBundle(observeSample(), { outDir: emitted });
    const packet = JSON.parse(fs.readFileSync(path.join(emitted, "packet.json"), "utf8"));
    expect(packet.validation).toEqual({ status: "passed", receipt_ref: "receipts/validation-receipt.json" });
    expect(fs.existsSync(path.join(emitted, packet.validation.receipt_ref))).toBe(true);
    for (const rel of ["packet.json", "manifest.json", path.join("receipts", "validation-receipt.json")]) {
      expect(fs.readFileSync(path.join(emitted, rel), "utf8")).toBe(fs.readFileSync(path.join(GOLDEN, rel), "utf8"));
    }
  });

  it("REG-WU-030-RC-035-d: a valid corpus scan keeps 'passed' and its corpus intelligence packet id", async () => {
    const root = path.join(scratch("corpus"), "root");
    fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nOne document.\n");
    const result = await runCorpusScan({
      roots: [{ path: root, name: "root" }],
      producerVersion: PRODUCER_VERSION,
      topics: { enabled: false },
    });
    const options = { producerVersion: PRODUCER_VERSION, createdAt: "2026-01-01T00:00:00.000Z" };
    const current = buildCorpusIntelligencePacket(corpusIntelligenceInput(result, options)).packet;
    for (const reference of current.inputs.repository_model_packets) {
      expect(reference.validation_status).toBe("passed");
    }
    // The stamp every packet carried before the fix: the identity must not move.
    const legacyStamped = {
      ...result,
      rootPackets: result.rootPackets.map((rootPacket) => ({
        ...rootPacket,
        packet: {
          ...rootPacket.packet,
          validation: { status: "passed" as const, receipt_ref: "receipts/validation-receipt.json" },
        },
      })),
    };
    const legacy = buildCorpusIntelligencePacket(corpusIntelligenceInput(legacyStamped, options)).packet;
    expect(current.packet_id).toBe(legacy.packet_id);
  });
});
