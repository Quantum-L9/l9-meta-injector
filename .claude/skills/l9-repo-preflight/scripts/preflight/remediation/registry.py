from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RemediationSpec:
    id: str
    executor: str
    preconditions: tuple[str, ...]
    supports_autofix: bool
    rank: int


REGISTRY = {
    "pin_static_github_action": RemediationSpec(
        "pin_static_github_action",
        "patch_yaml_scalar",
        ("static_action_path", "resolved_commit_sha", "valid_yaml"),
        True,
        10,
    ),
    "remove_validation_suppression": RemediationSpec(
        "remove_validation_suppression",
        "patch_shell_command",
        ("validation_command_identified", "behavior_preserved", "valid_yaml"),
        True,
        10,
    ),
    "redesign_dynamic_action_reference": RemediationSpec(
        "redesign_dynamic_action_reference",
        "recommended_design_change",
        ("dynamic_action_path",),
        False,
        20,
    ),
    "governed_action_pin_exception": RemediationSpec(
        "governed_action_pin_exception",
        "exception_record",
        ("owner", "reason", "expires_at"),
        False,
        90,
    ),
}


def can_claim_autofix(
    remediation_id: str | None,
    preconditions: dict[str, bool],
    dry_run_valid: bool,
) -> bool:
    spec = REGISTRY.get(remediation_id or "")
    return bool(
        spec
        and spec.supports_autofix
        and dry_run_valid
        and all(preconditions.get(item, False) for item in spec.preconditions)
    )


def ranked_remediations(remediation_ids: list[str]) -> list[str]:
    """Return registered remediations in structural-first, exception-last order."""
    return sorted(
        (item for item in remediation_ids if item in REGISTRY),
        key=lambda item: (REGISTRY[item].rank, item),
    )
