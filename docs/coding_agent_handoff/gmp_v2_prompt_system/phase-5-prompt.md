# Phase 5 Recursive Verification Prompt
**For:** Cursor AI | **Phase:** 5 (Verify)

---

## Your Task: Multi-Level Verification

Phase 4 confirmed tests pass. Now you'll perform **5 levels** of recursive verification to build confidence in the implementation.

---

## What is Recursive Verification?

Think of it like a nested tree of checks:
- **Root:** Overall Phase 5 verification
  - **Child 1:** Level 1 - Syntax verification
  - **Child 2:** Level 2 - Semantic verification  
  - **Child 3:** Level 3 - Integration verification
  - **Child 4:** Level 4 - Regression verification
  - **Child 5:** Level 5 - Pattern verification

Each level produces evidence and a confidence score. The root combines all children into a final score.

---

## Level 1: Syntax Verification

### What to Check
- All Python files parse correctly (`ast.parse()`)
- JSON files are valid JSON
- YAML files are valid YAML
- No syntax errors

### How to Verify

```python
import ast
from pathlib import Path

for file_path in modified_files:
    if file_path.endswith('.py'):
        with open(file_path) as f:
            try:
                ast.parse(f.read())
                logger.info("Syntax valid", file=file_path)
            except SyntaxError as e:
                logger.error("Syntax error", file=file_path, error=str(e))
                # Mark as FAILURE
```

### Output Format

```markdown
### Level 1: Syntax Verification ✓

**Files Checked:**
- `agents/cursor/new_module.py` - ✓ Valid Python AST
- `agents/cursor/existing.py` - ✓ Valid Python AST
- `tests/test_new_module.py` - ✓ Valid Python AST

**Evidence:**
- `agents/cursor/new_module.py:1-EOF`
- `agents/cursor/existing.py:1-EOF`
- `tests/test_new_module.py:1-EOF`

**Status:** SUCCESS
**Confidence:** 95.0
```

---

## Level 2: Semantic Verification

### What to Check
- Imports resolve correctly
- Function signatures match expected types
- Type annotations are valid
- No undefined variables

### How to Verify

```python
import importlib
import sys

for file_path in modified_files:
    # Check imports
    module_name = path_to_module_name(file_path)
    try:
        module = importlib.import_module(module_name)
        logger.info("Imports valid", module=module_name)
    except ImportError as e:
        logger.error("Import error", module=module_name, error=str(e))
        # Mark as FAILURE
    
    # Check type hints (using mypy API or ast analysis)
    # Verify function signatures match
```

### Output Format

```markdown
### Level 2: Semantic Verification ✓

**Checks Performed:**
- Import resolution: ✓ 3/3 files
- Type annotations: ✓ All valid
- Function signatures: ✓ Matched expected
- Undefined variables: ✓ None found

**Evidence:**
- `agents/cursor/new_module.py:imports_valid`
- `agents/cursor/existing.py:signatures_match`
- `tests/test_new_module.py:types_correct`

**Status:** SUCCESS
**Confidence:** 90.0
```

---

## Level 3: Integration Verification

### What to Check
- Cross-file dependencies work
- API contracts respected
- Database migrations correct
- Feature flags don't conflict
- PacketEnvelope protocol followed (if applicable)

### How to Verify

```python
# Check cross-file dependencies
for file_a, file_b in dependency_pairs:
    verify_import_chain(file_a, file_b)
    verify_api_contract(file_a, file_b)

# If database involved
if has_migrations:
    verify_migration_syntax()
    check_rollback_script_exists()

# If feature flags involved
if uses_feature_flags:
    check_flag_conflicts()
```

### Output Format

```markdown
### Level 3: Integration Verification ✓

**Cross-File Dependencies:**
- `existing.py` → `new_module.py`: ✓ Verified
- `test_new_module.py` → `new_module.py`: ✓ Verified

**API Contracts:**
- NewModule.your_method() signature: ✓ Matches expected
- Return types: ✓ Correct

**Database Migrations:** N/A

**Feature Flags:** N/A

**PacketEnvelope Protocol:** N/A (not used in this change)

**Evidence:**
- `verified_3_files`
- `checked_5_dependencies`
- `api_contracts_valid`

**Status:** SUCCESS
**Confidence:** 88.0
```

---

## Level 4: Regression Verification

### What to Check
- Protected files unchanged (unless explicitly approved)
- System invariants preserved
- No unintended side effects
- Git diff shows only intended changes

### How to Verify

```python
import subprocess

# Check protected files
protected = [
    "docker-compose.yml",
    "kernel_loader.py",
    "websocket_orchestrator.py"
]

modified_files = get_git_modified_files()
protected_modified = [f for f in modified_files if f in protected]

if protected_modified and not approved:
    logger.error("Protected files modified without approval", 
                 files=protected_modified)
    # Mark as FAILURE

# Check git diff scope
diff = subprocess.check_output(['git', 'diff', '--stat'])
# Verify only expected files in diff
```

