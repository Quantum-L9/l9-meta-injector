# Phase 6 Finalization Prompt
**For:** Cursor AI | **Phase:** 6 (Finalize)

---

## Your Task: Package Everything and Log Learning

Phase 5 passed with confidence ≥85%. Now you'll create the final deliverables, log execution to the learning engine, and update autonomy metrics.

---

## Step 1: Generate Final Report

### Output Format

```markdown
## Phase 6: Finalize - Execution Complete ✅

**Execution Summary:**
- **GMP ID:** GMP-L.2-task-name-2026-02-08
- **Task Type:** refactor | feature | schema | docs | tests | bugfix
- **Status:** ✓ SUCCESS
- **Final Confidence:** 92.5/100
- **Duration:** 45 minutes (estimated: 60 minutes)
- **Autonomy Level:** L2 (Constrained Execution)

---

### Files Modified

**Created:**
1. `agents/cursor/new_module.py` (150 lines)
   - Purpose: Implements NewModule service
   - DORA metadata: ✓ Present
   - Tests: ✓ Covered

2. `tests/test_new_module.py` (45 lines)
   - Purpose: Unit tests for NewModule
   - Coverage: 87%

**Updated:**
3. `agents/cursor/existing.py` (lines 45-67, +22 lines)
   - Purpose: Integrated NewModule into existing service
   - Changes: Added import, updated method with error handling

**Total Changes:**
- Files modified: 3
- Lines added: 217
- Lines removed: 45
- Net change: +172 lines

---

### Test Results

**Unit Tests:**
- Executed: 14 tests
- Passed: 14 ✓
- Failed: 0
- Coverage: 87% (target: ≥80%)

**Integration Tests:**
- Executed: 2 tests
- Passed: 2 ✓
- Failed: 0

**Regression Tests:**
- Existing tests: 127
- Still passing: 127 ✓
- New failures: 0 ✓

**Overall:** ✅ 143/143 tests passed

---

### Quality Metrics

**Code Quality:**
- Ruff (linting): ✓ Passed
- MyPy (type checking): ✓ Passed
- Import sorting: ✓ Passed

**Security:**
- No hardcoded credentials: ✓
- Input validation: ✓ Pydantic models
- Error handling: ✓ Comprehensive

**Performance:**
- No performance degradation detected
- Average response time: 115ms (baseline: 120ms)

---

### Phase 5 Verification Summary

**All Levels Passed:**

| Level | Description | Confidence | Status |
|-------|-------------|------------|--------|
| 1 | Syntax | 95.0 | ✓ SUCCESS |
| 2 | Semantics | 90.0 | ✓ SUCCESS |
| 3 | Integration | 88.0 | ✓ SUCCESS |
| 4 | Regression | 95.0 | ✓ SUCCESS |
| 5 | Patterns | 90.0 | ✓ SUCCESS |

**Overall Confidence:** 92.5/100 (threshold: 85%)

---

### DORA Block v2.0

**Complete Execution Tree:**

[Include full JSON from Phase 5]

**Download:** [dora-block-GMP-L.2-task-2026-02-08.json]

---

### Learning Metrics Logged

**Execution Result:**
- GMP ID: GMP-L.2-task-name-2026-02-08
- Task type: feature
- TODO count: 3
- Duration: 45 minutes
- Errors: 0
- Final confidence: 92.5
- Audit result: PASS

**Autonomy Progress:**
- Current level: L2 (Constrained Execution)
- Perfect executions: 1/10 toward L3
- Graduation status: In progress

---

### Downloadable Artifacts

**Ready for Integration:**

1. **Code Files** (see deliverables below)
2. **Test Files** (see deliverables below)
3. **DORA Block v2.0** (JSON)
4. **Execution Report** (this document)

---

## 🎉 GMP Execution Complete!

All changes are production-ready and verified. Review the files below and integrate into L9 repository.

**Next Steps:**
1. Review code changes
2. Run full test suite locally (optional verification)
3. Commit to feature branch
4. Create pull request
5. Deploy after PR approval

---

## Deliverable Files

[Include full code for each modified/created file]
```

---

## Step 2: Log to Learning Engine

### What to Log

