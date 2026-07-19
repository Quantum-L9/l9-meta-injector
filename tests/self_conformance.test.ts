// RAA-004 — self-conformance (dogfooding). The injector must be able to process its
// OWN source tree cleanly. We copy src/*.ts into a temp dir, run the FULL pipeline
// live over the copy (the real tree is never touched), and assert every file:
//   - preserves its body under injection (postInjectionBodyHash === originalBodyHash)
//   - verifies clean through the toolkit's own verifier (block present, body intact)
//   - re-injects idempotently (a second pass changes nothing)
// A regression in classification, injection, or verification that would corrupt the
// toolkit's own files fails here.
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { runPipelineAsync } from "../src/pipeline";
import { PipelineConfig } from "../src/schema";

const SRC = path.join(__dirname, "..", "src");

function copyOfSrc(): string {
  const d = path.join(os.tmpdir(), `l9-selfconf-${process.pid}-${process.hrtime.bigint()}`);
  fs.mkdirSync(d, { recursive: true });
  fs.cpSync(SRC, path.join(d, "src"), { recursive: true });
  return d;
}

function cfg(root: string, out: string): PipelineConfig {
  return {
    root, glob: "**/*.ts", dryRun: false, outDir: out, namespace: "l9",
    authority: "l9.meta-injector", nearDupThreshold: 0.9, hashPrefixLength: 16,
    indexDir: out, verbose: false, llmEnabled: false, normalizeFilenames: false,
  };
}

describe("RAA-004 — the injector dogfoods its own src/ tree", () => {
  test("live inject over a copy of src/: bodies preserved, all verify clean, idempotent", async () => {
    const base = copyOfSrc();
    const root = path.join(base, "src");
    const out = path.join(base, ".out");

    const result = await runPipelineAsync(cfg(root, out));

    // It actually processed the source tree.
    expect(result.injected.length).toBeGreaterThan(5);

    // Every processed source file preserves its body under injection.
    const notPreserved = result.injected.filter((r) => !r.bodyPreserved).map((r) => path.basename(r.sourcePath));
    expect(notPreserved).toEqual([]);

    // The toolkit's own sources verify clean through its own verifier.
    const issues = result.verified.filter((v) => v.issues.length > 0)
      .map((v) => `${path.basename(v.sourcePath)}: ${v.issues.join("; ")}`);
    expect(issues).toEqual([]);
    expect(result.verification.passed).toBe(true);

    // Second pass is a no-op: re-injecting the now-stamped tree changes nothing.
    const rerun = await runPipelineAsync(cfg(root, out));
    const rerunNotPreserved = rerun.injected.filter((r) => !r.bodyPreserved);
    expect(rerunNotPreserved).toEqual([]);
    expect(rerun.verification.passed).toBe(true);
  });
});
