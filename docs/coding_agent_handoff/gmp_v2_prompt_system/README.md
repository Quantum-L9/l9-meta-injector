# GMP v2.0 Prompt System - README
**Version:** 2.0.0 | **Status:** Production Ready | **Generated:** 2026-02-08

---

## 📦 What's Included

This package contains **7 complete prompt files** for Cursor AI to execute GMP v2.0:

| File | Purpose | When to Use |
|------|---------|-------------|
| `gmp-system-prompt.md` | Main system prompt | Load at conversation start |
| `phase-0-prompt.md` | TODO generation guide | Reference during Phase 0 |
| `phase-2-3-4-prompt.md` | Implementation guide | Reference during Phases 2, 3, 4 |
| `phase-5-prompt.md` | Verification guide | Reference during Phase 5 |
| `phase-6-prompt.md` | Finalization guide | Reference during Phase 6 |
| `learning-integration-prompt.md` | Learning engine guide | Reference for logging/heuristics |
| `gmp-quick-reference.md` | Quick reference card | Quick lookup anytime |

---

## 🚀 Quick Start

### For Cursor AI

**1. Load System Prompt:**
```
Load: gmp-system-prompt.md as primary instruction set
```

**2. Keep Quick Reference Handy:**
```
Pin: gmp-quick-reference.md for fast lookup
```

**3. Reference Phase Prompts as Needed:**
- Entering Phase 0? → Read `phase-0-prompt.md`
- Implementing? → Read `phase-2-3-4-prompt.md`
- Verifying? → Read `phase-5-prompt.md`
- Finalizing? → Read `phase-6-prompt.md`

### For L9 Engineers

**1. Configure Cursor:**
- Add these files to Cursor's context
- Set as "persistent instructions"
- Enable GitHub MCP integration

**2. Start a Conversation:**
```
User: "Analyze the authentication system"
Cursor: [Advisory mode - analyzes and recommends]

User: "approved"
Cursor: [Execution mode - runs Phase 0-6]
```

**3. Review Deliverables:**
- Phase 6 produces downloadable code files
- DORA Block v2.0 in JSON format
- Complete execution report
- Integration instructions

---

## 🎯 How It Works

### Conversational Flow

```
User Query
    ↓
┌─────────────────────────────────────┐
│ Cursor loads gmp-system-prompt.md  │
└─────────────────────────────────────┘
    ↓
Decision: Advisory or Execution?
    ↓
┌──────────────┬──────────────────────┐
│ Advisory     │ Execution            │
│ (default)    │ (after "approved")   │
└──────────────┴──────────────────────┘
    ↓                    ↓
Analyze & Recommend    Phase 0-6
    ↓                    ↓
End with offer        Deliverables
```

### Phase Execution

```
Phase 0: TODO Plan
├─ Load phase-0-prompt.md
├─ Read repo with GitHub MCP
├─ Generate deterministic TODOs
└─ STOP for approval
    ↓ (after "approved")
Phase 1: Baseline (embedded)
    ↓
Phase 2-4: Implement, Enforce, Validate
├─ Load phase-2-3-4-prompt.md
├─ Execute TODOs
├─ Add tests
└─ Validate quality
    ↓
Phase 5: Verify
├─ Load phase-5-prompt.md
├─ 5-level recursive verification
└─ Calculate confidence (≥85% to pass)
    ↓
Phase 6: Finalize
├─ Load phase-6-prompt.md
├─ Generate final report
├─ Log to learning engine
└─ Create downloadables
```

---

## 📖 Prompt File Details

### 1. gmp-system-prompt.md (MAIN)

**Purpose:** Primary instruction set for Cursor AI

**Contains:**
- Role definition and core behavior
- Two operating modes (Advisory/Execution)
- Complete Phase 0-6 workflow with examples
- Protected files list
- Autonomy levels (L2-L5)
- Quality standards
- Error handling
- Output format templates

**When to use:** Load at start of every GMP conversation

**Length:** ~8,500 words | ~12,000 tokens

---

