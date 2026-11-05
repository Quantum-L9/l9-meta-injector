from . import compute_core  # noqa: F401
from .missing import thing  # noqa: F401


def compute() -> int:
    return 1


# ruff: noqa -- deliberate observer input for tests/architectural_observers.test.ts (ADR-082); never autofix
