import * as fs from "node:fs";
import * as path from "node:path";
import { assertTrackedWorktreeCurrent, readTrackedGitSnapshot } from "../src/git_tree";
import {
  cleanupGitFixtures,
  fixtureCommit,
  fixtureGit,
  fixtureRepository,
  fixtureTree,
  setFixtureHead,
} from "./helpers/git_tree_fixtures";

function repo(): { root: string; revision: string; repositoryId: string } {
  const root = fixtureRepository();
  const tree = fixtureTree(root, [{ path: "source.txt", contents: "unchanged source\n" }]);
  const revision = fixtureCommit(root, tree);
  setFixtureHead(root, revision, true);
  return { root, revision, repositoryId: "Owner/Repo" };
}
afterEach(cleanupGitFixtures);

describe("Git control scope does not expand subject inspection", () => {
  test("configuration includes hold without parsing the included payload", () => {
    const input = repo(),
      payload = path.join(input.root, "payload.conf");
    fs.writeFileSync(payload, "this is deliberately not valid Git configuration\n");
    fixtureGit(input.root, ["config", "include.path", payload]);
    expect(() => readTrackedGitSnapshot(input)).toThrow(/configuration includes are unsupported/);
    expect(fs.readFileSync(payload, "utf8")).toBe(
      "this is deliberately not valid Git configuration\n",
    );
  });
  test("configured local filter programs hold currentness while census remains metadata-only", () => {
    const input = repo();
    fixtureGit(input.root, ["config", "filter.example.clean", "cat"]);
    const snapshot = readTrackedGitSnapshot(input);
    expect(snapshot.entries).toHaveLength(1);
    expect(() => assertTrackedWorktreeCurrent(snapshot, input.root)).toThrow(
      /Configured Git filters/,
    );
    expect(fs.readFileSync(path.join(input.root, "source.txt"), "utf8")).toBe("unchanged source\n");
  });
});
