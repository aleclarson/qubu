# Meta-Documentation: The Minimum Viable Framework

This framework is designed to prevent "documentation rot." It prioritizes durable principles—the "Why" and the "How we decide"—over ephemeral details that should be handled by code, types, or linting.

## 1. The Rule of Automation
Before writing a rule in a document, ask: **"Can this be a Lint rule, a TypeScript type, or a Test?"**
- If yes: Put it in the code. Code never lies; documentation eventually does.
- If no: It belongs here as a "Durable Principle."

## 2. The Three Essential Documents (The MVD Set)

### I. The Vision (The "Why")
*Durable for: 2+ years*
This document defines the project's soul. It rarely changes.
- **Problem Statement:** What specific pain point are we solving?
- **Non-Negotiables:** 3–5 "Golden Rules" (e.g., "Functional-first", "Zero dependencies").
- **Success Metric:** What does a "perfect" implementation look like in the user's hands?

### II. The Decision Framework (The "Filter")
*Durable for: 1+ year*
This is the most critical tool for preventing scope creep. It provides a checklist for saying "No."
- **Inclusion Criteria:** What must a feature prove before it's accepted?
- **Trade-off Map:** What do we value more? (e.g., "Performance > Readability" or "Safety > Conciseness").
- **The "User-Land" Test:** If it can be done by the user without changing core, why should we add it?

### III. The Mental Model (The "How")
*Durable for: 6+ months*
Instead of listing file paths or class names, describe how a developer should *think* about the system.
- **The Core Abstraction:** What is the "atom" of the project? (e.g., "Everything is a SQL fragment").
- **Data Flow:** How does data move from input to output at a high level?
- **Boundaries:** Where does our responsibility stop?

## 3. Principles for Durable Documentation

- **Focus on Intent, Not Implementation:** Don't document *what* the code does (the code shows that). Document *why* it was designed that way.
- **Avoid "Living Documents":** If a document requires weekly updates, it’s a symptom of a process failure. Move that information to the README or a Task Tracker.
- **Explicit Non-Goals:** Listing what the project *won't* do is more useful than listing what it *might* do.
- **The "Checklist" Format:** Use questions instead of commands. Questions prompt thinking; commands prompt blind following.

---

### Implementation Strategy:
1. **Audit:** Delete any document that merely repeats what a `package.json` or `tsconfig.json` already says.
2. **Condense:** If two rules share the same "Why," merge them into a single principle.
3. **Verify:** Every 3 months, read the Vision. If the code has drifted significantly without a conscious decision, update the Vision or fix the code.
