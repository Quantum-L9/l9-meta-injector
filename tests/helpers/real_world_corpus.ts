// real_world_corpus.ts — a drive-shaped corpus, built once and then locked.
//
// The other corpus fixtures in this suite are minimal on purpose: they contain
// exactly the artifacts a property needs and nothing else, so that when an
// assertion fails there is only one thing it can be about. This one is the
// opposite. It is deliberately mixed and slightly untidy, because the question it
// exists to answer is not "does this property hold" but "what does the engine
// actually report when it is pointed at two old disks".
//
// So it carries, across two roots:
//
//   - documents across two dozen extensions: sixteen text formats the decoders
//     open, two extensionless build files, and five binary formats they do not —
//     split between formats that are simply not decoded yet (.pdf, .docx) and
//     formats carrying no text layer at all without OCR (.png, .jpg, .tiff)
//   - five ZIP archives, one of them nested two deep, holding both fresh
//     documents and byte-exact copies of documents that also exist loose on disk
//   - four project-shaped directories with real build manifests, test trees, CI
//     definitions, a Dockerfile, a Terraform file and an OpenAPI document
//   - exact duplicates that cross the root boundary, which is the case a
//     single-root scan structurally cannot find
//   - two revisions of one plan: a light edit that clears the default 0.85
//     similarity and is offered as a near-duplicate candidate, and a substantive
//     rewrite that scores about 0.78 and is correctly not offered at all
//   - three credential-shaped files, two of them in formats the decoders would
//     otherwise open, so the secret-skipping path is exercised rather than assumed
//
// After it is written it is chmod'ed read-only. That is an attempt at a guarantee
// rather than a guarantee: root writes through `0o444`. The guarantee is
// `treeDigest`, taken before and after, which compares content *and* mode for
// every path.
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { writeRawZip } from "./zip_fixtures";

/** Body shared by `plan.md` and both its revisions, long enough to score on wording. */
const PLAN_BODY = [
  "This plan describes the migration of the acquisition layer onto content-addressed",
  "storage. The layer observes a local folder, an external drive, or a zip archive and",
  "writes nothing into the source it reads. Archive members are staged into tool-owned",
  "scratch and carried as virtual artifacts, so the observed tree keeps exactly the bytes",
  "it had before the run started.",
  "",
  "Identity is derived from content and from root-relative paths, never from the mount",
  "point a disk happened to be attached at. Two copies of one archive, mounted under two",
  "different directories, are therefore one corpus rather than two, and every duplicate",
  "cluster spanning them is reported once.",
  "",
  "The cache is keyed by the hash of the bytes and by the identity of the rules applied to",
  "those bytes. A decoder version bump invalidates every normalized document it produced,",
  "and nothing else. That is the whole of the invalidation contract, and it is the reason a",
  "warm run is allowed to be faster without being allowed to be different.",
].join("\n");

const PLAN_MD = [
  "---", "title: Storage Migration Plan", "kind: plan", "status: WIP", "---", "",
  "# Storage Migration Plan", "", "Depends on: services/ingest/README.md", "",
  PLAN_BODY, "", "## Tasks", "",
  "- [ ] move the staging directory out of the observed root",
  "- [ ] key the normalized-document layer on the decoder version",
  "- [x] hash every byte on acquisition rather than trusting mtime",
  "TODO: write the invalidation contract down before the next review",
  "",
].join("\n");

/**
 * A light edit of `plan.md`: one task ticked, one line added.
 *
 * The fixture carries two revisions on purpose, because a real disk has both and
 * a threshold that never excludes anything is not a threshold. This one clears
 * the default 0.85 similarity; `REVISED_PLAN_MD` below is a substantive rewrite
 * that scores about 0.78 and is correctly *not* offered as a candidate.
 */
const PLAN_V2_MD = [
  "---", "title: Storage Migration Plan", "kind: plan", "status: WIP", "---", "",
  "# Storage Migration Plan", "", "Depends on: services/ingest/README.md", "",
  PLAN_BODY, "", "## Tasks", "",
  "- [ ] move the staging directory out of the observed root",
  "- [x] key the normalized-document layer on the decoder version",
  "- [x] hash every byte on acquisition rather than trusting mtime",
  "TODO: write the invalidation contract down before the next review",
  "",
].join("\n");

