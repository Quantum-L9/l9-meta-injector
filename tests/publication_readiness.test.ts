import * as fs from "fs";
import * as path from "path";

describe("publication decision", () => {
  test("decision is internally coherent and fail-closed", () => {
    const doc = JSON.parse(
      fs.readFileSync(path.join(process.cwd(), "docs/package-publication-decision.json"), "utf8"),
    );
    expect(doc.schema).toBe("l9.package-publication-decision/v1");
    expect(doc.package_name).toBe("l9-meta-injector");
    expect(doc.package_version).toBe("3.0.0");
    expect(doc.publication_command).toBe("npm publish");
    expect(Array.isArray(doc.evidence)).toBe(true);
    expect(doc.evidence.length).toBeGreaterThan(0);
    const resolved = doc.evidence.every((item: { status: string; result: string }) =>
      ["verified", "not_applicable_with_reason"].includes(item.status) &&
      typeof item.result === "string" && item.result.trim().length > 0,
    );
    if (doc.status === "approved") {
      expect(resolved).toBe(true);
    } else {
      expect(doc.status).toBe("blocked_pending_history_check");
      expect(resolved).toBe(false);
    }
  });
});
