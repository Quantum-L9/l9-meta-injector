// corpus_candidates.test.ts — project and topic candidates, and what they refuse to say.
//
// Both groupings are deterministic, both are labelled candidates, and both are
// easy to over-read. The assertions below are as much about the second property
// as the first: a container that holds a marker is a project *candidate*, and a
// set of documents sharing vocabulary is a topic *candidate*. Neither is allowed
// to acquire a rank, a name chosen for it, or a merge recommendation.
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TOPIC_THRESHOLD,
  TOPIC_MIN_TOKENS,
  buildProjectCandidates,
  buildTopicCandidates,
  candidateProfileHash,
  containerOf,
  isUnderContainer,
  projectContainerForMarker,
  readDeclaredIdentifier,
  readsDeclaredIdentifier,
} from "../src/corpus_candidates";

const rootLabels = new Map([
  ["root:a", "OldSSD"],
  ["root:b", "Backup"],
]);

function member(rootId: string, label: string, relative: string) {
  return {
    virtual_source_id: `vsrc:${rootId}:${relative}`,
    root_id: rootId,
    root_relative_path: relative,
    corpus_path: `${label}::${relative}`,
  };
}

function marker(
  rootId: string,
  label: string,
  relative: string,
  declared?: string,
  kind: "build_manifest" | "ci_definition" = "build_manifest",
) {
  return {
    ...member(rootId, label, relative),
    marker_kind: kind,
    ...(declared !== undefined
      ? { declared_identifier: declared, declared_identifier_evidence: { field: "name", line: 2 } }
      : {}),
  };
}

describe("container arithmetic", () => {
  it("puts an archive member's container at the archive it came from", () => {
    expect(containerOf("bundle.zip!/notes.md")).toBe("bundle.zip!/");
    expect(containerOf("bundle.zip!/pkg/notes.md")).toBe("bundle.zip!/pkg");
    expect(containerOf("notes.md")).toBe("");
    expect(containerOf("a/b/notes.md")).toBe("a/b");
  });

  it("resolves a CI definition to the directory that holds its dot-directory", () => {
    expect(projectContainerForMarker("svc/.github/workflows/ci.yml")).toBe("svc");
    expect(projectContainerForMarker(".github/workflows/ci.yml")).toBe("");
    expect(projectContainerForMarker("svc/.circleci/config.yml")).toBe("svc");
    expect(projectContainerForMarker("svc/package.json")).toBe("svc");
  });

  it("treats the root container as holding everything, and a prefix as a whole segment", () => {
    expect(isUnderContainer("", "anything/at/all.md")).toBe(true);
    expect(isUnderContainer("svc", "svc/src/a.ts")).toBe(true);
    expect(isUnderContainer("svc", "svc")).toBe(true);
    expect(isUnderContainer("svc", "svc-other/a.ts")).toBe(false);
  });
});

describe("declared identifiers", () => {
  it("come from the manifest body with the line that declared them", () => {
    expect(readDeclaredIdentifier("package.json", '{\n  "name": "widget-api"\n}\n')).toEqual({
      identifier: "widget-api",
      field: "name",
      line: 2,
    });
    expect(readDeclaredIdentifier("go.mod", "module example.com/widget\n\ngo 1.22\n")).toEqual({
      identifier: "example.com/widget",
      field: "module",
      line: 1,
    });
    expect(
      readDeclaredIdentifier("pyproject.toml", '[project]\nname = "widget"\nversion = "1"\n'),
    ).toEqual({ identifier: "widget", field: "project.name", line: 2 });
    expect(readDeclaredIdentifier("Cargo.toml", '[package]\nname = "widget-rs"\n')).toEqual({
      identifier: "widget-rs",
      field: "package.name",
      line: 2,
    });
    expect(
      readDeclaredIdentifier("pom.xml", "<project>\n  <artifactId>widget</artifactId>\n</project>\n"),
    ).toEqual({ identifier: "widget", field: "artifactId", line: 2 });
  });

  it("yield nothing rather than guessing", () => {
    expect(readDeclaredIdentifier("package.json", "{ not json")).toBeUndefined();
    expect(readDeclaredIdentifier("package.json", '{"version": "1.0.0"}')).toBeUndefined();
    expect(readDeclaredIdentifier("pyproject.toml", '[tool.black]\nname = "not-the-project"\n')).toBeUndefined();
    expect(readDeclaredIdentifier("Makefile", "all:\n\techo hi\n")).toBeUndefined();
    expect(readsDeclaredIdentifier("Makefile")).toBe(false);
    expect(readsDeclaredIdentifier("PACKAGE.JSON")).toBe(true);
  });
});

