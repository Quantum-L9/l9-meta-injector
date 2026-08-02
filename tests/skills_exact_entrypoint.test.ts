import { isSkillArtifactPath } from "../src/omit";

describe("skills mode entrypoint", () => {
  test("matches only the canonical SKILL.md basename", () => {
    expect(isSkillArtifactPath("skills/github/SKILL.md")).toBe(true);
    expect(isSkillArtifactPath("skills/github/skill.MD")).toBe(true);
    expect(isSkillArtifactPath("skills/github/README.md")).toBe(false);
    expect(isSkillArtifactPath("skills/github/helper.skill.md")).toBe(false);
    expect(isSkillArtifactPath("skill-notes.md")).toBe(false);
    expect(isSkillArtifactPath("skills/github/examples/example.md")).toBe(false);
  });
});
