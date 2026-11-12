import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
}));
const hooks = vi.hoisted(() => ({ afterPlan: undefined as undefined | ((root: string) => void) }));
vi.mock("../src/carrier_operation", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/carrier_operation")>();
  return {
    ...original,
    planCarrierOperationAsync: async (
      input: Parameters<typeof original.planCarrierOperationAsync>[0],
    ) => {
      const plan = await original.planCarrierOperationAsync(input);
      hooks.afterPlan?.(plan.root);
      return plan;
    },
  };
});

import { runApplyAsync } from "../src/apply";
import { inventoryTree } from "../src/inventory";
import {
  assertLegacyMetadataIndexWrite,
  compileTrackedMetadataIndex,
  readMetadataIndexBaseBytes,
  readTrackedMetadataIndexBase,
  writeMetadataIndex,
} from "../src/metadata_index";
import type { AuthorityConfig } from "../src/operation_contracts";

const roots: string[] = [];
const sourceBytes =
  "# Repository prompt\n\nRole: auditor\nObjective: inspect the repository.\nOutput format: markdown report.\n";
const authority: AuthorityConfig = {
  schema: "l9.meta-authority/v1",
  writer: { repository: "Quantum-L9/l9-meta-injector", ref: "a".repeat(40) },
  default_carrier: "central_manifest",
  legacy_writers: "forbidden",
  inline_allow: ["**/*.md"],
};
const v2Bytes = compileTrackedMetadataIndex({
  snapshot: {
    repository_id: "Owner/Repo",
    revision: "a".repeat(40),
    tree_oid: "b".repeat(40),
    object_format: "sha1",
    entries: [],
  },
  producerVersion: "4.3.0",
}).bytes;

function fixture(bytes?: string | Buffer, withDirectory = true) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "l9-metadata-admission-races-"));
  roots.push(base);
  const root = path.join(base, "source");
  const out = path.join(base, "out");
  const directory = path.join(root, ".l9");
  const target = path.join(directory, "metadata-index.jsonl");
  fs.mkdirSync(root);
  if (withDirectory) fs.mkdirSync(directory);
  if (bytes !== undefined) fs.writeFileSync(target, bytes);
  fs.writeFileSync(path.join(root, "README.md"), sourceBytes);
  return { base, root, out, directory, target };
}

function atIndexOpen(change: () => void, afterOpen = false): void {
  const original = fs.openSync;
  let changed = false;
  vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
    const match = !changed && path.basename(String(target)) === "metadata-index.jsonl";
    if (match && !afterOpen) {
      changed = true;
      change();
    }
    const descriptor = original(target, flags, mode);
    if (match && afterOpen) {
      changed = true;
      change();
    }
    return descriptor;
  });
}

function afterIndexRead(change: () => void): void {
  const original = fs.readFileSync;
  let changed = false;
  vi.spyOn(fs, "readFileSync").mockImplementation(((
    target: fs.PathOrFileDescriptor,
    ...args: unknown[]
  ) => {
    const result = (original as (...args: unknown[]) => unknown)(target, ...args);
    if (typeof target === "number" && !changed) {
      changed = true;
      change();
    }
    return result;
  }) as typeof fs.readFileSync);
}

function applyConfig(root: string, out: string, glob = "**/*") {
  return {
    root,
    glob,
    outDir: out,
    indexDir: out,
    namespace: "fixture",
    authority: "l9.doctrine.platform",
    nearDupThreshold: 0.9,
    hashPrefixLength: 16,
    verbose: false,
    llmEnabled: false,
    normalizeFilenames: false,
    writeInjectLog: false,
    localFiles: false,
    persistOutputs: false,
  };
}

