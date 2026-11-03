"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.explicitHiddenControlPattern = explicitHiddenControlPattern;
exports.canTraverseHiddenControl = canTraverseHiddenControl;
/** Internal admission for explicitly named, harmless repository controls. */
const glob_1 = require("./glob");
const CONTROL_BASENAMES = new Set([
    ".gitignore", ".gitattributes", ".editorconfig",
    ".pre-commit-config.yaml", ".pre-commit-config.yml", ".env.example", ".l9metaignore",
]);
function namesControl(pattern, control) {
    const segments = pattern.split("/");
    const named = control.split("/");
    return segments.some((_, index) => named.every((segment, offset) => segments[index + offset] === segment));
}
function hiddenSegments(relativePath) {
    return relativePath.split("/").filter((segment) => segment.startsWith("."));
}
/** A blanket wildcard never authorizes a hidden control, even when it matches. */
function explicitHiddenControlPattern(relativePath, patterns) {
    const segments = relativePath.split("/");
    const hidden = hiddenSegments(relativePath);
    if (hidden.length !== 1)
        return undefined;
    let control;
    const basename = segments[segments.length - 1];
    if (CONTROL_BASENAMES.has(basename))
        control = basename;
    else if (segments[0] === ".github") {
        if (segments[1] === "workflows" && segments.length > 2)
            control = ".github/workflows";
        else if (segments[1] === "CODEOWNERS" && segments.length === 2)
            control = ".github/CODEOWNERS";
    }
    return control === undefined ? undefined : patterns.find((pattern) => namesControl(pattern, control) && (0, glob_1.globToRegExp)(pattern).test(relativePath));
}
/** Traverse only the root .github control subtree, never arbitrary dot directories. */
function canTraverseHiddenControl(relativePath, patterns) {
    const segments = relativePath.split("/");
    const hidden = hiddenSegments(relativePath);
    if (hidden.length !== 1 || segments[0] !== ".github")
        return false;
    if (segments.length === 1) {
        return patterns.some((pattern) => namesControl(pattern, ".github/workflows") || namesControl(pattern, ".github/CODEOWNERS"));
    }
    return segments[1] === "workflows" && patterns.some((pattern) => namesControl(pattern, ".github/workflows"));
}
//# sourceMappingURL=hidden_control.js.map