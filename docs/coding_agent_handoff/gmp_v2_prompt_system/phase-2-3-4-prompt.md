# Phase 2-4 Implementation Prompt
**For:** Cursor AI | **Phases:** 2 (Implement), 3 (Enforce), 4 (Validate)

---

## Your Task: Execute the Approved TODO Plan

The user approved your Phase 0 plan. Now you'll implement it exactly as specified, add guards, and validate the results.

---

## Phase 2: Implementation

### Your Job
Execute each TODO in the approved order. Generate production-ready code following L9 patterns.

### Output Format

```markdown
## Phase 2: Implementation

**Baseline Verified:** (Embed Phase 1 findings here)
- File paths: ✓ Confirmed
- L9 patterns: ✓ Loaded (kernel substrate architecture)
- Protected files: ✓ [None modified | List files requiring approval]
- Dependencies: ✓ Execution order locked

---

### TODO-001: [Name from Phase 0]

**File:** `path/to/file.py` (CREATE | UPDATE lines X-Y)

[If CREATE:]
```python
"""
Module: [name]
Purpose: [Brief description]
Author: L9 Frontier Research (GMP v2.0)
"""

# ALL imports at top
from typing import Optional, Dict, Any, List
from datetime import datetime
from pydantic import BaseModel, Field
import structlog

logger = structlog.get_logger(__name__)

# DORA Block v2.0 - ALWAYS INCLUDE
__dora_meta__ = {
    "component_name": "[ComponentName]",
    "module_version": "1.0.0",
    "created_by": "L9 Frontier Research",
    "layer": "agents | core | api | memory",
    "domain": "[specific_domain]",
    "type": "executor | router | model | service | client",
    "status": "active",
    "gmp_id": "GMP-L.X-task-2026-02-08",
    "todo_id": "TODO-001"
}

# Pydantic models for validation
class ConfigModel(BaseModel):
    """Configuration model with validation."""
    required_field: str = Field(..., description="Required setting")
    optional_field: int = Field(default=100, ge=0, description="Optional setting")

