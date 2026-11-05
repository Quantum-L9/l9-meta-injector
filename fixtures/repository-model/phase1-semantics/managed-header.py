#!/usr/bin/env python3
# >>> l9:meta >>>
# id: phase1.script.managed_header__py
# title: managed-header
# artifact_type: script
# namespace: phase1-semantics
# authority: Quantum-L9/phase1-semantics
# owner: Unknown
# content_hash: Unknown
# <<< l9:meta <<<
# --- L9_META ---
# l9_schema: 1
# artifact_type: runtime_module
# component: managed_header
# tags: [script, managed]
# status: active
# --- /L9_META ---
"""A managed header stacked above a native one."""

from pkg import helpers  # noqa: F401
# ruff: noqa -- deliberate observer input for tests/architectural_observers.test.ts (ADR-082); never autofix