/** The same plan after a revision: same subject, different bytes. */
const REVISED_PLAN_MD = [
  "---", "title: Storage Migration Plan (revised)", "kind: plan", "status: WIP", "---", "",
  "# Storage Migration Plan (revised)", "", "Supersedes: plan.md", "",
  PLAN_BODY, "", "## Tasks", "",
  "- [ ] move the staging directory out of the observed root",
  "- [x] key the normalized-document layer on the decoder version",
  "- [x] hash every byte on acquisition rather than trusting mtime",
  "- [ ] measure the warm-run hit ratio on a real disk",
  "",
].join("\n");

const ROADMAP_MD = [
  "---", "title: Ingest Roadmap", "kind: roadmap", "---", "", "# Ingest Roadmap", "",
  "## Milestones", "",
  "- M1 content-addressed cache behind every deterministic layer",
  "- M2 resumable scans over a multi-terabyte corpus",
  "- M3 coverage reporting that names what the decoders cannot open",
  "",
].join("\n");

const BLOCKED_MD = [
  "---", "title: OCR Pipeline", "kind: spec", "status: blocked", "---", "",
  "# OCR Pipeline", "",
  "Blocked by: no decoder budget approved for raster documents",
  "",
  "Scanned pages are the largest single unreadable class on both drives. Until a decoder",
  "exists they are counted as OCR-required and are otherwise invisible to every analysis.",
  "",
].join("\n");

const NOTES_TXT = [
  "Unsorted notes from the old workstation.",
  "",
  "The backup disk was made in a hurry and overlaps the working disk in ways nobody wrote",
  "down. Several directories appear on both, sometimes identical and sometimes not, and",
  "the only reliable way to tell which is which is to hash them.",
  "",
].join("\n");

const SETTINGS_INI = [
  "[ingest]", "workers = 4", "scratch = /var/tmp/ingest", "",
  "[cache]", "root = ~/.l9/corpus-cache", "enabled = true", "",
].join("\n");

const MEASUREMENTS_CSV = [
  "run,files,bytes,hit_ratio",
  "cold,10412,884213312,0.0",
  "warm,10412,884213312,0.997",
  "incremental,10413,884215544,0.981",
  "",
].join("\n");

const REPORT_HTML = [
  "<!doctype html>", "<html><head><title>Ingest report</title></head>", "<body>",
  "<h1>Ingest report</h1>",
  "<p>The second run read almost everything it needed out of the cache.</p>",
  "</body></html>", "",
].join("\n");

const SCHEMA_SQL = [
  "create table artifact (",
  "  virtual_source_id text primary key,",
  "  content_hash      text not null,",
  "  size_bytes        integer not null",
  ");",
  "",
  "create index artifact_content_hash on artifact (content_hash);",
  "",
].join("\n");

const OPENAPI_YAML = [
  "openapi: 3.0.3",
  "info:", "  title: Ingest API", "  version: 1.4.0",
  "paths:", "  /artifacts:", "    get:", "      summary: list observed artifacts",
  "      responses:", "        '200':", "          description: ok",
  "",
].join("\n");

const DOCKERFILE = [
  "FROM node:20-slim",
  "WORKDIR /srv",
  "COPY package.json ./",
  "RUN npm ci --omit=dev",
  "COPY . .",
  'CMD ["node", "server.js"]',
  "",
].join("\n");

const TERRAFORM = [
  'resource "aws_s3_bucket" "corpus" {',
  '  bucket = "l9-corpus-snapshots"',
  "}",
  "",
].join("\n");

const GITLAB_CI = [
  "stages: [test]",
  "unit:", "  stage: test", "  script:", "    - npm ci", "    - npm test",
  "",
].join("\n");

const CREDENTIALS = [
  "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE",
  "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "",
].join("\n");

const SECRETS_YAML = [
  "database:",
  "  host: db.internal",
  "  user: ingest",
  "  password: hunter2-not-a-real-password",
  "registry:",
  "  token: ghp_0000000000000000000000000000000000",
  "",
].join("\n");

