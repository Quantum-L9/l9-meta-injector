# Phase 0 Enhanced Prompt - TODO Generation
**For:** Cursor AI | **Phase:** 0 (Planning)

---

## Your Task: Generate the TODO Plan

You've been asked to implement something. Before writing ANY code, you need to create a deterministic TODO plan that locks down EXACTLY what will change.

---

## Step 1: Read the Repository

**Use GitHub MCP tools to read actual files:**

```python
# Read files you'll modify
await github_read_file("agents/cursor/existing_module.py")
await github_read_file("tests/test_existing.py")

# Check if new files are needed
await github_list_directory("agents/cursor/")
```

**Verify:**
- ✓ Files you plan to UPDATE actually exist
- ✓ Directories for new files (CREATE) exist
- ✓ No typos in file paths
- ✓ You understand the current code structure

---

## Step 2: Load Active Heuristics (L3+ Only)

**If you're at L3 autonomy or higher**, load learned patterns:

```python
from agents.cursor.gmp_meta_learning_engine import GMPMetaLearningEngine

engine = GMPMetaLearningEngine(database_url=DB_URL)
heuristics = await engine.get_active_heuristics()

# Apply relevant heuristics
for h in heuristics:
    if h.applies_to(current_task):
        logger.info(f"Applying heuristic: {h.pattern_text}")
        # Adjust TODO plan based on recommendation
```

**Example learned patterns:**
- "Schema migrations need rollback procedures" → Add rollback TODO
- "Test tasks often have import errors" → Pre-check imports
- "TODO count > 20 takes 180+ minutes" → Warn about duration

**If you're at L2**, skip this step (you can't use heuristics yet).

---

## Step 3: Generate TODOs

**Create a numbered list of TODOs with this exact structure:**

```markdown
## Phase 0: TODO Plan

**GMP ID:** GMP-L.[autonomy-level]-[short-task-name]-2026-02-08

**Scope Summary:**
- Files to modify: [count]
- Lines to change: ~[estimate]
- Risk level: [LOW/MEDIUM/HIGH/CRITICAL]
- Estimated time: [minutes]

**TODOs:**

---

**TODO-001: [Short descriptive name]**
- **File:** `path/to/file.py`
- **Action:** CREATE | UPDATE | DELETE
- **Lines:** [for UPDATE only: start-end line numbers]
- **Risk:** LOW | MEDIUM | HIGH | CRITICAL
- **Purpose:** [1-sentence why this change is needed]
- **Dependencies:** [List other TODOs this depends on, or "None"]
- **Current code:** [For UPDATE: show existing code with line numbers]
  ```python
  # Lines 45-67 (current)
  def old_function():
      # existing implementation
  ```
- **Proposed change:** [Show what it will become]
  ```python
  # Lines 45-67 (proposed)
  def improved_function():
      # new implementation with better error handling
  ```

---

**TODO-002: [Next change]**
[Same structure]

---

[Continue for all TODOs...]

---

**TODO-XXX: Add Tests** (ALWAYS INCLUDE)
- **File:** `tests/test_[module].py`
- **Action:** CREATE or UPDATE
- **Purpose:** Ensure ≥80% coverage for new/modified code
- **Test cases:**
  - Happy path
  - Edge cases
  - Error conditions

---

**Protected Files Check:**
[List any protected files touched, or state "✓ No protected files modified"]

**Protected files requiring approval:**
- [ ] `docker-compose.yml` - Reason: [why]
- [ ] `kernel_loader.py` - Reason: [why]

**Execution Order:**
1. TODO-XXX (no dependencies)
2. TODO-YYY (depends on TODO-XXX)
3. TODO-ZZZ (testing, depends on TODO-XXX, TODO-YYY)

---

**Risk Assessment:**
- **CRITICAL risks:** [count and list]
- **HIGH risks:** [count and list]
- **MEDIUM risks:** [count and list]
- **LOW risks:** [count and list]

**Mitigation strategies:**
- [How you'll handle each risk]

---

**APPROVAL REQUIRED:** Reply "approved" to execute Phases 1-6.
```

---

## Step 4: Risk Levels - How to Categorize

| Risk Level | Criteria | Examples |
|------------|----------|----------|
| **CRITICAL** | Protected files, infrastructure, irreversible | `docker-compose.yml`, `migrations/*.sql`, `.env.production` |
| **HIGH** | Core functionality, authentication, data | `kernel_loader.py`, `auth/*`, database clients |
| **MEDIUM** | Business logic, API routes, integrations | New kernel, API endpoint changes, third-party integrations |
| **LOW** | Utility functions, tests, docs | Helper functions, test files, documentation |

**Rule:** When in doubt, go higher. Better to over-estimate risk.

---

## Step 5: Dependencies - Execution Order

**Identify dependencies between TODOs:**

- "TODO-002 depends on TODO-001" → TODO-001 must complete first
- "TODO-003 has no dependencies" → Can run anytime
- "TODO-004 depends on TODO-001, TODO-002" → Runs after both

**Create execution order:**
```markdown
**Execution Order:**
1. TODO-001, TODO-003 (parallel - no dependencies)
2. TODO-002 (depends on TODO-001)
3. TODO-004 (depends on TODO-001, TODO-002)
4. TODO-005 (testing - depends on all above)
```

---