### Output Format

```markdown
### Level 4: Regression Verification ✓

**Protected Files:**
- ✓ No protected files modified
- ✓ Infrastructure unchanged
- ✓ Authority model intact

**System Invariants:**
- ✓ Kernel architecture preserved
- ✓ Substrate pattern maintained
- ✓ PacketEnvelope protocol unchanged

**Git Diff Analysis:**
- Files changed: 3 (expected: 3) ✓
- Lines added: 245 (within estimate) ✓
- Lines removed: 45 (expected cleanup) ✓

**Unintended Side Effects:**
- ✓ None detected

**Evidence:**
- `no_protected_files_modified`
- `invariants_preserved`
- `git_diff_matches_plan`

**Status:** SUCCESS
**Confidence:** 95.0
```

---

## Level 5: Pattern Verification

### What to Check
- L9 architectural patterns followed
- DORA metadata present
- Code style consistent
- Learned patterns matched (if L3+)

### How to Verify

```python
# Check DORA metadata
for file_path in modified_python_files:
    has_dora = check_dora_metadata_present(file_path)
    if not has_dora:
        logger.warning("Missing DORA metadata", file=file_path)

# Check L9 patterns
verify_kernel_substrate_pattern()
verify_pydantic_models_used()
verify_structlog_used()

# Check learned patterns (L3+)
if L9_GMP_L3_ADAPTIVE_TODOS:
    for heuristic in applied_heuristics:
        verify_heuristic_followed(heuristic)
```

### Output Format

```markdown
### Level 5: Pattern Verification ✓

**L9 Architectural Patterns:**
- Kernel substrate: ✓ Used correctly
- Pydantic validation: ✓ All inputs validated
- Structured logging: ✓ structlog throughout
- Async patterns: ✓ Proper async/await usage

**DORA Metadata:**
- `agents/cursor/new_module.py`: ✓ Present
- `agents/cursor/existing.py`: ✓ Updated
- `tests/test_new_module.py`: ✓ N/A (test file)

**Code Style:**
- Type hints: ✓ All functions annotated
- Docstrings: ✓ Google style throughout
- Error handling: ✓ Comprehensive try/except
- Import organization: ✓ Consistent

**Learned Patterns (L3+):** N/A (L2 execution)

**Evidence:**
- `pattern_consistency_check_passed`
- `dora_metadata_verified`
- `code_style_consistent`

**Status:** SUCCESS
**Confidence:** 90.0
```

---

## Confidence Calculation

### Formula

```python
def calculate_confidence(node: ExecutionNode) -> float:
    """
    Calculate deterministic confidence score.
    
    Formula:
    1. Start with base score (70)
    2. Add evidence factor (up to +25%)
    3. Multiply by success factor (+20% if all children SUCCESS, -20% if any FAILURE)
    4. Subtract failure penalties (severity-weighted)
    5. Clamp to [0, 100]
    """
    base_score = 70.0
    
    # Evidence factor: +5% per evidence item, max 5 items = +25%
    evidence_factor = 1.0 + (min(len(node.evidence), 5) * 0.05)
    
    # Success factor based on children
    if node.children:
        all_success = all(c.status == "SUCCESS" for c in node.children)
        any_failure = any(c.status == "FAILURE" for c in node.children)
        
        if all_success:
            success_factor = 1.2  # +20% boost
        elif any_failure:
            success_factor = 0.8  # -20% penalty
        else:
            success_factor = 1.0  # neutral
    else:
        success_factor = 1.0 if node.status == "SUCCESS" else 0.8
    
    # Failure penalty
    severity_weights = {
        "LOW": 2,
        "MEDIUM": 5,
        "HIGH": 10,
        "CRITICAL": 20
    }
    
    failure_penalty = sum(
        severity_weights.get(fm.severity, 0)
        for fm in node.failure_modes
        if fm.occurred
    )
    
    # Calculate final score
    confidence = (base_score * evidence_factor * success_factor) - failure_penalty
    
    # Clamp to [0, 100]
    return max(0, min(100, confidence))
```

### Example Calculation

```markdown
**Root Node (Phase 5):**
- Base score: 70
- Evidence: 5 items → factor = 1.25
- Children: All 5 levels SUCCESS → success_factor = 1.2
- Failure modes: None → penalty = 0

Confidence = (70 × 1.25 × 1.2) - 0
           = 105 - 0
           = 105 → capped at 92.5

**Final confidence:** 92.5/100
```

---

## Complete Output Format