const CREDENTIALS_JSON = JSON.stringify(
  {
    aws_access_key_id: "AKIAIOSFODNN7EXAMPLE",
    aws_secret_access_key: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    region: "eu-central-1",
  },
  null,
  2,
) + "\n";

const GO_MAKEFILE = ["build:", "\tgo build ./...", ""].join("\n");

/** Deterministic pseudo-binary: same bytes every run, no text layer. */
function binary(seed: string, length: number): Buffer {
  const out = Buffer.alloc(length);
  let digest = crypto.createHash("sha256").update(seed).digest();
  for (let i = 0; i < length; i += 1) {
    if (i % 32 === 0 && i > 0) digest = crypto.createHash("sha256").update(digest).digest();
    out[i] = digest[i % 32] as number;
  }
  return out;
}

type Entry = readonly [string, string | Buffer];

/** Loose files on the working disk. */
function driveFiles(): Entry[] {
  return [
    ["plan.md", PLAN_MD],
    ["plan-v2.md", PLAN_V2_MD],
    ["revised-plan.md", REVISED_PLAN_MD],
    ["roadmap.md", ROADMAP_MD],
    ["notes.txt", NOTES_TXT],
    ["settings.ini", SETTINGS_INI],
    ["measurements.csv", MEASUREMENTS_CSV],
    ["report.html", REPORT_HTML],
    ["specs/ocr-pipeline.md", BLOCKED_MD],
    ["specs/ingest.openapi.yaml", OPENAPI_YAML],
    ["specs/schema.sql", SCHEMA_SQL],

    // A Node project: manifest, source, tests, CI, container, deployment.
    ["services/ingest/package.json",
      JSON.stringify({ name: "ingest", version: "1.4.0", scripts: { test: "vitest run" } }, null, 2) + "\n"],
    ["services/ingest/README.md", "# Ingest\n\nReads a disk without writing to it.\n"],
    ["services/ingest/server.js",
      "'use strict';\nmodule.exports = function serve() { return 'ok'; };\n"],
    ["services/ingest/lib/hash.js",
      "'use strict';\nexports.sha256 = (b) => require('node:crypto').createHash('sha256').update(b).digest('hex');\n"],
    ["services/ingest/tests/hash.test.js",
      "const { sha256 } = require('../lib/hash');\ntest('hashes', () => { expect(sha256('')).toHaveLength(64); });\n"],
    ["services/ingest/Dockerfile", DOCKERFILE],
    ["services/ingest/.gitlab-ci.yml", GITLAB_CI],
    ["services/ingest/deploy/main.tf", TERRAFORM],

    // A Python project: manifest, source, test tree, no CI.
    ["tools/dedupe/pyproject.toml",
      '[project]\nname = "dedupe"\nversion = "0.3.0"\ndependencies = ["click"]\n'],
    ["tools/dedupe/dedupe/__init__.py", '"""Cluster artifacts by content hash."""\n'],
    ["tools/dedupe/dedupe/cluster.py",
      "def cluster(hashes):\n"
      + "    groups = {}\n"
      + "    for key, value in hashes.items():\n"
      + "        groups.setdefault(value, []).append(key)\n"
      + "    return {k: v for k, v in groups.items() if len(v) > 1}\n"],
    ["tools/dedupe/tests/test_cluster.py",
      "from dedupe.cluster import cluster\n\n\ndef test_pairs():\n"
      + "    assert cluster({'a': '1', 'b': '1'}) == {'1': ['a', 'b']}\n"],
    ["tools/dedupe/TODO.md", "# TODO\n\n- [ ] stream large files\n- [x] cluster by hash\n"],

    // Things the decoders do not open.
    ["scans/invoice-2019.pdf", binary("invoice-2019", 4096)],
    ["scans/contract.docx", binary("contract", 6144)],
    ["scans/whiteboard.png", binary("whiteboard", 3072)],
    ["media/logo.jpg", binary("logo", 2048)],

    // Never read, and proven not to be.
    //
    // Three shapes, because they fail differently. `.env.credentials` is not a
    // format any decoder claims, so it is never opened for the ordinary reason.
    // The other two are: a YAML and a JSON document the decoders would happily
    // read, refused on the strength of their names alone before a byte of them
    // is decoded. Only those two reach the secret guard, and only they are
    // counted in `secret_skipped_count`.
    [".env.credentials", CREDENTIALS],
    ["config/secrets.yaml", SECRETS_YAML],
    ["services/ingest/credentials.json", CREDENTIALS_JSON],
  ];
}

