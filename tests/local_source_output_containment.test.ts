// local_source_output_containment.test.ts — local-source outputs are refused
// wherever a write would actually land inside the observed source, including
// through a symlink, and the CLI writes nothing before that check (RC-047).
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { acquireLocalSource } from "../src/local_source";
import {
  buildLocalSourceCorpus,
  buildLocalSourceManifest,
  observeLocalSourceModel,
  writeLocalSourceCorpus,
  writeLocalSourceManifest,
  type LocalSourceManifest,
} from "../src/local_source_model";
import { treeSnapshot } from "./helpers/zip_fixtures";

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "scripts", "local-source-cli.js");
const roots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-out-containment-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function sourceTree(): string {
  const src = path.join(tmp(), "src");
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, "a.md"), "# A\n");
  return src;
}

function manifestOf(src: string): LocalSourceManifest {
  const observation = acquireLocalSource({ path: src, scratchParent: tmp() });
  try {
    return buildLocalSourceManifest(observation, { observedAt: "2026-01-01T00:00:00.000Z" });
  } finally {
    observation.dispose();
  }
}

describe("library output containment resolves symlinks (RC-047)", () => {
  test("REG-WU-036-RC-047-a: an output directory that is a symlink into the source is refused", () => {
    const src = sourceTree();
    const manifest = manifestOf(src);
    const out = path.join(tmp(), "out");
    fs.symlinkSync(src, out);
    const before = treeSnapshot(src);
    expect(() => writeLocalSourceManifest(manifest, path.join(out, "manifest.json"), src))
      .toThrow(/refusing to write the acquisition manifest inside the observed source tree/);
    expect(treeSnapshot(src)).toEqual(before);
  });

  test("REG-WU-036-RC-047-b: a dangling symlink target pointing into the source is refused", () => {
    const src = sourceTree();
    const manifest = manifestOf(src);
    const out = tmp();
    fs.symlinkSync(path.join(src, "manifest.json"), path.join(out, "manifest.json"));
    expect(() => writeLocalSourceManifest(manifest, path.join(out, "manifest.json"), src))
      .toThrow(/refusing to write the acquisition manifest inside the observed source tree/);
    expect(fs.existsSync(path.join(src, "manifest.json"))).toBe(false);
  });

  test("REG-WU-036-RC-047-c: a source named through a symlinked ancestor still contains its real path", () => {
    const real = path.join(tmp(), "real");
    fs.mkdirSync(path.join(real, "src"), { recursive: true });
    fs.writeFileSync(path.join(real, "src", "a.md"), "# A\n");
    const link = path.join(tmp(), "link");
    fs.symlinkSync(real, link);
    const sourceViaLink = path.join(link, "src");
    const result = observeLocalSourceModel({ path: sourceViaLink, producerVersion: "4.0.0", interpret: false });
    try {
      const corpus = buildLocalSourceCorpus(result);
      const before = treeSnapshot(path.join(real, "src"));
      expect(() => writeLocalSourceCorpus(
        corpus,
        {
          indexPath: path.join(real, "src", "corpus-index.json"),
          reportPath: path.join(real, "src", "corpus-report.md"),
        },
        sourceViaLink,
      )).toThrow(/refusing to write the corpus index inside the observed source tree/);
      expect(treeSnapshot(path.join(real, "src"))).toEqual(before);
    } finally {
      result.observation.dispose();
    }
  });

  test("REG-WU-036-RC-047-d: a target genuinely outside the source is still written", () => {
    const src = sourceTree();
    const manifest = manifestOf(src);
    const out = tmp();
    const written = writeLocalSourceManifest(manifest, path.join(out, "local-source-manifest.json"), src);
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.realpathSync(written)).toBe(fs.realpathSync(path.join(out, "local-source-manifest.json")));
    expect(fs.readdirSync(src)).toEqual(["a.md"]);
  });

  test("REG-AUDIT-F13-a: through a symlinked output directory the manifest writer returns path.resolve(target)", () => {
    const src = sourceTree();
    const manifest = manifestOf(src);
    const real = tmp();
    const link = path.join(tmp(), "out-link");
    fs.symlinkSync(real, link);
    const target = path.join(link, "local-source-manifest.json");
    const written = writeLocalSourceManifest(manifest, target, src);
    expect(written).toBe(path.resolve(target));
    // Containment and the write still use the resolved real path.
    expect(fs.existsSync(path.join(real, "local-source-manifest.json"))).toBe(true);
    expect(fs.realpathSync(written)).toBe(fs.realpathSync(path.join(real, "local-source-manifest.json")));
    expect(fs.readdirSync(src)).toEqual(["a.md"]);
  });

  test("REG-AUDIT-F13-b: through a symlinked output directory the corpus writer returns path.resolve(target)", () => {
    const src = sourceTree();
    const result = observeLocalSourceModel({ path: src, producerVersion: "4.0.0", interpret: false });
    try {
      const corpus = buildLocalSourceCorpus(result);
      const real = tmp();
      const link = path.join(tmp(), "out-link");
      fs.symlinkSync(real, link);
      const targets = {
        indexPath: path.join(link, "corpus-index.json"),
        reportPath: path.join(link, "corpus-report.md"),
      };
      const written = writeLocalSourceCorpus(corpus, targets, src);
      expect(written).toEqual({
        indexPath: path.resolve(targets.indexPath),
        reportPath: path.resolve(targets.reportPath),
      });
      expect(fs.existsSync(path.join(real, "corpus-index.json"))).toBe(true);
      expect(fs.existsSync(path.join(real, "corpus-report.md"))).toBe(true);
      expect(fs.readdirSync(src)).toEqual(["a.md"]);
    } finally {
      result.observation.dispose();
    }
  });
});

describe("the CLI writes nothing before output containment (RC-047)", () => {
  const runCli = (source: string, outDir: string): cp.SpawnSyncReturns<string> =>
    cp.spawnSync(process.execPath, [CLI, source, "--name", "fixture", "--out", outDir], { encoding: "utf8" });

  test("REG-WU-036-RC-047-e: --out inside the source exits non-zero and writes no bundle", () => {
    const src = sourceTree();
    const before = treeSnapshot(src);
    const run = runCli(src, path.join(src, "out"));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/refusing to write/);
    expect(treeSnapshot(src)).toEqual(before);
    expect(fs.existsSync(path.join(src, "out"))).toBe(false);
  });

  test("REG-WU-036-RC-047-e: --out reaching the source through a symlink exits non-zero and writes nothing", () => {
    const src = sourceTree();
    const link = path.join(tmp(), "link-to-src");
    fs.symlinkSync(src, link);
    const before = treeSnapshot(src);
    const run = runCli(src, path.join(link, "out"));
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/refusing to write/);
    expect(treeSnapshot(src)).toEqual(before);
  });
});