describe("project candidates", () => {
  it("join containers across roots when both declare the same identifier", () => {
    const candidates = buildProjectCandidates({
      markers: [
        marker("root:a", "OldSSD", "widget/package.json", "widget-api"),
        marker("root:b", "Backup", "old/widget-copy/package.json", "widget-api"),
      ],
      members: [
        member("root:a", "OldSSD", "widget/package.json"),
        member("root:a", "OldSSD", "widget/src/a.ts"),
        member("root:b", "Backup", "old/widget-copy/package.json"),
        member("root:b", "Backup", "old/widget-copy/src/a.ts"),
      ],
      rootLabels,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].project_key).toBe("project:widget-api");
    expect(candidates[0].identifier_is_declared).toBe(true);
    expect(candidates[0].spans_roots).toBe(true);
    expect(candidates[0].member_count).toBe(4);
    expect(candidates[0].root_ids).toEqual(["root:a", "root:b"]);
  });

  it("fall back to the container's own directory name, which also crosses roots", () => {
    const candidates = buildProjectCandidates({
      markers: [
        marker("root:a", "OldSSD", "widget/Makefile"),
        marker("root:b", "Backup", "archive/widget/Makefile"),
      ],
      members: [
        member("root:a", "OldSSD", "widget/Makefile"),
        member("root:b", "Backup", "archive/widget/Makefile"),
      ],
      rootLabels,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].project_key).toBe("container:widget");
    expect(candidates[0].identifier_is_declared).toBe(false);
    expect(candidates[0].spans_roots).toBe(true);
  });

  it("give a nested project its own files rather than its parent's", () => {
    const candidates = buildProjectCandidates({
      markers: [
        marker("root:a", "OldSSD", "repo/package.json", "monorepo"),
        marker("root:a", "OldSSD", "repo/packages/api/package.json", "api"),
      ],
      members: [
        member("root:a", "OldSSD", "repo/package.json"),
        member("root:a", "OldSSD", "repo/tools/build.ts"),
        member("root:a", "OldSSD", "repo/packages/api/package.json"),
        member("root:a", "OldSSD", "repo/packages/api/src/index.ts"),
      ],
      rootLabels,
    });
    const byKey = new Map(candidates.map((candidate) => [candidate.project_key, candidate]));
    expect(byKey.get("project:api")?.member_count).toBe(2);
    expect(byKey.get("project:monorepo")?.member_count).toBe(2);
    expect(byKey.get("project:monorepo")?.member_ids).not.toContain(
      "vsrc:root:a:repo/packages/api/src/index.ts",
    );
  });

  it("key a root-level container by its root, so two disks do not merge by accident", () => {
    const candidates = buildProjectCandidates({
      markers: [marker("root:a", "OldSSD", "Makefile"), marker("root:b", "Backup", "Makefile")],
      members: [member("root:a", "OldSSD", "Makefile"), member("root:b", "Backup", "Makefile")],
      rootLabels,
    });
    expect(candidates.map((candidate) => candidate.project_key).sort()).toEqual([
      "container:Backup",
      "container:OldSSD",
    ]);
    expect(candidates.every((candidate) => candidate.spans_roots === false)).toBe(true);
  });

  it("treat a CI definition as a project marker on its own", () => {
    const candidates = buildProjectCandidates({
      markers: [marker("root:a", "OldSSD", "svc/.github/workflows/ci.yml", undefined, "ci_definition")],
      members: [
        member("root:a", "OldSSD", "svc/.github/workflows/ci.yml"),
        member("root:a", "OldSSD", "svc/main.go"),
      ],
      rootLabels,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].containers[0].marker_kinds).toEqual(["ci_definition"]);
    expect(candidates[0].member_count).toBe(2);
  });
});