const HANDOVER_TXT = "Handed over the working disk in March. The backup is from January.\n";

/** The backup disk: an overlapping, partly-stale copy of the working disk. */
function backupFiles(): Entry[] {
  return [
    // Byte-exact copies of documents that also exist on the working disk. These
    // are the clusters a single-root scan structurally cannot find.
    ["archive/plan.md", PLAN_MD],
    ["archive/notes.txt", NOTES_TXT],

    ["archive/old-roadmap.md",
      "---\ntitle: Ingest Roadmap\nkind: roadmap\n---\n\n# Ingest Roadmap\n\n"
      + "## Milestones\n\n- M1 content-addressed cache\n"],
    ["archive/handover.txt", HANDOVER_TXT],

    // A Go project and a Rust one, so the manifest vocabulary is exercised
    // beyond the Node and Python cases on the other root.
    ["projects/router/go.mod", "module example.com/router\n\ngo 1.21\n"],
    ["projects/router/main.go", "package main\n\nfunc main() { println(\"route\") }\n"],
    ["projects/router/main_test.go",
      "package main\n\nimport \"testing\"\n\nfunc TestNothing(t *testing.T) {}\n"],
    ["projects/router/Makefile", GO_MAKEFILE],

    ["projects/hasher/Cargo.toml", '[package]\nname = "hasher"\nversion = "0.1.0"\n'],
    ["projects/hasher/src/main.rs", 'fn main() { println!("hash"); }\n'],
    ["projects/hasher/README.md", "# hasher\n\nStreaming content hasher.\n"],

    ["scans/receipt-2018.pdf", binary("receipt-2018", 5120)],
    ["media/photo.tiff", binary("photo", 4096)],
  ];
}

/** Build the five archives. Two of them hold copies of loose documents. */
function writeArchives(driveRoot: string, backupRoot: string, scratch: string): void {
  const innerPath = path.join(scratch, "inner.zip");
  writeRawZip(innerPath, [
    {
      name: "draft-spec.md",
      content: "---\ntitle: Draft Spec\nkind: spec\nstatus: WIP\n---\n\n# Draft Spec\n\n"
        + "TODO: decide the member locator syntax\n",
      stored: true,
    },
    { name: "scratch.txt", content: "two archives deep\n", stored: true },
  ]);
  const inner = fs.readFileSync(innerPath);

  writeRawZip(path.join(driveRoot, "archives", "2019-backup.zip"), [
    { name: "plan.md", content: PLAN_MD, stored: true },
    { name: "notes-copy.txt", content: NOTES_TXT, stored: true },
    { name: "inner.zip", content: inner, stored: true },
  ]);

  writeRawZip(path.join(driveRoot, "archives", "release-notes.zip"), [
    { name: "CHANGELOG.md", content: "# Changelog\n\n## 1.4.0\n\n- content-addressed cache\n", stored: true },
    {
      name: "package.json",
      content: JSON.stringify({ name: "release-notes", version: "1.4.0" }, null, 2) + "\n",
      stored: true,
    },
  ]);

  writeRawZip(path.join(backupRoot, "archives", "2018-backup.zip"), [
    { name: "roadmap.md", content: ROADMAP_MD, stored: true },
    { name: "handover.txt", content: HANDOVER_TXT, stored: true },
  ]);

  writeRawZip(path.join(backupRoot, "archives", "photos.zip"), [
    { name: "scan-01.png", content: binary("scan-01", 2048), stored: true },
    { name: "scan-02.png", content: binary("scan-02", 2048), stored: true },
  ]);
}

