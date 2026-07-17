from __future__ import annotations

import re
import shlex

VALIDATION_PREFIXES = (
    "pytest",
    "ruff",
    "mypy",
    "npm test",
    "npm run test",
    "pnpm test",
    "yarn test",
    "cargo test",
    "go test",
    "terraform validate",
    "actionlint",
)
CLEANUP_PREFIXES = (
    "rm",
    "rmdir",
    "docker stop",
    "docker rm",
    "pip uninstall",
    "kill",
    "pkill",
)
_ENV_ASSIGNMENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*=.*$")


def _strip_yaml_run_prefix(command: str) -> str:
    value = command.strip()
    if value.startswith("- run:"):
        return value[len("- run:") :].strip()
    if value.startswith("run:"):
        return value[len("run:") :].strip()
    return value


def normalize(command: str) -> str:
    """Normalize shell launch wrappers without changing the underlying command."""
    left = _strip_yaml_run_prefix(command.split("|| true", 1)[0])
    try:
        tokens = shlex.split(left, posix=True)
    except ValueError:
        return " ".join(left.split())

    while tokens and _ENV_ASSIGNMENT.match(tokens[0]):
        tokens.pop(0)
    while tokens and tokens[0] in {"env", "command", "sudo"}:
        tokens.pop(0)
        while tokens and _ENV_ASSIGNMENT.match(tokens[0]):
            tokens.pop(0)

    if len(tokens) >= 3 and tokens[0] in {"python", "python3", "python3.12"} and tokens[1] == "-m":
        module = tokens[2]
        tokens = [module, *tokens[3:]]

    return " ".join(tokens)


def classify(command: str) -> dict[str, object]:
    original = _strip_yaml_run_prefix(command.split("|| true", 1)[0])
    normalized = normalize(command)
    kind = "ambiguous"
    if any(normalized == prefix or normalized.startswith(prefix + " ") for prefix in VALIDATION_PREFIXES):
        kind = "validation"
    elif any(normalized == prefix or normalized.startswith(prefix + " ") for prefix in CLEANUP_PREFIXES):
        kind = "cleanup"
    return {
        "command": original,
        "normalized_command": normalized,
        "kind": kind,
        "confidence": 0.98 if kind != "ambiguous" else 0.55,
    }
