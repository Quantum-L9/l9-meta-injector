export * from "./schema";
export * from "./llm";
export { resolveNamespace, toSnakeStem } from "./namespace";
export type { NamespaceResolution, NamespaceConfig } from "./namespace";
export * from "./assist";
export { reconcileFields, reconcileFieldsAsync, diffsToLogYaml } from "./reconcile_fields";
// FieldDiff and ReconcileAction are exported from ./schema (single source of truth).
export type { ReconcileResult } from "./reconcile_fields";
export * from "./normalize_filename";
export * from "./extract";
export * from "./classify";
export * from "./artifact_class";
export * from "./placement_policy";
export * from "./normalize_meta";
export { injectFile, injectFileAsync } from "./inject";
export type { InjectOptions } from "./inject";
export * from "./verify";
export * from "./retrieval";
export * from "./pipeline";
export * from "./inventory";
export * from "./meta_schema";
export * from "./meta_v3";
// Reusable primitives previously reachable only internally (finding DWL-008):
// the filetype injection-strategy engine and the dedup / library-index compiler.
export * from "./comment";
export * from "./compiler";