export interface RealWorldCorpus {
  /** The two roots, in the order they are handed to the scanner. */
  roots: { name: string; path: string }[];
  driveRoot: string;
  backupRoot: string;
}

function writeAll(root: string, entries: readonly Entry[]): void {
  for (const [relative, content] of entries) {
    const absolute = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    if (typeof content === "string") fs.writeFileSync(absolute, content, "utf8");
    else fs.writeFileSync(absolute, content);
  }
}

/** Write the corpus under `parent`. It is writable until `lockReadOnly` is called. */
export function writeRealWorldCorpus(parent: string): RealWorldCorpus {
  const driveRoot = path.join(parent, "OldSSD");
  const backupRoot = path.join(parent, "Backup");
  fs.mkdirSync(driveRoot, { recursive: true });
  fs.mkdirSync(backupRoot, { recursive: true });

  writeAll(driveRoot, driveFiles());
  writeAll(backupRoot, backupFiles());

  const scratch = fs.mkdtempSync(path.join(parent, ".archive-build-"));
  writeArchives(driveRoot, backupRoot, scratch);
  fs.rmSync(scratch, { recursive: true, force: true });

  return {
    driveRoot,
    backupRoot,
    roots: [
      { name: "old-ssd", path: driveRoot },
      { name: "backup", path: backupRoot },
    ],
  };
}

/**
 * Make every file and directory in the tree read-only.
 *
 * Directories are collected on the way down and cleared on the way back up, so a
 * directory's own mode is dropped only after everything inside it has been
 * reached.
 */
export function lockReadOnly(root: string): void {
  const directories: string[] = [];
  const walk = (directory: string): void => {
    directories.push(directory);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) fs.chmodSync(absolute, 0o444);
    }
  };
  walk(root);
  for (const directory of directories.reverse()) fs.chmodSync(directory, 0o555);
}

/** Restore write permission so the tree can be removed in teardown. */
export function unlockReadOnly(root: string): void {
  const walk = (directory: string): void => {
    fs.chmodSync(directory, 0o755);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(absolute);
      else if (entry.isFile()) fs.chmodSync(absolute, 0o644);
    }
  };
  walk(root);
}

/**
 * Whether a write into `root` actually fails.
 *
 * Called rather than assumed: `chmod 0o555` stops an ordinary user and does not
 * stop root, and a report that claimed enforcement without checking would be
 * wrong exactly in the environment most continuous-integration jobs run in.
 */
export function readOnlyEnforced(root: string): boolean {
  const probe = path.join(root, ".l9-write-probe");
  try {
    fs.writeFileSync(probe, "probe");
  } catch {
    return true;
  }
  fs.rmSync(probe, { force: true });
  return false;
}

/**
 * A digest over every path in the tree, including its mode.
 *
 * Mode is included because a scan that left the bytes alone but relaxed a
 * permission bit has still modified the source, and the claim being qualified is
 * that the source is not modified at all.
 */
export function treeDigest(root: string): { digest: string; entries: Record<string, string> } {
  const entries: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const name of fs.readdirSync(directory).sort()) {
      const absolute = path.join(directory, name);
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      const stats = fs.lstatSync(absolute);
      const mode = (stats.mode & 0o777).toString(8);
      if (stats.isSymbolicLink()) {
        entries[relative] = `symlink:${mode}:${fs.readlinkSync(absolute)}`;
        continue;
      }
      if (stats.isDirectory()) {
        entries[`${relative}/`] = `dir:${mode}`;
        walk(absolute);
        continue;
      }
      if (stats.isFile()) {
        const hash = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
        entries[relative] = `file:${mode}:${hash}`;
        continue;
      }
      entries[relative] = `special:${mode}`;
    }
  };
  walk(root);
  const canonical = Object.keys(entries)
    .sort()
    .map((key) => `${key} ${entries[key] as string}`)
    .join("\n");
  return {
    digest: `sha256:${crypto.createHash("sha256").update(canonical).digest("hex")}`,
    entries,
  };
}

/** Paths whose digest entry differs between two tree digests. */
export function mutatedPaths(
  before: Record<string, string>,
  after: Record<string, string>,
): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((key) => before[key] !== after[key]).sort();
}