function govern(root: string): void {
  fs.writeFileSync(
    path.join(root, ".l9", "meta-authority.yaml"),
    [
      "schema: l9.meta-authority/v1",
      "writer:",
      "  repository: Quantum-L9/l9-meta-injector",
      `  ref: ${"a".repeat(40)}`,
      "default_carrier: central_manifest",
      "legacy_writers: forbidden",
      'inline_allow: ["**/*.md"]',
      "",
    ].join("\n"),
  );
}

afterEach(() => {
  hooks.afterPlan = undefined;
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("producer-owned metadata byte observation", () => {
  test.each([false, true])(
    "absence is admitted by direct ENOENT only (directory present: %s)",
    (withDirectory) => {
      const { root } = fixture(undefined, withDirectory);
      vi.spyOn(fs, "existsSync").mockImplementation(() => {
        throw new Error("forbidden existence probe");
      });
      const read = vi.spyOn(fs, "readFileSync");
      expect(readMetadataIndexBaseBytes(root)).toEqual({ exists: false });
      expect(read).not.toHaveBeenCalled();
    },
  );

  test("the target is opened before its pathname is inspected and only FD bytes are read/hashed", () => {
    const { root, target } = fixture("");
    const events: string[] = [];
    const originalOpen = fs.openSync;
    const originalLstat = fs.lstatSync;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
      if (path.basename(String(file)) === "metadata-index.jsonl") {
        events.push("open");
        expect(typeof flags).toBe("number");
        expect(Number(flags) & fs.constants.O_NOFOLLOW).toBe(fs.constants.O_NOFOLLOW);
        expect(Number(flags) & fs.constants.O_NONBLOCK).toBe(fs.constants.O_NONBLOCK);
      }
      return originalOpen(file, flags, mode);
    });
    vi.spyOn(fs, "lstatSync").mockImplementation(((file: fs.PathLike, ...args: unknown[]) => {
      if (String(file) === target) events.push("lstat");
      return (originalLstat as (...args: unknown[]) => unknown)(file, ...args);
    }) as typeof fs.lstatSync);
    const read = vi.spyOn(fs, "readFileSync");
    const observed = readMetadataIndexBaseBytes(root);
    expect(observed).toEqual({
      exists: true,
      raw: Buffer.alloc(0),
      sha256: createHash("sha256").update("").digest("hex"),
    });
    expect(events).toEqual(["open", "lstat", "lstat"]);
    expect(read).toHaveBeenCalledTimes(1);
    expect(typeof read.mock.calls[0][0]).toBe("number");
    expect(readTrackedMetadataIndexBase(root).index).toEqual({
      schema: "l9.metadata-index/v1",
      records: [],
    });
  });

  test.each(["existing", "dangling"])(
    "a final %s symlink substituted at open is never read",
    (kind) => {
      const { base, root, target } = fixture("");
      const outside = path.join(base, "outside");
      if (kind === "existing") fs.writeFileSync(outside, "outside bytes");
      atIndexOpen(() => {
        fs.unlinkSync(target);
        fs.symlinkSync(outside, target);
      });
      const read = vi.spyOn(fs, "readFileSync");
      expect(() => readMetadataIndexBaseBytes(root)).toThrow(/regular file/);
      expect(read).not.toHaveBeenCalled();
      expect(fs.readlinkSync(target)).toBe(outside);
    },
  );

  test("a directory at the final target is refused before reading", () => {
    const { root, target } = fixture();
    fs.mkdirSync(target);
    const read = vi.spyOn(fs, "readFileSync");
    expect(() => readMetadataIndexBaseBytes(root)).toThrow(/regular file/);
    expect(read).not.toHaveBeenCalled();
  });

  test("a file deleted immediately before open is an absent observation", () => {
    const { root, target } = fixture("");
    atIndexOpen(() => fs.unlinkSync(target));
    expect(readMetadataIndexBaseBytes(root)).toEqual({ exists: false });
  });

  test("ENOENT after a successful open is drift, not an absent admission", () => {
    const { root, target } = fixture("");
    atIndexOpen(() => fs.unlinkSync(target), true);
    const read = vi.spyOn(fs, "readFileSync");
    expect(() => readMetadataIndexBaseBytes(root)).toThrow(/ENOENT/);
    expect(read).not.toHaveBeenCalled();
  });

  test("an inode replaced after opening is refused before reading its held bytes", () => {
    const { root, target } = fixture("");
    atIndexOpen(() => {
      fs.renameSync(target, `${target}.old`);
      fs.writeFileSync(target, v2Bytes);
    }, true);
    const read = vi.spyOn(fs, "readFileSync");
    expect(() => readMetadataIndexBaseBytes(root)).toThrow(/target changed/);
    expect(read).not.toHaveBeenCalled();
  });

  test.each(["replace", "rewrite"])(
    "a target %s during the FD read is never returned as a base",
    (change) => {
      const { root, target } = fixture("");
      afterIndexRead(() => {
        if (change === "replace") fs.renameSync(target, `${target}.old`);
        fs.writeFileSync(target, v2Bytes);
      });
      expect(() => readMetadataIndexBaseBytes(root)).toThrow(/target changed/);
      expect(fs.readFileSync(target, "utf8")).toBe(v2Bytes);
    },
  );

  test("a metadata parent replaced at target open fails before any content read", () => {
    const { base, root, directory } = fixture("");
    const outside = path.join(base, "outside");
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, "metadata-index.jsonl"), v2Bytes);
    atIndexOpen(() => {
      fs.renameSync(directory, `${directory}.old`);
      fs.symlinkSync(outside, directory);
    });
    const read = vi.spyOn(fs, "readFileSync");
    expect(() => readMetadataIndexBaseBytes(root)).toThrow(/parent changed/);
    expect(read).not.toHaveBeenCalled();
  });

  test.skipIf(process.platform !== "linux")(
    "Linux parent swap-and-restore cannot redirect the descriptor-relative open",
    () => {
      const { base, root, directory } = fixture("");
      const outside = path.join(base, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "metadata-index.jsonl"), v2Bytes);
      const original = fs.openSync;
      vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
        if (path.basename(String(target)) !== "metadata-index.jsonl")
          return original(target, flags, mode);
        fs.renameSync(directory, `${directory}.old`);
        fs.symlinkSync(outside, directory);
        try {
          return original(target, flags, mode);
        } finally {
          fs.unlinkSync(directory);
          fs.renameSync(`${directory}.old`, directory);
        }
      });
      expect(readTrackedMetadataIndexBase(root).index?.schema).toBe("l9.metadata-index/v1");
    },
  );

  test.each(["root", "metadata"])(
    "dangling %s-directory symlinks are not mistaken for absence",
    (entry) => {
      const { base, root, directory } = fixture(undefined, entry === "root");
      const missing = path.join(base, "missing");
      if (entry === "root") {
        fs.renameSync(root, `${root}.old`);
        fs.symlinkSync(missing, root);
      } else fs.symlinkSync(missing, directory);
      expect(() => readMetadataIndexBaseBytes(root)).toThrow(/real directory/);
    },
  );

  test("non-ENOENT open failures propagate without reading", () => {
    const { root } = fixture("");
    atIndexOpen(() => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    const read = vi.spyOn(fs, "readFileSync");
    expect(() => readMetadataIndexBaseBytes(root)).toThrow(/denied/);
    expect(read).not.toHaveBeenCalled();
  });

  test.skipIf(process.platform !== "linux")(
    "unavailable /proc descriptor namespace is an error, not an absent index",
    () => {
      const { root } = fixture("");
      vi.spyOn(fs, "statSync").mockImplementation(() => {
        throw Object.assign(new Error("namespace missing"), { code: "ENOENT" });
      });
      expect(() => readMetadataIndexBaseBytes(root)).toThrow(/namespace missing/);
    },
  );

  test.each(["read", "fstat"])(
    "every successfully opened descriptor is closed after a %s failure",
    (failure) => {
      const { root } = fixture("");
      const live = new Set<number>();
      const originalOpen = fs.openSync;
      const originalClose = fs.closeSync;
      vi.spyOn(fs, "openSync").mockImplementation((target, flags, mode) => {
        const descriptor = originalOpen(target, flags, mode);
        live.add(descriptor);
        return descriptor;
      });
      vi.spyOn(fs, "closeSync").mockImplementation((descriptor) => {
        live.delete(descriptor);
        originalClose(descriptor);
      });
      const fail = () => {
        throw new Error("injected failure");
      };
      if (failure === "read") vi.spyOn(fs, "readFileSync").mockImplementation(fail);
      else vi.spyOn(fs, "fstatSync").mockImplementation(fail);
      expect(() => readMetadataIndexBaseBytes(root)).toThrow(/injected failure/);
      expect(live.size).toBe(0);
    },
  );
});