```markdown
## Phase 5: Recursive Verification

**Verification Levels:**

### Level 1: Syntax ✓
- Files checked: 3
- All valid Python AST
- Evidence: file:1-EOF for all
- **Confidence:** 95.0

### Level 2: Semantics ✓
- Imports: ✓ All resolve
- Signatures: ✓ All match
- Types: ✓ All valid
- Evidence: imports_valid, signatures_match
- **Confidence:** 90.0

### Level 3: Integration ✓
- Dependencies: ✓ 5 checked
- API contracts: ✓ Valid
- Evidence: verified_3_files, contracts_valid
- **Confidence:** 88.0

### Level 4: Regression ✓
- Protected files: ✓ None modified
- Invariants: ✓ Preserved
- Evidence: no_protected_changes, invariants_ok
- **Confidence:** 95.0

### Level 5: Patterns ✓
- L9 architecture: ✓ Followed
- DORA metadata: ✓ Present
- Code style: ✓ Consistent
- Evidence: patterns_verified
- **Confidence:** 90.0

---

**Overall Confidence Score:** 92.5/100

**Pass Threshold:** 85%
**Result:** ✅ PASS

**Confidence Calculation:**
```
Base: 70
Evidence factor: 1.25 (5 items)
Success factor: 1.2 (all levels SUCCESS)
Failure penalty: 0
Final: (70 × 1.25 × 1.2) - 0 = 105 → capped at 92.5
```

**DORA Block v2.0:**
```json
{
  "block_id": "GMP-L.2-task-2026-02-08-PHASE5-DORA",
  "phase": "PHASE_5",
  "gmp_id": "GMP-L.2-task-2026-02-08",
  "execution_tree": {
    "node_id": "phase5-root",
    "task": "Phase 5: Recursive Verification",
    "status": "SUCCESS",
    "start_time": "2026-02-08T00:35:00Z",
    "end_time": "2026-02-08T00:37:15Z",
    "confidence": 92.5,
    "evidence": [
      "verified_all_levels",
      "no_failures_detected"
    ],
    "children": [
      {
        "node_id": "verify-syntax",
        "task": "Level 1: Syntax Verification",
        "status": "SUCCESS",
        "confidence": 95.0,
        "evidence": [
          "agents/cursor/new_module.py:1-EOF",
          "agents/cursor/existing.py:1-EOF",
          "tests/test_new_module.py:1-EOF"
        ]
      },
      {
        "node_id": "verify-semantics",
        "task": "Level 2: Semantic Verification",
        "status": "SUCCESS",
        "confidence": 90.0,
        "evidence": [
          "imports_valid",
          "signatures_match"
        ]
      },
      {
        "node_id": "verify-integration",
        "task": "Level 3: Integration Verification",
        "status": "SUCCESS",
        "confidence": 88.0,
        "evidence": [
          "verified_3_files",
          "checked_5_dependencies"
        ]
      },
      {
        "node_id": "verify-regression",
        "task": "Level 4: Regression Verification",
        "status": "SUCCESS",
        "confidence": 95.0,
        "evidence": [
          "no_protected_files_modified",
          "invariants_preserved"
        ]
      },
      {
        "node_id": "verify-patterns",
        "task": "Level 5: Pattern Verification",
        "status": "SUCCESS",
        "confidence": 90.0,
        "evidence": [
          "pattern_consistency_passed"
        ]
      }
    ],
    "failure_modes": []
  },
  "total_confidence": 92.5,
  "generated_at": "2026-02-08T00:37:15Z"
}
```

**Phase 5 Complete** - Proceeding to Phase 6...
```

---

## When Failures Occur

### Failure Mode Structure

If any level fails, document it:

```markdown
### Level 3: Integration Verification ⚠️

**Issue Detected:**
- Cross-file dependency broken
- `existing.py` imports `NonexistentClass` from `new_module.py`

**Failure Mode:**
```json
{
  "failure_id": "INTEGRATION-001",
  "description": "Import error: NonexistentClass not found",
  "severity": "HIGH",
  "mitigation": "Add NonexistentClass to new_module.py or remove import",
  "occurred": true,
  "timestamp": "2026-02-08T00:36:22Z"
}
```

**Confidence Impact:**
- Penalty: -10 points (HIGH severity)
- Adjusted confidence: 78.0 (below 85% threshold)

**Status:** ❌ FAILURE
**Action Required:** Fix import issue and re-run Phase 5
```

### Overall Failure

If confidence < 85%, Phase 5 fails:

```markdown
**Overall Confidence Score:** 78.0/100

**Pass Threshold:** 85%
**Result:** ❌ FAIL

**Reason:** Integration verification failed (import errors)

**Required Actions:**
1. Fix import in `existing.py` line 45
2. Verify NonexistentClass exists in `new_module.py`
3. Re-run Phase 5 verification

**Status:** PAUSED - Awaiting fixes
```

---

## Remember

- **Five levels always** - Never skip a level
- **Evidence required** - Each level needs proof
- **Confidence deterministic** - Same inputs = same score
- **85% to pass** - Threshold is firm
- **Document failures** - Help learning engine improve
- **DORA Block v2.0** - Include full execution tree

This recursive approach builds confidence from the bottom up, ensuring every aspect of the change is verified.
