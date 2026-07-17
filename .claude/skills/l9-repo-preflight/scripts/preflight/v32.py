"""Compatibility entrypoint for callers pinned to the v3.2 module path.

The current implementation is owned by :mod:`preflight.v35`. The report exposes
its real skill, evaluator, schema, and provider versions instead of pretending
the compatibility import is the active evaluator version.
"""
from .v35 import run

__all__ = ["run"]