describe("shared byte admission preserves version and operation semantics", () => {
  test("corrupt v1 bytes remain repairable by legacy operations but strict tracked reading rejects them", () => {
    const { root } = fixture(Buffer.from([0xff, 0x0a]));
    expect(() =>
      writeMetadataIndex(root, { authority, mode: "apply", subjects: [] }, { dryRun: true }),
    ).not.toThrow();
    expect(() => readTrackedMetadataIndexBase(root)).toThrow();
  });

  test.each([
    v2Bytes,
    'damaged "schema": "l9.metadata-index/v2"\n',
    '{"schema":"l9.metadata-index/v3"}\n',
  ])("legacy admission never downgrades an explicit version marker", (bytes) => {
    const { root } = fixture(bytes);
    expect(() => assertLegacyMetadataIndexWrite(bytes)).toThrow(/downgrade/);
    expect(() =>
      writeMetadataIndex(root, { authority, mode: "apply", subjects: [] }, { dryRun: true }),
    ).toThrow(/downgrade/);
  });

  test("empty v2 retains its header and cannot be treated as empty v1", () => {
    const { root } = fixture(v2Bytes);
    const base = readTrackedMetadataIndexBase(root);
    expect(base.index?.schema).toBe("l9.metadata-index/v2");
    expect(base.index?.records).toEqual([]);
    expect(base.bytes).toBe(v2Bytes);
  });

  test("inventory's shared admission refuses a swap before source/carrier/output changes", () => {
    const { base, root, out, target } = fixture("");
    const outside = path.join(base, "outside-index");
    fs.writeFileSync(outside, v2Bytes);
    atIndexOpen(() => {
      fs.unlinkSync(target);
      fs.symlinkSync(outside, target);
    });
    expect(() => inventoryTree({ root, outDir: out })).toThrow(/regular file/);
    expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe(sourceBytes);
    expect(fs.readFileSync(outside, "utf8")).toBe(v2Bytes);
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.existsSync(path.join(root, ".l9meta.yaml"))).toBe(false);
  });

  test.each(["**/*", "README.md"])(
    "apply refuses a concurrently introduced v2 without source mutation (scope %s)",
    async (glob) => {
      const { root, out, target } = fixture("");
      govern(root);
      fs.writeFileSync(path.join(root, "other.md"), "# Other documentation\n\nExact bytes.\n");
      hooks.afterPlan = () => fs.writeFileSync(target, v2Bytes);
      await expect(runApplyAsync(applyConfig(root, out, glob))).rejects.toThrow(/downgrade/);
      expect(fs.readFileSync(target, "utf8")).toBe(v2Bytes);
      expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toBe(sourceBytes);
      expect(fs.readFileSync(path.join(root, "other.md"), "utf8")).toBe(
        "# Other documentation\n\nExact bytes.\n",
      );
      expect(fs.existsSync(out)).toBe(false);
      expect(fs.existsSync(path.join(root, ".l9", ".transactions"))).toBe(false);
    },
  );
});