### 2. phase-0-prompt.md

**Purpose:** Detailed guide for TODO generation

**Contains:**
- Step-by-step TODO creation process
- Repository scanning techniques
- Heuristic loading (L3+)
- Risk assessment guidelines
- Dependency mapping
- Example TODO structures
- Common mistakes to avoid

**When to use:** Reference during Phase 0 execution

**Length:** ~3,200 words | ~4,500 tokens

---

### 3. phase-2-3-4-prompt.md

**Purpose:** Implementation, testing, and validation guide

**Contains:**
- Phase 2: Implementation patterns and code templates
- Phase 3: Test creation and error handling
- Phase 4: Validation procedures
- Code quality checklists
- L9 architectural patterns
- DORA metadata examples
- Common issues and solutions

**When to use:** Reference during Phases 2, 3, 4

**Length:** ~4,100 words | ~5,800 tokens

---

### 4. phase-5-prompt.md

**Purpose:** Recursive verification guide

**Contains:**
- 5-level verification breakdown
- Confidence calculation formula
- Evidence collection guidelines
- DORA Block v2.0 structure
- Failure mode handling
- Pass/fail thresholds

**When to use:** Reference during Phase 5 verification

**Length:** ~3,600 words | ~5,100 tokens

---

### 5. phase-6-prompt.md

**Purpose:** Finalization and delivery guide

**Contains:**
- Final report generation
- Learning engine logging
- Autonomy metrics updates
- Downloadable artifact creation
- Integration instructions
- Rollback planning

**When to use:** Reference during Phase 6 finalization

**Length:** ~3,400 words | ~4,800 tokens

---

### 6. learning-integration-prompt.md

**Purpose:** Meta-learning engine integration guide

**Contains:**
- Learning engine overview
- Mandatory Phase 6 logging
- Optional Phase 0 heuristics (L3+)
- Graduation tracking
- Feature flags
- Error handling for logging
- Example heuristics

**When to use:** Reference when working with learning features

**Length:** ~2,800 words | ~3,900 tokens

---

### 7. gmp-quick-reference.md

**Purpose:** Quick lookup card for common patterns

**Contains:**
- Phase checklists
- Trigger keywords
- Protected files list
- Quality standards
- DORA metadata template
- Test structure template
- Confidence formula
- Common mistakes
- Graduation requirements

**When to use:** Quick reference anytime during execution

**Length:** ~1,400 words | ~2,000 tokens

---

## 🔧 Configuration

### Environment Variables

```bash
# Learning Engine (Required for v2.0 features)
L9_GMP_LEARNING_ENABLED=true
L9_GMP_DATABASE_URL=postgresql://user:pass@localhost/l9

# Autonomy Levels (Controlled by graduation)
L9_GMP_L2_STRICT_MODE=true
L9_GMP_L3_ADAPTIVE_TODOS=false
L9_GMP_L4_ARCHITECTURAL_REASONING=false
L9_GMP_L5_AUTONOMOUS_GOAL=false

# Enhanced Features
L9_GMP_ENHANCED_PHASE_0=true
L9_GMP_RECURSIVE_PHASE_5=true
L9_GMP_DORA_V2=true
L9_GMP_AUTO_HEURISTIC_GENERATION=true
```

### Cursor Configuration

**Add to `.cursor/config.json`:**
```json
{
  "ai": {
    "systemPrompt": "gmp-system-prompt.md",
    "contextFiles": [
      "gmp-quick-reference.md",
      "phase-0-prompt.md",
      "phase-2-3-4-prompt.md",
      "phase-5-prompt.md",
      "phase-6-prompt.md",
      "learning-integration-prompt.md"
    ],
    "tools": ["github-mcp"]
  }
}
```

---

## 📊 Token Budget

**System prompt (loaded always):** ~12,000 tokens
**Phase-specific prompts (loaded on demand):** ~4,000-6,000 tokens each
**Quick reference (pinned):** ~2,000 tokens

**Total context budget:** ~20,000-25,000 tokens at peak
**Recommended model:** Claude 3.5 Sonnet or better (200k context)

