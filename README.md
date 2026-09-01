# GradeSense — Reliable AI Grading & Annotation Tool

A grading and annotation tool built for the **GradeSense Technical Assignment (AI/ML Product Engineering Intern Role)**. It reads a student's answer, compares it against a model answer and rubric, gives a score with evidence for every point, and marks up the mistakes directly on the answer paper.

> 📖 For a plain-language walkthrough of how the whole system fits together, see [`ARCHITECTURE_FLOW.md`](ARCHITECTURE_FLOW.md).

---

## What this is actually solving

A score by itself isn't useful to a teacher — they need to see what the student wrote, where it went wrong, how many marks that cost, and whether they can trust the number at all. So the whole system is built around a few plain rules, not just "call an LLM and show the result":

- **Grade the reasoning, not the wording.** An essay that argues the opposite conclusion from the model answer still gets full marks if it's well-argued. A science answer that explains the physics correctly without using the exact textbook terms still gets full marks. But an answer that uses the right keywords while getting the actual concept wrong (like wiring a voltmeter in series instead of parallel) is still marked wrong — matching words isn't the same as being correct.
- **Never trust the model with the arithmetic.** Every rubric-point score is clamped in plain code to never exceed its maximum, and the total is always the sum of the individual marks — never a number the AI reports on its own.
- **Annotations are their own thing, not glued to grading.** A teacher can move, edit, delete, or add a note without re-grading the paper. Editing an annotation and re-running the AI are two completely separate actions.
- **There are two graders, and failures are reported honestly.** A live Gemini grader and a fully offline deterministic one (no API, no key needed). If the live API fails, it retries once, then falls back to the offline grader and says so plainly (`status: degraded`). If the API responds but the output doesn't parse, it retries with a stricter prompt, then falls back and says that instead (`status: failed`). These are different problems, so they're never collapsed into one vague "something went wrong."
- **If it can't see something, it says so instead of guessing.** Text extraction can't see a diagram — so by default, any rubric point that depends on one gets flagged for a human to check rather than being scored blind. If `poppler-utils` happens to be installed and a live Gemini key is configured, GradeSense goes one step further and actually looks at the page image to judge that point for real — but that's a bonus on top of the honest default, not something the rest of the app depends on.

---

## Technical Stack

| Layer | Technology | Why |
|---|---|---|
| **Frontend** | React + TypeScript + Vite | Fast dev loop, native TS support |
| **Backend** | Node.js + Express + TypeScript | Simple REST server, shared TS types with the frontend |
| **Database** | SQLite via `better-sqlite3` | One local file, no separate DB server to run |
| **Grading** | Google Gemini (`@google/genai`) + a deterministic Mock Grader | Live LLM grading, with a zero-dependency offline fallback that needs no API key at all |
| **PDF reading** | `pdfjs-dist` | Extracts text from an uploaded PDF |
| **DOCX reading** | `mammoth` | Extracts text from an uploaded Word document |
| **PDF writing** | `pdf-lib` | Builds the annotated PDF export (never touches the original upload) |
| **Diagram vision (optional)** | `poppler-utils` (`pdftoppm`) + Gemini vision | Renders a page to an image so a diagram-based rubric point can actually be looked at, not just flagged |
| **Testing** | Vitest | TS-native, fast, no extra config |

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