describe("topic candidates", () => {
  const routing = "routing table regeneration upstream dependency verified against recorded fixture staging promotion";
  const baking = "sourdough starter hydration levain bulk fermentation banneton proofing oven spring crumb";

  function document(id: string, text: string, repeat = 3) {
    const tokens = Array.from({ length: repeat }, () => text).join(" ").split(/\s+/);
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    return {
      virtual_source_id: id,
      corpus_path: `R::${id}.md`,
      term_counts: [...counts.entries()].sort(),
      token_count: tokens.length,
    };
  }

  it("group documents that share salient vocabulary and separate ones that do not", () => {
    const documents = [
      document("a", routing),
      document("b", `${routing} extra words about deployment promotion`),
      document("c", baking),
      document("d", `${baking} more words about hydration and crumb`),
    ];
    const { candidates } = buildTopicCandidates({
      documents,
      rootById: new Map(documents.map((d) => [d.virtual_source_id, "root:a"])),
    });
    expect(candidates).toHaveLength(2);
    const groups = candidates.map((candidate) => [...candidate.member_ids].sort().join(","));
    expect(groups.sort()).toEqual(["a,b", "c,d"]);
    for (const candidate of candidates) {
      expect(candidate.threshold).toBe(DEFAULT_TOPIC_THRESHOLD);
      expect(candidate.shared_terms.length).toBeGreaterThan(0);
      expect(candidate.method).toBe("lexical-topic-candidate/v1");
    }
  });

  it("do not score a document below the minimum token count", () => {
    const short = { ...document("short", "one two three", 1), token_count: TOPIC_MIN_TOKENS - 1 };
    const { candidates } = buildTopicCandidates({
      documents: [short, { ...short, virtual_source_id: "short2", corpus_path: "R::short2.md" }],
      rootById: new Map(),
    });
    expect(candidates).toEqual([]);
  });

  it("report when a topic crosses a root boundary", () => {
    const documents = [document("a", routing), document("b", routing + " deployment")];
    const { candidates } = buildTopicCandidates({
      documents,
      rootById: new Map([
        ["a", "root:a"],
        ["b", "root:b"],
      ]),
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].spans_roots).toBe(true);
    expect(candidates[0].root_ids).toEqual(["root:a", "root:b"]);
  });

  it("join every eligible document at a threshold of zero, including disjoint ones", () => {
    // At zero every pair qualifies by definition. The salient-term index can only
    // reach pairs that share a term, so the zero case needs its own answer or it
    // silently under-reports — the same reason the near-duplicate pass keeps an
    // exhaustive path at zero.
    const documents = [document("a", routing), document("b", baking)];
    expect(buildTopicCandidates({ documents, rootById: new Map(), threshold: 0.35 }).candidates)
      .toEqual([]);
    const { candidates: joined } = buildTopicCandidates({ documents, rootById: new Map(), threshold: 0 });
    expect(joined).toHaveLength(1);
    expect([...joined[0].member_ids].sort()).toEqual(["a", "b"]);
    expect(joined[0].threshold).toBe(0);
  });

  it("give the same set of members the same candidate id, whatever order they arrive in", () => {
    const documents = [document("a", routing), document("b", `${routing} deployment`)];
    const { candidates: forward } = buildTopicCandidates({ documents, rootById: new Map() });
    const { candidates: backward } = buildTopicCandidates({
      documents: [...documents].reverse(), rootById: new Map(),
    });
    expect(backward[0].candidate_id).toBe(forward[0].candidate_id);
  });
});

describe("the candidate profile hash", () => {
  it("changes when a threshold changes and not otherwise", () => {
    const base = candidateProfileHash({ topicThreshold: 0.35, nearDuplicateThreshold: 0.85 });
    expect(candidateProfileHash({ topicThreshold: 0.35, nearDuplicateThreshold: 0.85 })).toBe(base);
    expect(candidateProfileHash({ topicThreshold: 0.4, nearDuplicateThreshold: 0.85 })).not.toBe(base);
    expect(candidateProfileHash({ topicThreshold: 0.35, nearDuplicateThreshold: 0.9 })).not.toBe(base);
  });
});