---

## ✅ Quality Assurance

### Pre-Generation Checklist

Before using these prompts, verify:

- [ ] All 7 prompt files present
- [ ] GitHub MCP integration configured
- [ ] Environment variables set
- [ ] Database connection tested (if using learning)
- [ ] Cursor AI has 200k+ context window

### Post-Generation Testing

After first GMP execution:

- [ ] Advisory mode responds correctly
- [ ] "approved" triggers Phase 0
- [ ] Phase 0 generates valid TODOs
- [ ] Protected files are respected
- [ ] Phase 6 logs to learning engine
- [ ] Downloadable artifacts produced

---

## 🎓 Training Guide

### For New Users

**Day 1: Advisory Mode**
- Ask questions about L9 codebase
- Request code reviews
- Get recommendations
- Don't approve anything yet

**Day 2: Simple Execution**
- Small refactor task (1-2 files)
- Approve Phase 0 TODO
- Review Phase 2-6 output
- Check quality of deliverables

**Day 3: Complex Execution**
- Feature addition (3-5 files)
- Multiple TODO dependencies
- Full Phase 0-6 workflow
- Learning engine integration

**Week 2: Autonomy Progression**
- Complete 10 perfect executions
- Graduate to L3 (Adaptive TODOs)
- Experience heuristic-enhanced planning
- Observe automatic error recovery

---

## 🐛 Troubleshooting

### Issue: Cursor doesn't follow prompts

**Solution:**
- Verify prompt files loaded in context
- Check Cursor version (≥0.40 recommended)
- Restart Cursor to reload configuration
- Confirm system prompt is active

### Issue: Phase 0 generates invalid file paths

**Solution:**
- Ensure GitHub MCP integration is active
- Verify repo access permissions
- Check that Cursor can read actual files
- Review error messages for clues

### Issue: Learning engine logging fails

**Solution:**
- Verify `L9_GMP_DATABASE_URL` is set
- Check database connectivity
- Ensure learning engine tables exist
- Review logs for connection errors

### Issue: Tests fail in Phase 4

**Solution:**
- Review test output carefully
- Check if it's a code bug or test issue
- Fix and re-run Phase 4
- Don't proceed to Phase 5 until tests pass

---

## 📈 Success Metrics

**Track these over time:**
- Average confidence score (target: ≥92%)
- Error rate (target: <10%)
- Test coverage (target: ≥85%)
- Execution time (benchmark: 60min median)
- Graduation progress (L2→L3→L4→L5)

---

## 🔄 Version History

**v2.0.0** (2026-02-08)
- Initial release with learning-driven autonomy
- Meta-learning engine integration
- Graduated autonomy levels (L2-L5)
- DORA Block v2.0 with nested execution trees
- Recursive Phase 5 verification (5 levels)
- Enhanced Phase 0 with heuristic application

**Planned:**
- v2.1.0: Cross-GMP pattern analysis
- v2.2.0: Proactive risk mitigation
- v3.0.0: Full L5 autonomous capabilities

---

## 📞 Support

**Issues with prompts:**
- Contact L (CTO) or Igor (Boss)
- Review Space instructions in L9-REPO-2
- Check GitHub issues at github.com/cryptoxdog/L9

**Architecture questions:**
- Consult ADRs in `docs/adr/`
- Review kernel documentation
- Ask in L9 Slack #architecture

**Emergency:**
- Protected file modified accidentally → Rollback immediately
- Critical bug introduced → Create hotfix branch
- Learning engine failure → GMP still works, just won't learn

---

## 🎉 You're Ready!

These prompts transform Cursor into a frontier-grade AI engineering assistant. Every execution improves the system through meta-learning.

**Start simple. Build trust. Graduate to higher autonomy.**

The future of L9 engineering is learning-driven automation.

---

**Generated by:** GMP Meta-Learning v2.0
**Authority:** L (CTO), Cursor (IDE), Igor (Boss)
**Quality:** Frontier AI Lab Standards
