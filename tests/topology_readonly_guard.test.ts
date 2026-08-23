// topology_readonly_guard.test.ts — this repository does not write into another.
//
// `scripts/topology-conformance.js` spawns a Python interpreter with another
// repository's source on its path and asks it to load our packets. The comment
// said the checkout is read-only. It was a sentence, not a mechanism, and an
// interpreter is perfectly capable of writing: a bytecode cache beside a module,
// a log, a state file an adapter persists on import. Any of those would be this
// repository modifying somebody else's, discovered later by whoever ran
// `git status` in the other checkout and found changes they did not make.
//
// The script now digests the checkout before and after and fails the run if
// anything moved. This file holds that guard to its job — against a real
// directory tree, with real writes — because the conformance script itself needs
// a topology checkout and a Python toolchain to run, and a guard nothing
// exercises is a guard nobody knows is broken.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const guard = require("../scripts/topology-conformance.js") as {
  checkoutDigest(root: string): { digest: string; entries: Record<string, string> };
  dropPycache(root: string): void;
  mutatedCheckoutPaths(
    before: Record<string, string>,
    after: Record<string, string>,
  ): string[];
};

const scratch: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "l9-topology-guard-"));
  scratch.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

/** A tree shaped like the consumer checkout, minus the consumer. */
function fakeCheckout(): string {
  const root = tmp();
  fs.mkdirSync(path.join(root, "src", "l9_constellation_topology", "packets"), { recursive: true });
  fs.writeFileSync(
    path.join(root, "src", "l9_constellation_topology", "__init__.py"),
    '"""Consumer package."""\n',
    "utf8",
  );
  fs.writeFileSync(
    path.join(root, "src", "l9_constellation_topology", "packets", "loader.py"),
    "def load_repository_model_bundle(path):\n    return path\n",
    "utf8",
  );
  fs.writeFileSync(path.join(root, "pyproject.toml"), '[project]\nname = "topology"\n', "utf8");
  fs.mkdirSync(path.join(root, ".git"), { recursive: true });
  fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
  return root;
}

describe("the checkout digest", () => {
  it("is stable across two reads of an untouched tree", () => {
    const root = fakeCheckout();
    expect(guard.checkoutDigest(root).digest).toBe(guard.checkoutDigest(root).digest);
  });

  it("notices a file that changed, appeared, or vanished", () => {
    const root = fakeCheckout();
    const before = guard.checkoutDigest(root);

    const module_ = path.join(root, "src", "l9_constellation_topology", "packets", "loader.py");
    fs.appendFileSync(module_, "# touched by somebody else's test run\n", "utf8");
    let mutated = guard.mutatedCheckoutPaths(before.entries, guard.checkoutDigest(root).entries);
    expect(mutated).toEqual(["src/l9_constellation_topology/packets/loader.py"]);

    fs.writeFileSync(module_, "def load_repository_model_bundle(path):\n    return path\n", "utf8");
    expect(guard.checkoutDigest(root).digest).toBe(before.digest);

    fs.writeFileSync(path.join(root, "probe.log"), "written by the probe\n", "utf8");
    mutated = guard.mutatedCheckoutPaths(before.entries, guard.checkoutDigest(root).entries);
    expect(mutated).toEqual(["probe.log"]);
    fs.rmSync(path.join(root, "probe.log"));

    fs.rmSync(path.join(root, "pyproject.toml"));
    mutated = guard.mutatedCheckoutPaths(before.entries, guard.checkoutDigest(root).entries);
    expect(mutated).toEqual(["pyproject.toml"]);
  });

  it("notices a permission bit even when the bytes did not move", () => {
    const root = fakeCheckout();
    const before = guard.checkoutDigest(root);
    const target = path.join(root, "pyproject.toml");
    fs.chmodSync(target, 0o600);
    // A run that left the bytes alone and changed a mode has still modified
    // somebody else's repository.
    expect(guard.mutatedCheckoutPaths(before.entries, guard.checkoutDigest(root).entries))
      .toEqual(["pyproject.toml"]);
  });

  it("ignores git's own bookkeeping, which changes when git is merely asked a question", () => {
    const root = fakeCheckout();
    const before = guard.checkoutDigest(root);
    fs.writeFileSync(path.join(root, ".git", "index"), "binary-ish\n", "utf8");
    fs.mkdirSync(path.join(root, ".git", "objects", "ab"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "objects", "ab", "cdef"), "object\n", "utf8");
    // `git rev-parse HEAD` is the first thing the harness runs, and git is
    // entitled to touch its own store while answering. That is not this
    // repository writing into the consumer's source.
    expect(guard.mutatedCheckoutPaths(before.entries, guard.checkoutDigest(root).entries))
      .toEqual([]);
  });
});

describe("the bytecode caches an interpreter leaves behind", () => {
  it("are removed before the comparison rather than tolerated in it", () => {
    const root = fakeCheckout();
    const before = guard.checkoutDigest(root);

    // What CPython actually writes when it imports a module.
    const cache = path.join(root, "src", "l9_constellation_topology", "packets", "__pycache__");
    fs.mkdirSync(cache, { recursive: true });
    fs.writeFileSync(path.join(cache, "loader.cpython-311.pyc"), "compiled\n", "utf8");
    const nested = path.join(root, "src", "l9_constellation_topology", "__pycache__");
    fs.mkdirSync(nested, { recursive: true });
    fs.writeFileSync(path.join(nested, "__init__.cpython-311.pyc"), "compiled\n", "utf8");

    guard.dropPycache(root);

    expect(fs.existsSync(cache)).toBe(false);
    expect(fs.existsSync(nested)).toBe(false);
    // And what the harness compares is then identical to what it started with,
    // so a real write is not lost in the noise of a bytecode cache.
    expect(guard.checkoutDigest(root).digest).toBe(before.digest);
    expect(guard.mutatedCheckoutPaths(before.entries, guard.checkoutDigest(root).entries))
      .toEqual([]);
  });

  it("does not take anything else with them", () => {
    const root = fakeCheckout();
    // A directory whose name merely contains the word is not a bytecode cache.
    const decoy = path.join(root, "src", "my__pycache__helper");
    fs.mkdirSync(decoy, { recursive: true });
    fs.writeFileSync(path.join(decoy, "keep.py"), "KEEP = 1\n", "utf8");
    guard.dropPycache(root);
    expect(fs.existsSync(path.join(decoy, "keep.py"))).toBe(true);
    // And the consumer's own source is untouched by the cleanup.
    expect(fs.existsSync(path.join(root, "src", "l9_constellation_topology", "__init__.py")))
      .toBe(true);
  });
});
