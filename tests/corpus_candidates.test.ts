// corpus_candidates.test.ts — project and topic candidates, and what they refuse to say.
//
// Both groupings are deterministic, both are labelled candidates, and both are
// easy to over-read. The assertions below are as much about the second property
// as the first: a container that holds a marker is a project *candidate*, and a
// set of documents sharing vocabulary is a topic *candidate*. Neither is allowed
// to acquire a rank, a name chosen for it, or a merge recommendation.
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MemoryCorpusCache, normalizedDocumentKey } from "../src/corpus_cache";
import { MANIFEST_DECODER_ID, MANIFEST_DECODER_VERSION, runCorpusScan } from "../src/corpus_scan";
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

  it("REG-WU-047-RC-073-a: resolves an archive-root CI definition to the archive, spelled as containerOf spells it", () => {
    expect(projectContainerForMarker("p.zip!/.github/workflows/ci.yml")).toBe("p.zip!/");
    expect(containerOf("p.zip!/package.json")).toBe("p.zip!/");
    expect(projectContainerForMarker("p.zip!/.github/workflows/ci.yml"))
      .toBe(projectContainerForMarker("p.zip!/package.json"));
    // A nested archive's member root is spelled the same way.
    expect(projectContainerForMarker("a.zip!/b.zip!/.github/workflows/x.yml")).toBe("a.zip!/b.zip!/");
    expect(containerOf("a.zip!/b.zip!/package.json")).toBe("a.zip!/b.zip!/");
  });

  it("REG-WU-047-RC-073-b: resolves an archive-root .circleci definition to the archive", () => {
    expect(projectContainerForMarker("p.zip!/.circleci/config.yml")).toBe("p.zip!/");
  });

  it("REG-WU-047-RC-073-d: leaves directory and nested-archive-directory CI containers unchanged", () => {
    expect(projectContainerForMarker("svc/.github/workflows/ci.yml")).toBe("svc");
    expect(projectContainerForMarker(".github/workflows/ci.yml")).toBe("");
    expect(projectContainerForMarker("bundle.zip!/pkg/.github/workflows/x.yml")).toBe("bundle.zip!/pkg");
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

  it("REG-WU-047-RC-075-a: read a pom's own artifactId, not its parent's", () => {
    const pom = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<project xmlns="http://maven.apache.org/POM/4.0.0">',
      "  <modelVersion>4.0.0</modelVersion>",
      "  <parent>",
      "    <groupId>org.springframework.boot</groupId>",
      "    <artifactId>spring-boot-starter-parent</artifactId>",
      "    <version>3.2.0</version>",
      "  </parent>",
      "  <!-- <artifactId>commented-out</artifactId> -->",
      "  <groupId>com.example</groupId>",
      "  <artifactId>billing-service</artifactId>",
      "  <dependencies>",
      "    <dependency><artifactId>lib</artifactId></dependency>",
      "  </dependencies>",
      "</project>",
      "",
    ].join("\n");
    expect(readDeclaredIdentifier("pom.xml", pom)).toEqual({
      identifier: "billing-service",
      field: "artifactId",
      line: 11,
    });
  });

  it("REG-WU-047-RC-075-a: skip comments, CDATA and self-closing elements when finding the project's artifactId", () => {
    const pom = [
      "<project>",
      "  <!-- <artifactId>in-a-comment</artifactId> -->",
      "  <parent/>",
      "  <description><![CDATA[ <artifactId>in-cdata</artifactId> ]]></description>",
      '  <build><plugins><plugin><artifactId>maven-compiler-plugin</artifactId></plugin></plugins></build>',
      "  <artifactId>real-one</artifactId>",
      "</project>",
    ].join("\n");
    expect(readDeclaredIdentifier("pom.xml", pom)).toEqual({
      identifier: "real-one",
      field: "artifactId",
      line: 6,
    });
  });

  it("REG-WU-047-RC-075-b: yield nothing for a pom whose only artifactId is a dependency's", () => {
    const pom = [
      "<project>",
      "  <dependencies>",
      "    <dependency>",
      "      <artifactId>some-library</artifactId>",
      "    </dependency>",
      "  </dependencies>",
      "</project>",
    ].join("\n");
    expect(readDeclaredIdentifier("pom.xml", pom)).toBeUndefined();
  });

  it("REG-WU-047-RC-075-c: cite the line of the top-level name, not a nested one", () => {
    const json = [
      "{",
      '  "author": {',
      '    "name": "Somebody"',
      "  },",
      '  "name": "real-package"',
      "}",
    ].join("\n");
    expect(readDeclaredIdentifier("package.json", json)).toEqual({
      identifier: "real-package",
      field: "name",
      line: 5,
    });
    // A nested key that merely mentions the field inside a string is not it either.
    const tricky = '{\n  "description": "\\"name\\": nope",\n  "x": ["name"],\n  "name": "ok"\n}';
    expect(readDeclaredIdentifier("composer.json", tricky)).toEqual({
      identifier: "ok",
      field: "name",
      line: 4,
    });
  });

  it("REG-WU-047-RC-075-e: keep the simple pom and package.json expectations", () => {
    expect(
      readDeclaredIdentifier("pom.xml", "<project>\n  <artifactId>widget</artifactId>\n</project>\n"),
    ).toEqual({ identifier: "widget", field: "artifactId", line: 2 });
    expect(readDeclaredIdentifier("package.json", '{\n  "name": "widget-api"\n}\n')).toEqual({
      identifier: "widget-api",
      field: "name",
      line: 2,
    });
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
    // The key is in its own `root:` namespace, never the `container:` one a
    // directory name uses: a root-level container joins nothing (RC-078).
    expect(candidates.map((candidate) => candidate.project_key).sort()).toEqual([
      "root:Backup",
      "root:OldSSD",
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

describe("project candidates (WU-047 regressions)", () => {
  it("REG-WU-047-RC-073-c: give an archive-root project with a manifest and a CI definition one candidate", () => {
    const candidates = buildProjectCandidates({
      markers: [
        marker("root:a", "OldSSD", "proj.zip!/package.json", "zipped-proj"),
        marker("root:a", "OldSSD", "proj.zip!/.github/workflows/ci.yml", undefined, "ci_definition"),
      ],
      members: [
        member("root:a", "OldSSD", "proj.zip!/package.json"),
        member("root:a", "OldSSD", "proj.zip!/.github/workflows/ci.yml"),
        member("root:a", "OldSSD", "proj.zip!/src/index.ts"),
      ],
      rootLabels,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].project_key).toBe("project:zipped-proj");
    expect(candidates[0].containers.map((container) => container.container_path)).toEqual(["proj.zip!/"]);
    expect(candidates[0].containers[0].marker_kinds).toEqual(["build_manifest", "ci_definition"]);
    expect(candidates[0].member_count).toBe(3);
  });

  it("REG-WU-047-RC-073-c: never emit a project candidate with no members", () => {
    // A marker whose container receives no member (here, a marker on a root no
    // supplied member belongs to) carries no claim; emitting it would hand the
    // packet a cluster that names nothing.
    const candidates = buildProjectCandidates({
      markers: [
        marker("root:a", "OldSSD", "svc/Makefile"),
        marker("root:b", "Backup", "other/Makefile"),
      ],
      members: [member("root:b", "Backup", "other/Makefile")],
      rootLabels,
    });
    expect(candidates.map((candidate) => candidate.project_key)).toEqual(["container:other"]);
    expect(candidates.every((candidate) => candidate.member_count > 0)).toBe(true);
  });

  it("REG-WU-047-RC-075-d: keep two Maven projects sharing a parent apart", () => {
    const pomFor = (artifactId: string) => [
      "<project>",
      "  <parent>",
      "    <artifactId>spring-boot-starter-parent</artifactId>",
      "  </parent>",
      `  <artifactId>${artifactId}</artifactId>`,
      "</project>",
    ].join("\n");
    const declaredMarker = (rootId: string, label: string, relative: string, text: string) => {
      const declared = readDeclaredIdentifier("pom.xml", text);
      return {
        ...member(rootId, label, relative),
        marker_kind: "build_manifest" as const,
        ...(declared !== undefined
          ? {
            declared_identifier: declared.identifier,
            declared_identifier_evidence: { field: declared.field, line: declared.line },
          }
          : {}),
      };
    };
    const candidates = buildProjectCandidates({
      markers: [
        declaredMarker("root:a", "OldSSD", "billing/pom.xml", pomFor("billing-service")),
        declaredMarker("root:b", "Backup", "inventory/pom.xml", pomFor("inventory-app")),
      ],
      members: [
        member("root:a", "OldSSD", "billing/pom.xml"),
        member("root:b", "Backup", "inventory/pom.xml"),
      ],
      rootLabels,
    });
    expect(candidates.map((candidate) => candidate.project_key)).toEqual([
      "project:billing-service",
      "project:inventory-app",
    ]);
    expect(candidates.every((candidate) => candidate.spans_roots === false)).toBe(true);
  });

  it("REG-WU-047-RC-078-a: keep a root-level container apart from another root's directory of the same name", () => {
    const labels = new Map([
      ["root:alpha", "alpha"],
      ["root:beta", "beta"],
    ]);
    const candidates = buildProjectCandidates({
      markers: [
        marker("root:alpha", "alpha", "Jenkinsfile"),
        marker("root:beta", "beta", "alpha/Jenkinsfile"),
      ],
      members: [
        member("root:alpha", "alpha", "Jenkinsfile"),
        member("root:beta", "beta", "alpha/Jenkinsfile"),
      ],
      rootLabels: labels,
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.spans_roots === false)).toBe(true);
    expect(candidates.map((candidate) => candidate.project_key)).toEqual(["container:alpha", "root:alpha"]);
  });

  it("REG-WU-047-RC-078-b: keep two roots' top-level Makefiles apart", () => {
    const candidates = buildProjectCandidates({
      markers: [marker("root:a", "OldSSD", "Makefile"), marker("root:b", "Backup", "Makefile")],
      members: [member("root:a", "OldSSD", "Makefile"), member("root:b", "Backup", "Makefile")],
      rootLabels,
    });
    expect(candidates).toHaveLength(2);
    expect(candidates.every((candidate) => candidate.spans_roots === false)).toBe(true);
  });

  it("REG-WU-047-RC-078-c: still join same-name undeclared directories across roots", () => {
    const candidates = buildProjectCandidates({
      markers: [
        marker("root:a", "OldSSD", "archive/widget/Makefile"),
        marker("root:b", "Backup", "widget/Makefile"),
      ],
      members: [
        member("root:a", "OldSSD", "archive/widget/Makefile"),
        member("root:b", "Backup", "widget/Makefile"),
      ],
      rootLabels,
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0].project_key).toBe("container:widget");
    expect(candidates[0].spans_roots).toBe(true);
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

describe("declared identifiers through a warm cache", () => {
  const scratch: string[] = [];
  afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
  });

  const pom = [
    "<project>",
    "  <parent>",
    "    <artifactId>spring-boot-starter-parent</artifactId>",
    "  </parent>",
    "  <artifactId>billing-service</artifactId>",
    "</project>",
    "",
  ].join("\n");

  async function scanWith(cache: MemoryCorpusCache, root: string) {
    const result = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test", cache });
    return result.candidates.project_candidates.flatMap((candidate) =>
      candidate.containers.flatMap((container) => container.declared_identifiers));
  }

  it("REG-WU-047-RC-075-f: recompute an identifier an earlier reader version cached", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "l9-wu047-warm-"));
    scratch.push(root);
    fs.writeFileSync(path.join(root, "pom.xml"), pom, "utf8");

    // A cold run records the manifest's content hash, which is the cache key's
    // content half.
    const cold = await runCorpusScan({ roots: [{ path: root }], producerVersion: "test" });
    const artifact = cold.snapshot.artifacts.find((entry) => entry.root_relative_path === "pom.xml");
    expect(artifact?.content_hash).toBeTruthy();
    const contentHash = artifact?.content_hash as string;
    const stale = { declared: { identifier: "stale-cached-identifier", field: "artifactId", line: 3 } };

    // Control: an entry under the current reader's key is what the scan reads,
    // so the key arithmetic below is the scan's own.
    const current = new MemoryCorpusCache("test");
    current.put("normalized_document", normalizedDocumentKey({
      contentHash,
      decoderId: MANIFEST_DECODER_ID,
      decoderVersion: MANIFEST_DECODER_VERSION,
    }), stale);
    expect(await scanWith(current, root)).toEqual(["stale-cached-identifier"]);

    // The cache an earlier reader (1.0.0, first-match artifactId) populated must
    // not be served to this one: the version is part of the key.
    const warm = new MemoryCorpusCache("test");
    warm.put("normalized_document", normalizedDocumentKey({
      contentHash,
      decoderId: MANIFEST_DECODER_ID,
      decoderVersion: "1.0.0",
    }), stale);
    expect(await scanWith(warm, root)).toEqual(["billing-service"]);
  });
});
