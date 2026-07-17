from __future__ import annotations

import re

SHA = re.compile(r"^[0-9a-f]{40}$")
USES = re.compile(r"^\s*(?:-\s*)?uses:\s*(.*)$")


def _strip_inline_comment(value: str) -> str:
    """Strip YAML comments while preserving spaces and expressions inside `${{ ... }}`."""
    quote: str | None = None
    expression_depth = 0
    index = 0
    while index < len(value):
        char = value[index]
        pair = value[index : index + 3]
        if quote:
            if char == quote and (index == 0 or value[index - 1] != "\\"):
                quote = None
            index += 1
            continue
        if char in {"'", '"'}:
            quote = char
            index += 1
            continue
        if pair == "${{":
            expression_depth += 1
            index += 3
            continue
        if value[index : index + 2] == "}}" and expression_depth:
            expression_depth -= 1
            index += 2
            continue
        if char == "#" and expression_depth == 0 and (index == 0 or value[index - 1].isspace()):
            return value[:index].rstrip()
        index += 1
    return value.strip()


def analyze(workflows: list[dict]) -> list[dict]:
    out: list[dict] = []
    for workflow in workflows:
        for line_number, line in enumerate(workflow["text"].splitlines(), 1):
            match = USES.match(line)
            if not match:
                continue
            action_ref = _strip_inline_comment(match.group(1).strip())
            if action_ref.startswith("./"):
                continue
            dynamic = "${{" in action_ref
            pin = action_ref.rsplit("@", 1)[1] if "@" in action_ref else ""
            if SHA.fullmatch(pin):
                continue
            if dynamic:
                recommended_changes = [
                    "replace dynamic action selection with explicit SHA-pinned action steps",
                    "use an internal wrapper action pinned to an immutable SHA",
                    "generate and commit a static workflow for the selected action flavor",
                    "use a governed exception with owner, reason, and expiry only when redesign is infeasible",
                ]
                remediation_id = "redesign_dynamic_action_reference"
            else:
                recommended_changes = ["resolve the action tag to an immutable commit SHA and pin it"]
                remediation_id = "pin_static_github_action"
            out.append(
                {
                    "file": workflow["path"],
                    "line": line_number,
                    "action_ref": action_ref,
                    "dynamic_path": dynamic,
                    "status": "warning",
                    "autofixable": False,
                    "remediation_id": remediation_id,
                    "recommended_changes": recommended_changes,
                    "exception_last_resort": dynamic,
                }
            )
    return out