```python
from agents.cursor.gmp_meta_learning_engine import (
    GMPMetaLearningEngine,
    GMPExecutionResult
)

# Create execution result
result = GMPExecutionResult(
    gmp_id="GMP-L.2-task-name-2026-02-08",
    task_type="feature",  # refactor | feature | schema | docs | tests | bugfix
    todo_count=3,
    execution_minutes=45,
    error_count=0,
    error_types=[],  # Empty if no errors
    files_modified=["agents/cursor/new_module.py", "agents/cursor/existing.py", "tests/test_new_module.py"],
    lines_changed=172,
    final_confidence=92.5,
    audit_result="PASS",  # PASS | CONDITIONAL | FAIL
    created_at=datetime.utcnow(),
    l9_kernel_versions=get_kernel_versions(),
    feature_flags_enabled=get_active_flags()
)

# Log to engine
engine = GMPMetaLearningEngine(database_url=DB_URL)
success = await engine.log_execution(result)

if success:
    logger.info("Execution logged to learning engine", gmp_id=result.gmp_id)
else:
    logger.error("Failed to log execution", gmp_id=result.gmp_id)
```

### Error Logging (if errors occurred)

```python
# If there were errors during execution
result = GMPExecutionResult(
    gmp_id="GMP-L.2-task-name-2026-02-08",
    task_type="feature",
    todo_count=3,
    execution_minutes=60,
    error_count=2,
    error_types=["ImportError", "ValueError"],  # List of exception types
    files_modified=["agents/cursor/new_module.py"],
    lines_changed=150,
    final_confidence=75.0,  # Lower due to errors
    audit_result="CONDITIONAL",  # Not a clean pass
    created_at=datetime.utcnow(),
    l9_kernel_versions=get_kernel_versions(),
    feature_flags_enabled=get_active_flags()
)
```

---

## Step 3: Update Autonomy Metrics

### Check Graduation Status

```python
from agents.cursor.gmp_meta_learning_engine import AutonomyController

controller = AutonomyController(engine)

# Update metrics with this execution
metrics = await controller.update_metrics_with_execution(result)

# Check if graduation is possible
can_graduate, reason = await controller.can_graduate_to_next_level()

if can_graduate:
    logger.info("Graduation available", reason=reason)
    # Show to user
else:
    logger.info("Graduation not yet available", reason=reason)
```

### Show Progress to User

```markdown
**Autonomy Progress:**

**Current Level:** L2 (Constrained Execution)

**L2 → L3 Graduation Progress:**
- Perfect executions: 1/10 ✓
- Requirements:
  - 10 consecutive executions with:
    - error_count = 0 ✓
    - final_confidence ≥ 95 (current: 92.5) ⚠️
    - audit_result = "PASS" ✓

**Next Steps:**
- 9 more perfect executions needed
- Maintain confidence ≥ 95% (slightly below this time)
- Keep error count at 0

**Estimated Time to L3:** ~9 more GMP executions
```

---

## Step 4: Create Downloadable Artifacts

### File Structure

Create clean markdown with all code:

```markdown
# GMP Deliverables: [Task Name]
**GMP ID:** GMP-L.2-task-name-2026-02-08
**Generated:** 2026-02-08T00:45:00Z

---

## File 1: agents/cursor/new_module.py

**Action:** CREATE
**Lines:** 150
**Purpose:** Implements NewModule service

```python
[FULL FILE CONTENTS HERE]
```

---

## File 2: agents/cursor/existing.py

**Action:** UPDATE (lines 45-67)
**Lines Changed:** +22
**Purpose:** Integrated NewModule into existing service

**Full Updated File:**

```python
[FULL FILE CONTENTS HERE - not just the changed section]
```

---

## File 3: tests/test_new_module.py

**Action:** CREATE
**Lines:** 45
**Purpose:** Unit tests for NewModule

```python
[FULL FILE CONTENTS HERE]
```

---

## DORA Block v2.0

**File:** dora-block-GMP-L.2-task-2026-02-08.json

```json
[FULL DORA BLOCK JSON HERE]
```

---

## Integration Instructions

**To integrate these changes:**

1. **Backup current code:**
   ```bash
   git checkout -b backup-before-gmp-$(date +%Y%m%d)
   git commit -m "Backup before GMP changes"
   ```

2. **Create feature branch:**
   ```bash
   git checkout -b feature/new-module-integration
   ```

3. **Apply changes:**
   - Copy File 1 to `agents/cursor/new_module.py`
   - Copy File 2 to `agents/cursor/existing.py`
   - Copy File 3 to `tests/test_new_module.py`

4. **Verify locally:**
   ```bash
   pytest tests/test_new_module.py -v
   pytest tests/ --cov=agents/cursor
   ruff check .
   mypy agents/
   ```

5. **Commit:**
   ```bash
   git add agents/cursor/new_module.py
   git add agents/cursor/existing.py
   git add tests/test_new_module.py
   git commit -m "feat: Add NewModule service [GMP-L.2-task-2026-02-08]"
   ```

6. **Push and PR:**
   ```bash
   git push origin feature/new-module-integration
   # Create pull request on GitHub
   ```

---

## Rollback Plan

**If issues arise after integration:**

```bash
# Revert to backup
git checkout backup-before-gmp-$(date +%Y%m%d)