## Step 6: Verify Your Plan

**Before submitting, check:**

- [ ] All file paths verified (exist or marked CREATE)
- [ ] UPDATE actions have line numbers
- [ ] Each TODO has risk level
- [ ] Protected files identified (if any)
- [ ] Dependencies mapped
- [ ] Execution order logical
- [ ] Tests included (TODO-XXX)
- [ ] No ambiguous language ("probably", "should", "might")
- [ ] Applied active heuristics (if L3+)

---

## Example Phase 0 Output

```markdown
## Phase 0: TODO Plan

**GMP ID:** GMP-L.2-add-auth-middleware-2026-02-08

**Scope Summary:**
- Files to modify: 3
- Lines to change: ~180
- Risk level: HIGH (touches authentication)
- Estimated time: 90 minutes

**TODOs:**

---

**TODO-001: Create JWT validation middleware**
- **File:** `api/middleware/jwt_validator.py`
- **Action:** CREATE
- **Risk:** HIGH (authentication layer)
- **Purpose:** Validate JWT tokens before reaching route handlers
- **Dependencies:** None
- **Structure:**
  ```python
  class JWTValidatorMiddleware:
      async def __call__(self, request, call_next):
          # Token extraction
          # Signature verification
          # Claims validation
          # Pass to next handler
  ```

---

**TODO-002: Integrate middleware into API router**
- **File:** `api/main.py`
- **Action:** UPDATE
- **Lines:** 25-30
- **Risk:** MEDIUM (affects all routes)
- **Purpose:** Apply JWT validation to protected routes
- **Dependencies:** TODO-001 (requires JWTValidatorMiddleware)
- **Current code:**
  ```python
  # Lines 25-30 (current)
  app = FastAPI()
  app.include_router(api_router)
  ```
- **Proposed change:**
  ```python
  # Lines 25-30 (proposed)
  app = FastAPI()
  app.add_middleware(JWTValidatorMiddleware)  # NEW
  app.include_router(api_router)
  ```

---

**TODO-003: Add comprehensive tests**
- **File:** `tests/test_jwt_validator.py`
- **Action:** CREATE
- **Risk:** LOW
- **Purpose:** Ensure ≥90% coverage (security-critical component)
- **Test cases:**
  - Valid JWT → passes through
  - Expired JWT → 401 Unauthorized
  - Invalid signature → 401 Unauthorized
  - Missing token → 401 Unauthorized
  - Malformed token → 400 Bad Request

---

**Protected Files Check:**
✓ No protected files modified

**Execution Order:**
1. TODO-001 (no dependencies)
2. TODO-002 (depends on TODO-001)
3. TODO-003 (testing, depends on TODO-001)

**Risk Assessment:**
- **HIGH risks:** 1 (authentication layer)
- **MEDIUM risks:** 1 (API router integration)
- **LOW risks:** 1 (tests)

**Mitigation:**
- Comprehensive testing (≥90% coverage)
- Rollback plan: Remove middleware line, restart API
- Gradual rollout: Test on dev/staging before production

---

**APPROVAL REQUIRED:** Reply "approved" to execute Phases 1-6.
```

---

## Common Mistakes to Avoid

### ❌ Vague TODOs
```markdown
TODO-001: Update the module
File: some_file.py
Action: UPDATE
```

### ✅ Specific TODOs
```markdown
TODO-001: Add error handling to process_data()
File: agents/cursor/data_processor.py
Lines: 145-167
Action: UPDATE
Risk: MEDIUM
Purpose: Prevent unhandled exceptions when input is None
```

---

### ❌ No Dependencies
```markdown
TODO-001: Create module
TODO-002: Use module
```

### ✅ Clear Dependencies
```markdown
TODO-001: Create module
Dependencies: None

TODO-002: Integrate module into service
Dependencies: TODO-001 (requires module to exist)
```

---

### ❌ Missing Risk Assessment
```markdown
TODO-001: Modify docker-compose.yml
```

### ✅ Risk Assessment Included
```markdown
TODO-001: Add new service to docker-compose.yml
File: docker-compose.yml
Risk: CRITICAL (infrastructure change)
Purpose: Add GMP learning engine container
**REQUIRES EXPLICIT APPROVAL** - modifies protected file
```

---

## When User Approves

**Look for these keywords:**
- "approved"
- "implement"
- "execute"
- "apply"
- "let's go"
- "proceed"

**When you see approval:**
1. Thank the user
2. Confirm you're proceeding
3. Move to **Phase 1: Baseline Research**
4. Continue through Phase 6

**Example:**
```markdown
✓ **Approval received** - Proceeding with execution

Moving to Phase 1: Baseline Research...
[Embed Phase 1 in Phase 2 header]

## Phase 2: Implementation

**Baseline Verified:**
[Show Phase 1 findings briefly]

Executing TODO-001...
```

---

## Remember

- **Read first** - Verify all file paths with GitHub MCP
- **Be specific** - Line numbers, exact paths, no ambiguity
- **Risk assess** - When in doubt, categorize higher
- **Map dependencies** - Logical execution order
- **Include tests** - Always have a testing TODO
- **Apply heuristics** - If L3+, use learned patterns
- **STOP and WAIT** - Don't proceed until "approved"

This plan is a contract. Once approved, you'll follow it exactly in Phases 2-6.
