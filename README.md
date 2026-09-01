# GradeSense — Reliable AI Grading & Annotation Tool

A reliable, explainable AI grading and annotation tool built for the **GradeSense Technical Assignment (AI/ML Product Engineering Intern Role)**.

> 📖 **Full System Architecture & Interaction Flow Guide:** Read [`ARCHITECTURE_FLOW.md`](ARCHITECTURE_FLOW.md) for a complete breakdown of file locations, screen layouts, button interaction matrices, and end-to-end data flows.

---

## Executive Summary & Design Philosophy

AI grading is not merely about producing a single score number — it requires **transparency, consistency, and structural reliability** so teachers can immediately verify what a student wrote, where errors occurred, how many marks were lost, and how to improve.

GradeSense addresses the core failure modes of standard LLM grading through **four structural principles**:

1. **Reasoning-Based Evaluation Over Keyword Similarity:** Prompts evaluate criterion satisfaction and logical argument validity. An English essay arguing the opposite conclusion of a reference answer receives full credit if well-reasoned. A Science answer explaining physical mechanisms correctly receives full marks even without specific jargon, while surface keyword matches containing actual conceptual errors (e.g. wiring a voltmeter in series) are correctly marked incorrect.
2. **Hard Code Invariants for Scores:** Rubric point marks are clamped strictly in TypeScript code to $[0, \text{maxMarks}]$ and total score is strictly calculated as $\sum \text{marksAwarded}$. The LLM is never trusted to calculate the total score or exceed mark limits.
3. **Decoupled, Editable Annotations:** Bounding boxes, underlines, and correction callout notes are persisted independently in SQLite. Teachers can drag to reposition, edit correction notes, delete, or manually add annotations via CRUD endpoints without re-triggering LLM grading.
4. **Dual Grader Architecture, with two distinct failure modes:** Features a live Google Gemini LLM grader (`@google/genai`) alongside a zero-dependency deterministic `MockGrader`. A network/API failure gets one backoff retry, then falls back to MockGrader as `status: 'degraded'`. A response that fails Zod schema validation gets one retry with a stricter "JSON only" prompt, then falls back to MockGrader as `status: 'failed'`. Either way `needsHumanReview = true` and the reason is shown verbatim in the UI — these are different problems, so they're reported differently rather than collapsed into one generic "something went wrong."
5. **Honest About What It Can't See — With an Optional Upgrade Path:** Text extraction cannot see a diagram or figure. By default, any rubric criterion depending on one is flagged for mandatory human review rather than confidently guessed either way — per the same principle as #4, uncertainty is reported, not hidden. When `poppler-utils` is installed (optional, see Prerequisites) and live Gemini credentials are configured, GradeSense goes further: it rasterizes the uploaded page(s) and sends the actual image to Gemini's vision input for a real visual assessment of that specific criterion, replacing the automatic review flag with a genuine (and independently verified — see below) judgment. If poppler isn't installed, or the vision call fails for any reason, this silently falls back to the same honest review-flag behavior — nothing about core grading depends on it.

---

## Technical Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Frontend** | React 19 + TypeScript + Vite | Academic paper design system, quiet typography, native TS support |
| **Backend** | Node.js + Express + TypeScript | Lightweight REST server, shared TS domain models |
| **Database** | SQLite via `better-sqlite3` | Zero-setup, single-file local persistence with WAL mode |
| **LLM Engine** | Google Gemini (`@google/genai`) + Mock Grader | Multi-pass LLM pipeline with deterministic offline test fallback |
| **PDF Processing** | `pdf-parse` & `pdf-lib` | Text extraction and non-destructive PDF canvas vector annotation overlay |
| **Testing** | Vitest | Fast, TS-native test execution with zero config |

---

## Quick Navigation & Button Map

There are exactly **two destinations** in the header:

- **`Grade a Paper`**: One always-mounted page, no routed steps. Fill the form (with a "Try a sample answer for this question" link scoped to whichever question is selected, and a collapsible "▸ View rubric criteria" disclosure) and click "Grade This Paper" — the form locks in place and a processing strip appears underneath it showing the real pipeline stages. On completion the form collapses to a one-line summary ("Q1 · Ananya Rao · 24B ✎ Edit") and the result appears below it, with the page auto-scrolling down to it. "Edit" or "Grade Another Paper" is the only way back to a blank form.
- **`History`** (badge = pending-review count): every graded result, newest first, with an "All" / "Needs Review" filter — this filter *is* the old separate Review Queue. Clicking a row opens that result directly at Stage 3.

See [`ARCHITECTURE_FLOW.md`](ARCHITECTURE_FLOW.md) for the full button-by-button matrix.

---

## Getting Started

### 1. Prerequisites
- Node.js **v18+** installed (`node -v`)
- npm **v9+** installed (`npm -v`)
- *(Optional)* **poppler-utils** (`brew install poppler` on macOS, `apt-get install poppler-utils` on Linux) — only needed for the diagram/figure visual-assessment feature (see below). Without it, everything else works identically; diagram-dependent rubric criteria are simply flagged for human review instead of AI-assessed, which is also what happens if this is missing.

### 2. Installation
Clone the repository and install all dependencies:
```bash
# Install dependencies for both backend and frontend
npm run install:all
```

### 3. Environment Setup
Copy the template and fill in your own values — **`.env` is gitignored and must never be committed**:
```bash
cp .env.example .env
```
```env
PORT=3001
USE_LLM=false        # set to "true" to use live Gemini/Vertex grading

# Option A — Gemini API key
GEMINI_API_KEY=your_gemini_api_key_here

# Option B — Vertex AI via a GCP service account. Point this at a JSON key file
# kept OUTSIDE the repo (or anywhere locally, as long as it's never committed —
# there is no "drop a key file in the project root" convention anymore; it must
# be referenced explicitly here).
# GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/your-service-account.json
```
*If no credentials are provided (`USE_LLM=false` or unset), GradeSense automatically uses the deterministic `MockGrader` — full offline functionality, no setup, no API costs, no secrets to manage.*

### 4. Running locally
Start backend and frontend dev servers concurrently:
```bash
# Terminal 1: Start backend (port 3001)
npm run dev:backend

# Terminal 2: Start frontend (port 3000)
npm run dev:frontend
```
Open **`http://localhost:3000`** in your browser.

---

## Automated Test Suite

GradeSense includes 14 automated unit and integration tests. The first 8 map directly to the assignment's required test cases; the remaining 6 cover reasoning-vs-keyword-similarity and additional reliability edge cases found during development.

### Run Tests
```bash
npm run test:backend
```

### Test Execution Output
```
 RUN  v3.2.7 /Users/raghavrathi/Gradesense/backend

 ✓ tests/gradingPipeline.test.ts (14 tests)
   ✓ 1. Should award max marks for a fully correct answer fixture                      [required: fully correct answer]
   ✓ 2. Should correctly calculate mixed marks for a partially correct answer          [required: partially correct answer]
   ✓ 3. Should award 0 or low marks for an entirely incorrect answer                   [required: incorrect answer]
   ✓ 4. Should short-circuit blank answers to 0 marks without invoking LLM API         [required: blank answer]
   ✓ 5. Should match evidence and grade accurately despite OCR-like spelling errors    [required: OCR-like spelling errors]
   ✓ 6. Should handle malformed model output gracefully and flag for human review     [required: malformed model output]
   ✓ 7. Should fall back to degraded mode on primary API failure                       [required: model/API failure]
   ✓ 8. Should strictly clamp marks to maxMarks and recompute total sum                [required: score would exceed max]
   ✓ 9. Should award 5/5 to English essay arguing OPPOSITE conclusion with strong reasoning
   ✓ 10. Should award 5/5 to Science answer using unique vocabulary but correct physics
   ✓ 11. Should mark voltmeter in series as incorrect despite keyword overlap
   ✓ 12. Should flag needsHumanReview even on a full-score result if evidence is unmatched
   ✓ 13. Should place annotation boxes at the evidence quote's real computed position
   ✓ 14. Should grade a genuinely different, correct Q1 answer on its own merits, not as Ananya's fixed wrong answers

 Test Files  1 passed (1)
      Tests  14 passed (14)
```
