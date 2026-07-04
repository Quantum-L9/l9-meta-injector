// compiler.ts — Build dedup + library indexes from InjectionRecord[]
import { InjectionRecord, PromptMeta, ExecutableRetrievalMeta } from "./schema";

function isPromptMeta(m: unknown): m is PromptMeta {
  return typeof m === "object" && m !== null && (m as { artifact_type?: string }).artifact_type === "prompt";
}

export function buildDedupEntries(records: InjectionRecord[], prefixLen: number) {
  return records.map((r) => ({
    id: r.meta.id, sourcePath: r.sourcePath,
    contentHash: r.originalBodyHash, hashPrefix: r.originalBodyHash.slice(0, prefixLen),
    family: isPromptMeta(r.meta) ? r.meta.family : "Unknown",
    artifactType: r.meta.artifact_type,
  }));
}

export function buildDedupReport(entries: ReturnType<typeof buildDedupEntries>, _threshold: number, _prefixLen: number) {
  const hashGroups = new Map<string, string[]>();
  for (const e of entries) {
    const g = hashGroups.get(e.contentHash) ?? [];
    g.push(e.sourcePath);
    hashGroups.set(e.contentHash, g);
  }
  const twins = [...hashGroups.entries()].filter(([, paths]) => paths.length > 1).map(([contentHash, paths]) => ({ paths, contentHash }));
  return { generatedAt: new Date().toISOString(), totalScanned: entries.length, auditorTwins: twins, nearDuplicates: [], uniqueCount: entries.length - twins.reduce((a, t) => a + t.paths.length - 1, 0) };
}

export function buildPromptLibraryIndex(records: InjectionRecord[]): PromptMeta[] {
  return records.filter((r) => isPromptMeta(r.meta)).map((r) => r.meta as PromptMeta);
}

export function buildPrimitiveLibraryIndex(records: InjectionRecord[]): ExecutableRetrievalMeta[] {
  return records.filter((r) => !isPromptMeta(r.meta) && r.meta.injectable).map((r) => r.meta as ExecutableRetrievalMeta);
}

export function dedupReportToMarkdown(report: ReturnType<typeof buildDedupReport>): string {
  const lines = [`# Dedup Report — ${report.generatedAt}`, ``, `Total scanned: ${report.totalScanned}  |  Unique: ${report.uniqueCount}  |  Exact twins: ${report.auditorTwins.length}`, ``];
  if (report.auditorTwins.length > 0) { lines.push("## Exact Duplicates"); for (const t of report.auditorTwins) { lines.push(`- \`${t.contentHash.slice(0, 16)}\``); t.paths.forEach((p) => lines.push(`  - ${p}`)); } }
  return lines.join("\n") + "\n";
}
