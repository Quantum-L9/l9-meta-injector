import { trackedPathIdentity, decodeTrackedPathIdentity, resolveNamespace, compareTrackedPaths, decodeTrackedPathBytes } from "../src/namespace";

const encoded = (path: string | Buffer): string => Buffer.from(path).toString("base64");

describe("v2 exact reversible tracked identities", () => {
  const paths = ["a-b.md", "a_b.md", "a/b.md", "A.md", "a.md", "é.md", "e\u0301.md", "u00e9.md", "tab\t.md", "line\n.md", "back\\slash", Buffer.from([0xff, 0xfe])];
  test("G03-G04 preserves case, combining forms, segments, punctuation and invalid UTF-8 bytes", () => {
    const ids = paths.map((path) => trackedPathIdentity("Owner/Repo", encoded(path)));
    expect(new Set(ids).size).toBe(paths.length);
    ids.forEach((id, index) => { expect(decodeTrackedPathIdentity(id)).toEqual({ repositoryId: "Owner/Repo", pathBytesBase64: encoded(paths[index]) }); });
    expect(trackedPathIdentity("Owner/Repo", encoded("a.md"))).not.toBe(trackedPathIdentity("owner/repo", encoded("a.md")));
    expect(trackedPathIdentity("é", encoded("a.md"))).not.toBe(trackedPathIdentity("e\u0301", encoded("a.md")));
  });
  test("IDs do not depend on sibling population, revision, root, or content", () => {
    expect(trackedPathIdentity("r", encoded("A.md"))).toBe(trackedPathIdentity("r", encoded("A.md")));
    expect(decodeTrackedPathIdentity(trackedPathIdentity("r.x/y", encoded("x/y")))).toEqual({ repositoryId: "r.x/y", pathBytesBase64: encoded("x/y") });
  });
  test("v1 collisions remain unchanged and explicitly legacy", () => {
    const legacy = (path: string): string => resolveNamespace(path, { namespace: "l9" }, "unknown").idStem;
    expect(legacy("a-b.md")).toBe(legacy("a_b.md"));
    expect(legacy("é.md")).toBe(legacy("e\u0301.md"));
    expect(legacy("A.md")).toBe(legacy("a.md"));
  });
  test("canonical tuple/base64 validation refuses aliases and replacement decoding", () => {
    expect(() => decodeTrackedPathBytes("YR==")).toThrow(/canonical/);
    expect(() => decodeTrackedPathBytes("YQ")).toThrow(/canonical/);
    expect(() => trackedPathIdentity("x\ud800", "YQ==")).toThrow(/UTF-8/);
    expect(() => trackedPathIdentity("", "YQ==")).toThrow(/portable/);
    expect(() => decodeTrackedPathIdentity("l9.path/v1:YQ.YQ")).toThrow(/version/);
    expect(() => decodeTrackedPathIdentity("l9.path/v2:YQ.YR")).toThrow(/noncanonical/);
  });
  test("canonical path order is unsigned exact bytes rather than encoded or locale order", () => {
    const values = ["é", "Z", "a", "e\u0301"].map((path) => ({ path_bytes_base64: encoded(path) }));
    const expected = values.map((item) => Buffer.from(item.path_bytes_base64, "base64")).sort(Buffer.compare).map((raw) => raw.toString("base64"));
    expect(values.sort(compareTrackedPaths).map((item) => item.path_bytes_base64)).toEqual(expected);
  });
});