# Main implementation
class YourClass:
    """
    Brief description of what this class does.
    
    Follows L9 kernel substrate architecture patterns.
    """
    
    def __init__(self, config: ConfigModel):
        """
        Initialize with validated configuration.
        
        Args:
            config: Validated configuration object
        """
        self.config = config
        self.logger = logger.bind(component="YourClass")
    
    async def your_method(self, input_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Descriptive docstring following Google style.
        
        Args:
            input_data: Description of input parameter
            
        Returns:
            Description of return value
            
        Raises:
            ValueError: When input is invalid
            RuntimeError: When operation fails
        """
        try:
            self.logger.info("Method called", input_size=len(input_data))
            
            # Input validation
            if not input_data:
                raise ValueError("input_data cannot be empty")
            
            # Processing logic
            result = {
                "status": "success",
                "processed_at": datetime.utcnow().isoformat(),
                "data": input_data
            }
            
            return result
            
        except ValueError as e:
            self.logger.error("Validation error", error=str(e))
            raise
        except Exception as e:
            self.logger.error("Unexpected error", error=str(e), exc_info=True)
            raise RuntimeError(f"Failed to process: {e}") from e

# End DORA Block
__dora_execution__ = {
    "phase": "PHASE_2",
    "todo_id": "TODO-001",
    "status": "COMPLETED",
    "timestamp": "2026-02-08T00:30:00Z"
}
```

**Status:** ✓ Implemented

---

[If UPDATE:]

### TODO-002: [Name from Phase 0]

**File:** `path/to/existing.py` (UPDATE lines 45-67)

**Changes Applied:**
- Added import for NewModule
- Updated method signature with type hints
- Added error handling
- Improved logging

```python
# Lines 1-44 remain unchanged

from path.to.new_module import NewModule, ConfigModel  # NEW import

# Lines 45-67 REPLACED:
class ExistingClass:
    """Updated class description."""
    
    def __init__(self):
        # NEW: Initialize with new module
        config = ConfigModel(required_field="production")
        self.new_module = NewModule(config)
        self.logger = structlog.get_logger(__name__)
    
    async def existing_method(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Enhanced method description.
        
        Previously: Did X
        Now: Does X + Y with error handling
        """
        try:
            # NEW: Use new module
            result = await self.new_module.your_method(data)
            self.logger.info("Method succeeded", result_status=result["status"])
            return result
            
        except ValueError as e:
            self.logger.error("Validation failed", error=str(e))
            raise
        except Exception as e:
            self.logger.error("Processing failed", error=str(e), exc_info=True)
            raise

# Lines 68-EOF remain unchanged
```

**Status:** ✓ Implemented

---

[Continue for ALL TODOs...]

---

**Phase 2 Complete** - Proceeding to Phase 3...
```

### Code Quality Checklist

Before marking TODO complete, verify:

- [ ] **Type hints** on all functions (Python 3.10+ style)
- [ ] **Docstrings** on all public methods (Google style)
- [ ] **Error handling** with try/except and specific exceptions
- [ ] **Logging** with structlog (no print statements)
- [ ] **DORA metadata** block included
- [ ] **Input validation** with Pydantic models
- [ ] **Async/await** where appropriate
- [ ] **No TODOs** or placeholders in code
- [ ] **No hardcoded** values (use config)
- [ ] **Imports organized** (stdlib, third-party, local)

---

## Phase 3: Enforce Guards

### Your Job
Add tests, error handling, and boundary checks to protect the new code.

### Output Format

```markdown
## Phase 3: Enforce Guards

### Test Coverage Added

**Unit Tests:**
- **File:** `tests/test_new_module.py` (CREATE | UPDATE)
- **Test cases:** 12 total
  - Happy path: 4 tests
  - Edge cases: 5 tests
  - Error conditions: 3 tests
- **Coverage target:** ≥80%

```python
"""
Tests for NewModule.

Uses pytest with async support and fixtures.
"""

import pytest
from datetime import datetime
from agents.cursor.new_module import NewModule, ConfigModel


@pytest.fixture
def valid_config():
    """Fixture providing valid configuration."""
    return ConfigModel(required_field="test")


@pytest.fixture
def module(valid_config):
    """Fixture providing configured NewModule."""
    return NewModule(valid_config)


# Happy path tests
@pytest.mark.asyncio
async def test_your_method_success(module):
    """Test your_method with valid input returns success."""
    input_data = {"key": "value", "count": 42}
    result = await module.your_method(input_data)
    
    assert result["status"] == "success"
    assert "processed_at" in result
    assert result["data"] == input_data


# Edge case tests
@pytest.mark.asyncio
async def test_your_method_empty_input(module):
    """Test your_method with empty input raises ValueError."""
    with pytest.raises(ValueError, match="cannot be empty"):
        await module.your_method({})


@pytest.mark.asyncio
async def test_your_method_none_input(module):
    """Test your_method with None input raises TypeError."""
    with pytest.raises(TypeError):
        await module.your_method(None)


# Error condition tests
@pytest.mark.asyncio
async def test_your_method_invalid_data_type(module):
    """Test your_method with invalid data type raises ValueError."""
    with pytest.raises(ValueError):
        await module.your_method("not a dict")


# Parametrized tests for multiple inputs
@pytest.mark.asyncio
@pytest.mark.parametrize("input_data,expected_status", [
    ({"key": "value1"}, "success"),
    ({"key": "value2", "extra": "data"}, "success"),
    ({"count": 100}, "success"),
])
async def test_your_method_various_inputs(module, input_data, expected_status):
    """Test your_method with various valid inputs."""
    result = await module.your_method(input_data)
    assert result["status"] == expected_status
```

**Integration Tests:**
- **File:** `tests/test_new_module_integration.py`
- **Tests:** Cross-module interactions, database operations (if applicable)

---

### Error Handling Enforced

**Input Validation:**
✓ Pydantic models validate all inputs
✓ Type hints catch type errors
✓ Explicit None checks where needed

**Exception Handling:**
✓ Try/except blocks in all public methods
✓ Specific exceptions caught (ValueError, RuntimeError)
✓ Generic Exception as fallback with re-raise
✓ All errors logged with context

**Graceful Degradation:**
✓ Returns meaningful error messages
✓ Doesn't crash on bad input
✓ Preserves system state on failure

---

### Boundary Checks Added

**Implemented:**
- Empty input validation (raises ValueError)
- None checks for optional parameters
- Type validation via Pydantic
- Range checks (e.g., `ge=0` for non-negative integers)
- String length limits (e.g., `max_length=255`)
- Resource limits (timeouts, max retries)

**Example:**
```python
class ConfigModel(BaseModel):
    timeout_seconds: int = Field(default=30, ge=1, le=300)
    max_retries: int = Field(default=3, ge=0, le=10)
    api_key: str = Field(..., min_length=16, max_length=64)
```

---

**Phase 3 Complete** - Proceeding to Phase 4...
```

---

## Phase 4: Validate

### Your Job
Run tests, check code quality, verify no regressions.

### Output Format

```markdown
## Phase 4: Validate

### Test Execution Results

**Unit Tests:**
```bash
$ pytest tests/test_new_module.py -v

tests/test_new_module.py::test_your_method_success PASSED        [ 8%]
tests/test_new_module.py::test_your_method_empty_input PASSED    [16%]
tests/test_new_module.py::test_your_method_none_input PASSED     [25%]
tests/test_new_module.py::test_your_method_invalid_data PASSED   [33%]
tests/test_new_module.py::test_your_method_various_inputs[...] PASSED [41%]
[... 12 tests total ...]

============= 12 passed in 2.34s =============
```

**Integration Tests:**
```bash
$ pytest tests/test_new_module_integration.py -v

tests/test_new_module_integration.py::test_module_with_db PASSED
tests/test_new_module_integration.py::test_module_with_redis PASSED

============= 2 passed in 3.12s =============
```

**Overall:** ✓ 14/14 tests passed

---

### Coverage Report

```bash
$ pytest tests/ --cov=agents/cursor/new_module --cov-report=term-missing

Name                               Stmts   Miss  Cover   Missing
----------------------------------------------------------------
agents/cursor/new_module.py          120      15    87%   45-48, 92-95
----------------------------------------------------------------
TOTAL                                120      15    87%
```

**Coverage:** 87% (target: ≥80%) ✓

**Missing coverage analysis:**
- Lines 45-48: Error handling for rare edge case (acceptable)
- Lines 92-95: Cleanup code in __del__ (hard to test)

---

### Code Quality Checks

**Linting (Ruff):**
```bash
$ ruff check agents/cursor/new_module.py tests/test_new_module.py

All checks passed!
```

**Type Checking (MyPy):**
```bash
$ mypy agents/cursor/new_module.py --strict

Success: no issues found in 1 source file
```

**Import Sorting:**
```bash
$ ruff check --select I agents/cursor/

All checks passed!
```

---

### Regression Testing

**Existing Test Suite:**
```bash
$ pytest tests/ -v

[... existing tests ...]

============= 127 passed in 45.23s =============
```

**Regression Analysis:**
- Previously passing tests: 127
- Still passing: 127 ✓
- New failures: 0 ✓
- **Conclusion:** No regressions introduced

---

### Performance Benchmarks (if applicable)

**Before changes:**
- Average response time: 120ms
- 95th percentile: 250ms

**After changes:**
- Average response time: 115ms
- 95th percentile: 240ms

**Impact:** ✓ No performance degradation (slight improvement)

---

**Phase 4 Complete** - Proceeding to Phase 5...
```

---

## Common Issues & Solutions

### Issue: Tests Fail

**What to do:**
1. Read the error message carefully
2. Check if it's a real bug or test issue
3. If bug: Fix the code, re-run Phase 4
4. If test issue: Fix the test, re-run Phase 4
5. Log the error for learning

**Example:**
```markdown
⚠️ **Test Failure Detected**

**Test:** `test_your_method_empty_input`
**Error:** `AssertionError: Expected ValueError, got None`

**Analysis:**
Code doesn't raise ValueError on empty input as designed.

**Fix:** Adding validation to method...
[Show fixed code]

**Re-running tests...**
✓ All tests now pass
```

---

### Issue: Coverage Below 80%

**What to do:**
1. Identify uncovered lines
2. Determine if they're testable
3. Add tests for testable lines
4. Document why untestable lines are acceptable

**Example:**
```markdown
**Coverage:** 73% (below 80% target)

**Uncovered lines:**
- 45-48: Cleanup in __del__ (hard to test reliably)
- 92-110: Error recovery logic (requires specific failure conditions)

**Action:** Adding tests for error recovery (lines 92-110)
[Show new tests]

**Updated coverage:** 82% ✓
```

---

### Issue: Regressions Introduced

**What to do:**
1. Identify which tests started failing
2. Understand why (what changed)
3. Decide: Fix new code OR update test
4. Apply fix and re-validate

**Example:**
```markdown
⚠️ **Regression Detected**

**Failed test:** `tests/test_existing_feature.py::test_api_response`
**Reason:** Changed return format in API endpoint

**Decision:** Update test to match new format (change is intentional)
[Show updated test]

**Re-validation:** ✓ 127/127 tests passing
```

---

## Remember

- **Execute TODOs in order** - Respect dependencies
- **Production-ready only** - No TODOs, placeholders, or print statements
- **L9 patterns always** - Kernels, substrates, PacketEnvelope
- **DORA metadata required** - Every file gets DORA block
- **Tests are mandatory** - ≥80% coverage minimum
- **No regressions allowed** - All existing tests must pass

You're building to frontier AI lab standards. Quality over speed.
