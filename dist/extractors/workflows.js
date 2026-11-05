"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.workflowStructureExtractor = void 0;
const common_1 = require("./common");
const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/;
const KEY_LINE = /^(\s*)(-\s+)?("[^"]*"|'[^']*'|[A-Za-z0-9_.-]+)\s*:(?:\s+(.*)|\s*)$/;
const BLOCK_SCALAR = /^[|>][-+0-9]*$/;
const REMOTE_USES = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)((?:\/[^@\s]+)?)@(\S+)$/;
function keyLine(line, index) {
    const match = KEY_LINE.exec((0, common_1.stripYamlComment)(line));
    if (!match)
        return null;
    return {
        index,
        indent: match[1].length + (match[2] ? match[2].length : 0),
        key: (0, common_1.unquote)(match[3]),
        value: (match[4] ?? "").trim(),
        item: match[2] !== undefined,
    };
}
/** Values of a `needs:` key: scalar, flat inline list, or the block list that follows. */
function needsValues(lines, at) {
    if (at.value.startsWith("${{"))
        return { values: [], unsupported: "needs is an expression" };
    if (at.value.startsWith("[")) {
        if (!at.value.endsWith("]") || /[[\]{}]/.test(at.value.slice(1, -1)))
            return { values: [], unsupported: "needs is not a flat inline list" };
        return {
            values: at.value.slice(1, -1).split(",").map((item) => (0, common_1.unquote)(item)).filter(Boolean)
                .map((name) => ({ name, index: at.index })),
        };
    }
    if (at.value !== "")
        return { values: [{ name: (0, common_1.unquote)(at.value), index: at.index }] };
    const values = [];
    for (let cursor = at.index + 1; cursor < lines.length; cursor++) {
        const text = (0, common_1.stripYamlComment)(lines[cursor]);
        if (text.trim() === "")
            continue;
        const match = /^(\s*)-\s+(.+)$/.exec(text);
        if (!match || match[1].length < at.indent)
            break;
        values.push({ name: (0, common_1.unquote)(match[2]), index: cursor });
    }
    return { values };
}
function classifyUses(value, jobLevel, index, line, input) {
    const reference = (0, common_1.unquote)(value);
    const range = (0, common_1.spanRange)(index, index);
    if (reference.includes("${{")) {
        input.report?.({ code: "workflow.uses_expression", severity: "info", message: `line ${index + 1}: uses is an expression and was not classified` });
        return [];
    }
    if (reference.startsWith("docker://")) {
        return [(0, common_1.observed)("workflow.uses_docker", reference.slice("docker://".length), range, line)];
    }
    if (reference.startsWith("./")) {
        const target = reference.slice(2).replace(/\/+$/, "");
        // A local reusable workflow names a file; a local action names a directory
        // holding action.yml or action.yaml. Only an observed path resolves.
        const directory = target === "" || target === "." ? "" : `${target}/`;
        const candidates = jobLevel ? [target] : [`${directory}action.yml`, `${directory}action.yaml`];
        const found = candidates.filter((candidate) => input.pathExists(candidate));
        if (found.length === 1)
            return [(0, common_1.observed)("workflow.uses_local", found[0], range, line)];
        return [(0, common_1.observed)("workflow.uses_local_unresolved", reference, range, line)];
    }
    if (REMOTE_USES.test(reference)) {
        return [(0, common_1.observed)(jobLevel ? "workflow.uses_reusable_workflow" : "workflow.uses_action", reference, range, line)];
    }
    input.report?.({ code: "workflow.uses_unrecognized", severity: "info", message: `line ${index + 1}: uses reference is not a recognized form` });
    return [];
}
function workflowAssertions(input) {
    const lines = (0, common_1.toLines)(input.content);
    const drafts = [];
    const jobsIndex = lines.findIndex((line) => {
        const key = keyLine(line, 0);
        return key !== null && key.indent === 0 && key.key === "jobs";
    });
    if (jobsIndex < 0)
        return drafts;
    const jobsKey = keyLine(lines[jobsIndex], jobsIndex);
    if (jobsKey && jobsKey.value !== "") {
        input.report?.({ code: "workflow.jobs_unsupported", severity: "warning", message: `line ${jobsIndex + 1}: jobs is not a block mapping and was not read` });
        return drafts;
    }
    const jobs = [];
    let jobIndent = -1;
    let cursor = jobsIndex + 1;
    for (; cursor < lines.length; cursor++) {
        const text = lines[cursor];
        if ((0, common_1.stripYamlComment)(text).trim() === "")
            continue;
        const indent = (0, common_1.indentOf)(text);
        if (indent === 0)
            break;
        const key = keyLine(text, cursor);
        if (jobIndent < 0 && key)
            jobIndent = key.indent;
        if (key && key.indent === jobIndent && !key.item) {
            if (jobs.length)
                jobs[jobs.length - 1].end = cursor;
            jobs.push({ id: key.key, index: cursor, end: lines.length });
        }
    }
    if (jobs.length)
        jobs[jobs.length - 1].end = cursor;
    const jobIds = new Set(jobs.map((job) => job.id));
    for (const job of jobs) {
        drafts.push((0, common_1.observed)("workflow.job", job.id, (0, common_1.spanRange)(job.index, job.index), lines[job.index]));
        let fieldIndent = -1;
        let skipDeeperThan = -1;
        for (let index = job.index + 1; index < job.end; index++) {
            const text = lines[index];
            if ((0, common_1.stripYamlComment)(text).trim() === "")
                continue;
            const indent = (0, common_1.indentOf)(text);
            if (skipDeeperThan >= 0) {
                if (indent > skipDeeperThan)
                    continue;
                skipDeeperThan = -1;
            }
            const key = keyLine(text, index);
            if (!key)
                continue;
            if (fieldIndent < 0)
                fieldIndent = key.indent;
            if (BLOCK_SCALAR.test(key.value)) {
                skipDeeperThan = key.indent;
                continue;
            }
            if (key.value.startsWith("{")) {
                input.report?.({ code: "workflow.flow_mapping", severity: "info", message: `line ${index + 1}: flow mapping under job '${job.id}' was not read` });
                continue;
            }
            if (key.key === "needs" && key.indent === fieldIndent && !key.item) {
                const needs = needsValues(lines, key);
                if (needs.unsupported) {
                    input.report?.({ code: "workflow.needs_unsupported", severity: "info", message: `line ${index + 1}: ${needs.unsupported}` });
                }
                for (const need of needs.values) {
                    const predicate = jobIds.has(need.name) ? "workflow.job_needs" : "workflow.job_needs_unresolved";
                    drafts.push((0, common_1.observed)(predicate, `${job.id} -> ${need.name}`, (0, common_1.spanRange)(need.index, need.index), lines[need.index]));
                }
                continue;
            }
            if (key.key === "uses" && key.value !== "") {
                // A job-level `uses` calls a reusable workflow; anywhere deeper it is a step.
                const jobLevel = key.indent === fieldIndent && !key.item;
                drafts.push(...classifyUses(key.value, jobLevel, index, text, input));
            }
        }
    }
    return drafts;
}
exports.workflowStructureExtractor = {
    id: "workflow-structure/v1",
    version: "1.0.0",
    // A workflow's jobs and references are facts about that workflow file.
    subjectScope: "artifact",
    matches(sourcePath) {
        return WORKFLOW_PATH.test(sourcePath);
    },
    extract: workflowAssertions,
};
//# sourceMappingURL=workflows.js.map