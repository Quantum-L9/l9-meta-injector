// compiler.ts — Build dedup + library indexes from InjectionRecord[]
import { InjectionRecord, PromptMeta, ExecutableRetrievalMeta, isPromptMeta } from "./schema";

export function buildDedupEntries(records: InjectionRecord[], prefixLen: number) {
  return records.map((r) => ({
    id: r.meta.id,
    sourcePath: r.sourcePath,
    contentHash: r.originalBodyHash,
    hashPrefix: r.originalBodyHash.slice(0, prefixLen),
    family: isPromptMeta(r.meta) ? r.meta.family : "Unknown",
    artifactType: r.meta.artifact_type,
  }));
}

export function buildDedupReport(
  entries: ReturnType<typeof buildDedupEntries>,
  threshold: number,
  prefixLen: number
) {
  // Exact duplicates: identical full content hash.
  const hashGroups = new Map<string, string[]>();
  for (const e of entries) {
    const g = hashGroups.get(e.contentHash) ?? [];
    g.push(e.sourcePath);
    hashGroups.set(e.contentHash, g);
  }
  const twins = [...hashGroups.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([contentHash, paths]) => ({ paths, contentHash }));

  // Near-duplicates: same hash prefix (first `prefixLen` chars) but distinct full
  // hashes. Groups of size >= threshold that are not already covered by exact twins.
  const prefixGroups = new Map<string, string[]>();
  for (const e of entries) {
    const g = prefixGroups.get(e.hashPrefix) ?? [];
    g.push(e.sourcePath);
    prefixGroups.set(e.hashPrefix, g);
  }
  const exactPaths = new Set(twins.flatMap((t) => t.paths));
  const nearDuplicates = [...prefixGroups.entries()]
    .filter(([, paths]) => paths.length >= Math.max(2, threshold) && !paths.every((p) => exactPaths.has(p)))
    .map(([hashPrefix, paths]) => ({ hashPrefix, paths }));

  const duplicatedCount = twins.reduce((a, t) => a + t.paths.length - 1, 0);
  return {
    generatedAt: new Date().toISOString(),
    totalScanned: entries.length,
    auditorTwins: twins,
    nearDuplicates,
    uniqueCount: entries.length - duplicatedCount,
  };
}

export function buildPromptLibraryIndex(records: InjectionRecord[]): PromptMeta[] {
  return records.filter((r) => isPromptMeta(r.meta)).map((r) => r.meta as PromptMeta);
}

export function buildPrimitiveLibraryIndex(records: InjectionRecord[]): ExecutableRetrievalMeta[] {
  return records
    .filter((r) => !isPromptMeta(r.meta) && r.meta.injectable)
    .map((r) => r.meta as ExecutableRetrievalMeta);
}

export function dedupReportToMarkdown(report: ReturnType<typeof buildDedupReport>): string {
  const lines = [
    `# Dedup Report — ${report.generatedAt}`,
    ``,
    `Total scanned: ${report.totalScanned}  |  Unique: ${report.uniqueCount}  |  Exact twins: ${report.auditorTwins.length}  |  Near-duplicates: ${report.nearDuplicates.length}`,
    ``,
  ];
  if (report.auditorTwins.length > 0) {
    lines.push("## Exact Duplicates");
    for (const t of report.auditorTwins) {
      lines.push(`- \`${t.contentHash.slice(0, 16)}\``);
      t.paths.forEach((p) => lines.push(`  - ${p}`));
    }
    lines.push(``);
  }
  if (report.nearDuplicates.length > 0) {
    lines.push("## Near-Duplicates (shared hash prefix)");
    for (const n of report.nearDuplicates) {
      lines.push(`- prefix \`${n.hashPrefix}\``);
      n.paths.forEach((p) => lines.push(`  - ${p}`));
    }
    lines.push(``);
  }
  return lines.join("\n") + "\n";
}
