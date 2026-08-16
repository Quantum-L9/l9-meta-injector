import { describe, expect, test } from "vitest";
import {
  META_AUTHORITY_SCHEMA,
  OPERATION_MODES,
  assertAuthorityForOperation,
  isAuthorityConfig,
  isSupportedAuthoritySchema,
  operationRequiresAuthority,
  resolveOperationMode,
  type AuthorityConfig,
} from "../src/operation_contracts";

const authority: AuthorityConfig = {
  schema: META_AUTHORITY_SCHEMA,
  writer: { repository: "Quantum-L9/l9-meta-injector", ref: "v4.0.0" },
  default_carrier: "central_manifest",
  legacy_writers: "forbidden",
  inline_allow: ["prompts/**/*.md", "kernels/**/*.md"],
};

describe("operation contracts", () => {
  test("canonical modes are exhaustive and stable", () => {
    expect(OPERATION_MODES).toEqual(["inventory", "check", "apply", "skills"]);
  });

  test.each(OPERATION_MODES)("resolves canonical mode %s", (mode) => {
    expect(resolveOperationMode(mode)).toEqual({ requested: mode, mode });
  });

  test("maps pipeline only as an explicit deprecated alias", () => {
    expect(resolveOperationMode("pipeline")).toEqual({
      requested: "pipeline",
      mode: "apply",
      deprecatedAlias: "pipeline",
      warning: "operation mode 'pipeline' is deprecated; use 'apply'",
    });
  });

  test("rejects unknown and empty modes instead of falling back", () => {
    expect(() => resolveOperationMode("other")).toThrow("unsupported operation mode");
    expect(() => resolveOperationMode(" ")).toThrow("<empty>");
  });

  test("requires authority for check, apply, and skills (not inventory)", () => {
    expect(operationRequiresAuthority("inventory")).toBe(false);
    expect(operationRequiresAuthority("skills")).toBe(true);
    expect(operationRequiresAuthority("check")).toBe(true);
    expect(operationRequiresAuthority("apply")).toBe(true);
    expect(assertAuthorityForOperation("inventory", undefined)).toBeUndefined();
    expect(() => assertAuthorityForOperation("check", undefined)).toThrow("requires .l9/meta-authority.yaml");
    expect(() => assertAuthorityForOperation("skills", undefined)).toThrow("requires .l9/meta-authority.yaml");
    expect(assertAuthorityForOperation("apply", authority)).toBe(authority);
    expect(assertAuthorityForOperation("skills", authority)).toBe(authority);
  });

  test("validates the supported authority schema and structure", () => {
    expect(isSupportedAuthoritySchema(META_AUTHORITY_SCHEMA)).toBe(true);
    expect(isSupportedAuthoritySchema("l9.meta-authority/v2")).toBe(false);
    expect(isAuthorityConfig(authority)).toBe(true);
    expect(isAuthorityConfig({ ...authority, writer: { repository: "invalid", ref: "v4" } })).toBe(false);
    expect(isAuthorityConfig({ ...authority, schema: "l9.meta-authority/v2" })).toBe(false);
    expect(isAuthorityConfig({ ...authority, extra: true })).toBe(false);
    expect(isAuthorityConfig({ ...authority, writer: { ...authority.writer, extra: true } })).toBe(false);
    expect(isAuthorityConfig({ ...authority, inline_allow: ["prompts/**/*.md", "prompts/**/*.md"] })).toBe(false);
  });
});
