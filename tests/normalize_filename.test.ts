import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { normalizeFilename, normalizeFilenameWithLog } from "../src/normalize_filename";

describe("normalizeFilename", () => {
  it("lowercases and snake_cases", () => { const r = normalizeFilename("/p/LintFile.md"); expect(r.normalizedName).toBe("lint_file.md"); expect(r.changed).toBe(true); });
  it("hyphens → underscores", () => expect(normalizeFilename("/p/text-chunk-skill.md").normalizedName).toBe("text_chunk_skill.md"));
  it("preserves dot-convention prefix", () => expect(normalizeFilename("/p/l9.skill.LintFile.md").normalizedName).toBe("l9.skill.lint_file.md"));
  it("preserves Prompt- prefix", () => expect(normalizeFilename("/p/Prompt-AuditAgent.md").normalizedName).toBe("Prompt-audit_agent.md"));
  it("no change when already snake", () => expect(normalizeFilename("/p/lint_file.md").changed).toBe(false));
});

describe("normalizeFilenameWithLog", () => {
  it("writes sidecar .normalize.log.yaml (dry-run)", () => {
    const tmp = path.join(os.tmpdir(), `CamelFile_${Date.now()}.md`);
    fs.writeFileSync(tmp, "# content");
    const r = normalizeFilenameWithLog(tmp, { dryRun: true, verbose: false });
    expect(r.changed).toBe(true);
    expect(fs.existsSync(r.sidecarPath)).toBe(true);
    const log = fs.readFileSync(r.sidecarPath, "utf8");
    expect(log).toContain("original:");
    expect(log).toContain("dry_run: true");
    fs.unlinkSync(tmp); fs.unlinkSync(r.sidecarPath);
  });
  it("does NOT rename in dry-run", () => {
    const tmp = path.join(os.tmpdir(), `CamelRename_${Date.now()}.md`);
    fs.writeFileSync(tmp, "# content");
    normalizeFilenameWithLog(tmp, { dryRun: true, verbose: false });
    expect(fs.existsSync(tmp)).toBe(true);
    const sc = tmp + ".normalize.log.yaml";
    if (fs.existsSync(sc)) fs.unlinkSync(sc);
    fs.unlinkSync(tmp);
  });
});
