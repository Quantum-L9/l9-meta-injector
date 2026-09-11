// inventory_existing_meta.ts — harvest existing L9 meta before classify (ADR-049).
import * as fs from "node:fs";
import * as path from "node:path";
import { inspectFrontMatterDocument } from "./frontmatter_patch";
import { extractInjectedYaml, resolveStrategy, sidecarPathFor } from "./comment";
import { parseCanonicalYaml } from "./meta_schema";
import { probeFileEncoding } from "./encoding";
import { peekArchiveRootMeta } from "./inventory_archive_member";

export function parseMetaYaml(text: string): Record<string, unknown> {
  try {
    const obj = parseCanonicalYaml(text);
    return typeof obj === "object" && obj !== null ? obj : {};
  } catch {
    return {};
  }
}

function harvestInline(abs: string): Record<string, unknown> {
  const encoding = probeFileEncoding(abs);
  if (encoding.status !== "utf8") return {};
  const raw = fs.readFileSync(abs, "utf8");
  const spec = resolveStrategy(abs, raw);
  if (spec.strategy === "yaml-frontmatter") {
    const inspected = inspectFrontMatterDocument(raw);
    return inspected.safe ? inspected.meta : {};
  }
  if (spec.strategy === "line-comment" || spec.strategy === "block-comment") {
    const yaml = extractInjectedYaml(raw, spec);
    return yaml ? parseMetaYaml(yaml) : {};
  }
  return {};
}

function harvestSidecar(abs: string): Record<string, unknown> {
  const sidecar = sidecarPathFor(abs);
  if (!fs.existsSync(sidecar)) return {};
  try {
    return parseMetaYaml(fs.readFileSync(sidecar, "utf8"));
  } catch {
    return {};
  }
}

function harvestFolder(dir: string): Record<string, unknown> {
  const sidecar = path.join(dir, ".l9meta.yaml");
  if (!fs.existsSync(sidecar)) return {};
  try {
    return parseMetaYaml(fs.readFileSync(sidecar, "utf8"));
  } catch {
    return {};
  }
}

/** Later sources win. Inventory clocks overwrite these after harvest. */
export function mergeHarvested(...layers: Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const layer of layers) {
    for (const [key, value] of Object.entries(layer)) {
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

export function harvestExistingMeta(abs: string, isDir: boolean): Record<string, unknown> {
  if (isDir) {
    return harvestFolder(abs);
  }
  const member = peekArchiveRootMeta(abs);
  const fromMember = member ? parseMetaYaml(member) : {};
  const sidecar = harvestSidecar(abs);
  const inline = harvestInline(abs);
  return mergeHarvested(fromMember, sidecar, inline);
}
