// local_source_cli_cleanup.test.ts — the CLI releases its scratch on every exit
// (RC-102), and --embedding-pair-threshold is a cosine in [0, 1] (RC-104).
//
// Every run is the real script against the committed `dist/`, with TMPDIR pointed
// at a directory of its own so that anything the run leaves behind is visible.
import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { treeSnapshot } from "./helpers/zip_fixtures";

const REPO = path.resolve(__dirname, "..");
const CLI = path.join(REPO, "scripts", "local-source-cli.js");
const SAMPLE = path.join(REPO, "fixtures", "local-source", "sample-source");
const roots: string[] = [];

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-cli-cleanup-"));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}): Run {
  const result = cp.spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** Same as `run`, without blocking this process (a loopback server lives here). */
function runAsync(args: string[]): Promise<Run> {
  return new Promise((resolve) => {
    const child = cp.spawn(process.execPath, [CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

/** A TMPDIR of the run's own, so leftover scratch can be listed. */
function privateTmpdir(): string {
  const dir = path.join(tmp(), "t");
  fs.mkdirSync(dir);
  return dir;
}

function corpusRoot(): string {
  const root = path.join(tmp(), "root");
  fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, "notes.md"), "# Notes\n\nA single document.\n");
  return root;
}

describe("local-source CLI cleanup on every exit (RC-102)", () => {
  test("REG-WU-067-RC-102-a: a refused bundle write still removes the acquisition scratch", () => {
    const tmpdir = privateTmpdir();
    const out = path.join(tmp(), "out");
    fs.mkdirSync(path.join(out, "bundle"), { recursive: true });
    fs.writeFileSync(path.join(out, "bundle", "previous.json"), "{}\n");
    const before = treeSnapshot(SAMPLE);

    const result = run([SAMPLE, "--name", "sample", "--out", out], { TMPDIR: tmpdir });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("packet bundles are immutable");
    expect(fs.readdirSync(tmpdir).filter((name) => name.startsWith("l9-local-source-"))).toEqual([]);
    expect(treeSnapshot(SAMPLE)).toEqual(before);
  });

  test("REG-WU-067-RC-102-b: a successful run leaves no scratch behind", () => {
    const tmpdir = privateTmpdir();
    const out = path.join(tmp(), "out");
    const result = run([SAMPLE, "--name", "sample", "--out", out], { TMPDIR: tmpdir });
    expect(result.status, result.stderr).toBe(0);
    expect(fs.readdirSync(tmpdir).filter((name) => name.startsWith("l9-local-source-"))).toEqual([]);
  });

  test("REG-WU-067-RC-102-c: a corpus-mode per-root bundle failure removes the bundle scratch", () => {
    const tmpdir = privateTmpdir();
    // Fails only the per-root bundle emission into the CLI's bundle scratch, so
    // the scan itself completes and the failure lands in the cleanup region.
    const preload = path.join(tmp(), "fail-root-bundle.js");
    fs.writeFileSync(preload, [
      `const model = require(${JSON.stringify(path.join(REPO, "dist", "repository_model.js"))});`,
      "const original = model.emitRepositoryModelBundle;",
      "model.emitRepositoryModelBundle = (packet, options) => {",
      "  if (String(options && options.outDir).includes('l9-corpus-bundles-')) {",
      "    throw new Error('simulated per-root bundle emission failure');",
      "  }",
      "  return original(packet, options);",
      "};",
      "",
    ].join("\n"));
    const root = corpusRoot();
    const result = run(
      ["--root", `${root}=root`, "--out", path.join(tmp(), "out"), "--no-cache"],
      { TMPDIR: tmpdir, NODE_OPTIONS: `--require ${preload}` },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("simulated per-root bundle emission failure");
    expect(fs.readdirSync(tmpdir).filter((name) => name.startsWith("l9-corpus-bundles-"))).toEqual([]);
  });
});

describe("--embedding-pair-threshold is a unit-interval cosine (RC-104)", () => {
  const corpusArgs = (root: string, extra: string[]): string[] => [
    "--root", `${root}=root`, "--out", path.join(tmp(), "out"), "--no-cache", ...extra,
  ];

  test("REG-WU-067-RC-104-a: a fractional threshold is accepted", () => {
    const result = run(corpusArgs(corpusRoot(), ["--embedding-pair-threshold", "0.8"]));
    expect(result.stderr).not.toContain("--embedding-pair-threshold");
    expect(result.status).toBe(0);
  });

  test.each(["2", "-0.1", "abc"])("REG-WU-067-RC-104-b: an out-of-range or non-numeric threshold (%s) exits 2", (value) => {
    const result = run(corpusArgs(corpusRoot(), ["--embedding-pair-threshold", value]));
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("--embedding-pair-threshold");
  });

  test.each(["0", "1"])("REG-WU-067-RC-104-d: the bounds (%s) are accepted", (value) => {
    const result = run(corpusArgs(corpusRoot(), ["--embedding-pair-threshold", value]));
    expect(result.status, result.stderr).toBe(0);
  });

  test("REG-WU-067-RC-104-c: the threshold decides which embedding pair is offered", async () => {
    // Two documents whose vectors have cosine 0.9 exactly; anything else is orthogonal.
    const server = http.createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        const text = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input: string }).input.toLowerCase();
        const embedding = text.includes("alpha")
          ? [1, 0, 0]
          : text.includes("bravo")
            ? [0.9, Math.sqrt(1 - 0.81), 0]
            : [0, 0, 1];
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ model: "toy-v1", embedding }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      const url = `http://127.0.0.1:${address.port}/embed`;
      const embeddingCount = async (threshold: string): Promise<number> => {
        const root = path.join(tmp(), "root");
        fs.mkdirSync(root);
        fs.writeFileSync(path.join(root, "first.md"), "# First\n\nThe alpha document.\n");
        fs.writeFileSync(path.join(root, "second.md"), "# Second\n\nThe bravo document.\n");
        const result = await runAsync(corpusArgs(root, [
          "--embeddings",
          "--embedding-provider", "http-json",
          "--embedding-model", "toy",
          "--embedding-endpoint", url,
          "--embedding-locality", "local",
          "--embedding-pair-threshold", threshold,
        ]));
        expect(result.status, result.stderr).toBe(0);
        const match = /relationships\s+\d+ lexical\/structural, (\d+) embedding/.exec(result.stdout);
        expect(match, result.stdout).not.toBeNull();
        return Number((match as RegExpExecArray)[1]);
      };
      expect(await embeddingCount("0.8")).toBe(1);
      expect(await embeddingCount("0.95")).toBe(0);
    } finally {
      server.close();
    }
  });
});
