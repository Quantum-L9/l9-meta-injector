/** Internal admission for explicitly named, harmless repository controls. */
import { globToRegExp } from "./glob";

const CONTROL_BASENAMES = new Set([
  ".gitignore", ".gitattributes", ".editorconfig",
  ".pre-commit-config.yaml", ".pre-commit-config.yml", ".env.example", ".l9metaignore",
]);

function namesControl(pattern: string, control: string): boolean {
  const segments = pattern.split("/");
  const named = control.split("/");
  return segments.some((_, index) => named.every((segment, offset) => segments[index + offset] === segment));
}

function hiddenSegments(relativePath: string): string[] {
  return relativePath.split("/").filter((segment) => segment.startsWith("."));
}

/** A blanket wildcard never authorizes a hidden control, even when it matches. */
export function explicitHiddenControlPattern(relativePath: string, patterns: readonly string[]): string | undefined {
  const segments = relativePath.split("/");
  const hidden = hiddenSegments(relativePath);
  if (hidden.length !== 1) return undefined;
  let control: string | undefined;
  const basename = segments[segments.length - 1];
  if (CONTROL_BASENAMES.has(basename)) control = basename;
  else if (hidden[0] === ".github") {
    const index = segments.indexOf(".github");
    if (segments[index + 1] === "workflows" && segments.length > index + 2) control = ".github/workflows";
    else if (segments[index + 1] === "CODEOWNERS" && segments.length === index + 2) control = ".github/CODEOWNERS";
  }
  return control === undefined ? undefined : patterns.find((pattern) => namesControl(pattern, control!) && globToRegExp(pattern).test(relativePath));
}

/** Traverse only the known .github control subtree, never arbitrary dot directories. */
export function canTraverseHiddenControl(relativePath: string, patterns: readonly string[]): boolean {
  const segments = relativePath.split("/");
  const hidden = hiddenSegments(relativePath);
  if (hidden.length !== 1 || hidden[0] !== ".github") return false;
  const index = segments.indexOf(".github");
  if (segments.length === index + 1) {
    return patterns.some((pattern) => namesControl(pattern, ".github/workflows") || namesControl(pattern, ".github/CODEOWNERS"));
  }
  return segments[index + 1] === "workflows" && patterns.some((pattern) => namesControl(pattern, ".github/workflows"));
}
