from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any, Callable


@dataclass(frozen=True)
class ValidationIssue:
    code: str
    message: str
    severity: str
    status: str
    provenance: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def validate_kernel_bindings(registry: Any) -> list[ValidationIssue]:
    issues: list[ValidationIssue] = []
    for kernel_id, contract in registry.contracts.items():
        if kernel_id not in registry.bindings:
            issues.append(ValidationIssue(
                'KERNEL_UNBOUND', f'kernel has no runtime binding: {kernel_id}', 'high',
                'blocker' if contract.fail_closed else 'warning', {'kernel_id': kernel_id},
            ))
        for required in contract.requires:
            if required not in registry.contracts and required not in registry.bindings:
                issues.append(ValidationIssue(
                    'KERNEL_REQUIREMENT_UNRESOLVED',
                    f'{kernel_id} requires unresolved contract {required}', 'high',
                    'blocker' if contract.fail_closed else 'warning',
                    {'kernel_id': kernel_id, 'required': required},
                ))
    return issues


def guarded_execute(
    operation: Callable[[], Any], *, component: str, mandatory: bool,
) -> tuple[Any | None, list[ValidationIssue]]:
    try:
        return operation(), []
    except Exception as exc:  # boundary converts runtime failure to canonical evidence
        issue = ValidationIssue(
            code='COMPONENT_EXECUTION_ERROR',
            message=f'{component} failed with {type(exc).__name__}: {str(exc)[:500]}',
            severity='high' if mandatory else 'medium',
            status='requires_human_review' if mandatory else 'warning',
            provenance={'component': component, 'exception_type': type(exc).__name__},
        )
        return None, [issue]