# Or revert specific commit
git revert <commit-hash>
```

**Critical files to monitor:**
- `agents/cursor/existing.py` - Existing functionality may be affected
- All dependent services using ExistingService

---

## Questions?

Contact L (CTO) or Igor (Boss) for:
- Architecture decisions
- Production deployment approval
- Protected file modifications
```

---

## Step 5: Final Checks

### Before Completing Phase 6

- [ ] Final report generated
- [ ] Execution logged to learning engine
- [ ] Autonomy metrics updated
- [ ] Graduation status checked
- [ ] All code files included in deliverables
- [ ] DORA Block v2.0 included
- [ ] Integration instructions provided
- [ ] Rollback plan documented
- [ ] No TODOs or placeholders in deliverables
- [ ] All file paths verified correct

---

## Example Complete Phase 6 Output

```markdown
## Phase 6: Finalize - Execution Complete ✅

**Execution Summary:**
- **GMP ID:** GMP-L.2-add-jwt-middleware-2026-02-08
- **Task Type:** feature
- **Status:** ✓ SUCCESS
- **Final Confidence:** 92.5/100
- **Duration:** 45 minutes (estimated: 90 minutes, ✓ under budget)
- **Autonomy Level:** L2 (Constrained Execution)

---

### Files Modified

**Created:**
1. `api/middleware/jwt_validator.py` (180 lines)
2. `tests/test_jwt_validator.py` (67 lines)

**Updated:**
3. `api/main.py` (lines 25-30, +1 line)

**Total Changes:**
- Files modified: 3
- Lines added: 248
- Lines removed: 0
- Net change: +248 lines

---

### Test Results

**Unit Tests:** ✓ 12/12 passed
**Integration Tests:** ✓ 3/3 passed
**Regression Tests:** ✓ 127/127 passed
**Coverage:** 91% (target: ≥90% for security)

**Overall:** ✅ 142/142 tests passed

---

### Quality Metrics

**Code Quality:** ✓ All checks passed
**Security:** ✓ No vulnerabilities
**Performance:** ✓ No degradation

---

### Phase 5 Verification

**All Levels Passed:** Confidence 92.5/100 (threshold: 85%)

---

### Learning Metrics Logged ✓

**Autonomy Progress:**
- Current level: L2
- Perfect executions: 1/10 toward L3
- This execution: ✓ PASS (error_count=0, confidence=92.5)

---

### Downloadable Artifacts

[Below: Full code for all files]

---

## File 1: api/middleware/jwt_validator.py

```python
"""
Module: jwt_validator
Purpose: JWT validation middleware for API routes
Author: L9 Frontier Research (GMP v2.0)
"""

[... full file contents ...]
```

---

## File 2: tests/test_jwt_validator.py

```python
"""
Tests for JWT validation middleware.
"""

[... full file contents ...]
```

---

## File 3: api/main.py

[... full updated file ...]

---

## DORA Block v2.0

```json
{
  "block_id": "GMP-L.2-add-jwt-middleware-2026-02-08-PHASE5-DORA",
  [... full DORA block ...]
}
```

---

## Integration Instructions

[... detailed steps ...]

---

## 🎉 GMP Execution Complete!

Production-ready code verified and logged. Ready for integration into L9 repository.
```

---

## Remember

- **Log everything** - Learning engine needs complete data
- **Update metrics** - Track graduation progress
- **Include all files** - Complete, not snippets
- **Clear instructions** - Make integration easy
- **Rollback plan** - Always have an escape hatch
- **Celebrate success** - You just completed a frontier-grade GMP execution!

This is the final step. Make it count.
