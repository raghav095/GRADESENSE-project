# GradeSense — Architecture, Component Map & System Flow Guide

This document is a comprehensive, end-to-end structural breakdown of **GradeSense**: how the application works, how data flows through the backend pipeline, where every component is placed, and exactly which button triggers which action across the interface.

---

## 1. Directory & Codebase Map

```
Gradesense/
├── backend/
│   ├── src/
│   │   ├── db/
│   │   │   ├── schema.ts            # SQLite schema, table definitions, seed data (Q1, Q2, Q3), forward-only column migrations
│   │   │   └── index.ts             # Database connection singleton (better-sqlite3)
│   │   ├── services/
│   │   │   ├── types.ts             # Domain models (Question, RubricPoint, Submission, GradingResult, Annotation, Grader)
│   │   │   ├── llmOutputSchema.ts   # Zod schema — the runtime contract every raw LLM response is validated against
│   │   │   ├── textLayout.ts        # Single source of truth: turns answer text into a paginated line layout, used by
│   │   │   │                        #   BOTH the annotation-position calculator and the PDF exporter, so they can never disagree
│   │   │   ├── gradingPipeline.ts   # Core pipeline: retry/schema-validation, clamping invariants, fuzzy quote matcher
│   │   │   │                        #   with real character offsets, verification, confidence, annotation placement
│   │   │   ├── mockGrader.ts        # Zero-dependency deterministic grader with fixture-based verification rule evaluation
│   │   │   ├── geminiGrader.ts      # Live Google Gemini / Vertex AI SDK grader (@google/genai) + GraderCallError
│   │   │   └── pdfService.ts        # pdf-parse text extraction + pdf-lib canonical PDF renderer/annotation exporter
│   │   ├── routes/
│   │   │   ├── questions.ts         # GET/POST questions & rubric points
│   │   │   ├── submissions.ts       # POST upload student paper & POST trigger grading pipeline
│   │   │   ├── results.ts           # GET past results, GET detail payload, GET logs, GET PDF export
│   │   │   └── annotations.ts       # Decoupled CRUD endpoints (PATCH, POST, DELETE annotations)
│   │   └── server.ts                # Express server entry point (port from $PORT, default 3001)
│   └── tests/
│       └── gradingPipeline.test.ts  # 13 automated Vitest unit & integration edge-case tests
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.tsx           # Top bar: brand + exactly two nav destinations (Grade a Paper / History)
│   │   │   ├── GradeFlow.tsx        # The one-page grading journey: form -> inline processing strip -> result,
│   │   │   │                        #   all appended in place (no routed steps — see § 2)
│   │   │   ├── Stage1Provide.tsx    # The form: question + rubric disclosure + contextual sample link + upload/paste;
│   │   │   │                        #   stays mounted (locked) while grading runs, doesn't unmount/navigate away
│   │   │   ├── ProcessingStrip.tsx  # Inline pipeline-stage progress (reading / checking / verifying) appended
│   │   │   │                        #   under the locked form — transient feedback, not a page
│   │   │   ├── Stage3Result.tsx     # The result block: score/status banner, paper + rubric side by side, export +
│   │   │   │                        #   "grade another" — identical whether reached live or opened from History
│   │   │   ├── ResultHeader.tsx     # Score fraction, status banner with inline specific reason, export/audit buttons
│   │   │   ├── PdfViewerCanvas.tsx  # Student paper render, offset-based red-pen highlights (HTML-escaped, no XSS)
│   │   │   ├── RubricSidebar.tsx    # Rubric list with status markers & score fractions, linked to the highlighted paper
│   │   │   ├── HistoryView.tsx      # All past results, with an inline "Needs Review" filter (folds in the old Review Queue)
│   │   │   └── AuditLogModal.tsx    # Modal inspecting raw LLM requests/responses, model name & latency
│   │   ├── App.tsx                  # Root: two-destination view switch (grade flow / history), review-count badge
│   │   ├── types.ts                 # Frontend TypeScript interfaces
│   │   ├── main.tsx                 # React DOM mount entry
│   │   └── index.css                # Academic paper & red-pen CSS design system
│   └── index.html                   # HTML template with Google Fonts (Source Serif 4, IBM Plex Sans, IBM Plex Mono)
│
├── samples/                          # Reference question paper, model answer/rubric, sample annotated export
├── ARCHITECTURE_FLOW.md              # THIS DOCUMENT
├── README.md                         # Setup & run instructions, env vars
├── .env.example                      # Template for local env vars — copy to .env, never commit the real one
└── .gitignore                        # Excludes .env, any *-key.json service-account file, *.db*, uploads/
```

`gcp-key.json` (a GCP service-account key, if you use one locally) and `.env` are **not** part of the tracked tree — both are gitignored. See README § Environment Setup.

---

## 2. Screen Layout — one flow, two destinations

The app used to be five separate nav tabs (Dashboard, Grade New Paper, Active Sheet & Annotations, Review Queue, Mark Register) that the user got silently switched between after every action.

An earlier version of this redesign replaced that with a **routed 3-step wizard** (numbered Select & Provide / Grading / Result stages, each a separate page-level state). That was rejected before shipping, for three reasons worth recording:

1. "Grading" isn't a real stage — you don't act during it, you just wait. Giving it equal visual weight to a step you actually make decisions in overstates it.
2. Routed steps that unmount/remount on every transition are exactly the failure shape that made the old "Active Sheet" tab go stale in the first place — more state transitions is more chances for a step to render before its data exists, which is the wrong direction to move under time pressure.
3. It didn't extend to "open a paper from History" — retroactively showing steps 1–2 checked off for a paper you didn't just grade is meaningless. That's a sign the stepper was really a live-grading-only metaphor, not a general result-viewing pattern.

What's actually built instead — one always-mounted page, `phase` only ever controls what's appended below the form in the same scroll, never a route:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [GradeSense]                              Grade a Paper      History (2) │ ← Header.tsx — 2 destinations, always visible
├──────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  DESTINATION 1: Grade a Paper  (GradeFlow.tsx)                          │
│                                                                          │
│  [ Stage1Provide.tsx — the form ]                                       │
│  - Question dropdown, ▸ collapsible rubric, "Try a sample for this      │
│    question", student name/roll, upload PDF or paste text               │
│  - "Grade This Paper →" (disabled with a reason until ready)            │
│           │ click                                                       │
│           ▼                                                             │
│  [ SAME form, now locked/read-only, ProcessingStrip.tsx appended below ]│
│  - "Reading the answer paper..." ✓   "Checking each rubric point..." ⋯  │
│  - "Verifying evidence..."                                              │
│           │ completes                                                   │
│           ▼                                                             │
│  [ Form collapses to a one-line summary + "✎ Edit" ]                   │
│  [ Stage3Result.tsx appears below, page auto-scrolls down to it ]       │
│  - Score + status banner, reason inline                                 │
│  - Paper (highlights) | Rubric list                                     │
│  - Export PDF · Grade Another Paper                                     │
│                                                                          │
│  DESTINATION 2: History  (HistoryView.tsx)                              │
│  - Every graded result, newest first                                    │
│  - "All" / "Needs Review" filter toggle (this IS the old Review Queue)  │
│  - Row click -> renders ONLY Stage3Result.tsx — no ghost form or        │
│    processing strip above it, since it's a saved paper being reviewed,  │
│    not one mid-flow. "Grade Another Paper" from here starts a fresh form.│
│  - Per-row: export PDF, delete                                          │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

A graded result is reachable exactly two ways: finishing the grade flow, or clicking a History row — and both paths render the exact same `Stage3Result` component with the exact same props. It is never its own nav item.

---

## 3. Button & Interactive Action Matrix

| Button / Control | Location | What It Triggers | Backend API | Resulting State |
|---|---|---|---|---|
| **"Grade a Paper"** (nav) | Header | Returns to the grade flow, at whatever stage it's in | None | `activeView = 'grade'` |
| **"History"** (nav, badge = review count) | Header | Opens the History table | `GET /api/results?reviewOnly=true` (badge only) | `activeView = 'history'` |
| **▸ "View rubric criteria for this question"** | Form | Expands the rubric list inline | None | Toggles local `rubricOpen` |
| **"Try a sample answer for this question"** | Form | Fills the form with a sample scoped to the *currently selected* question | None (client-side fixture) | Fills name/roll/text fields |
| **"Grade This Paper →"** (disabled until ready, tooltip explains why) | Form | Uploads the submission and starts grading | `POST /api/submissions` → `POST /api/submissions/:id/grade` | Form locks in place, `ProcessingStrip` appears below it |
| *(automatic)* | Processing strip | Shows pipeline steps completing while the one grading request is in flight | — | On success → form collapses to a summary, Result appears below, auto-scroll; on failure → form unlocks with the error shown, nothing collapses |
| **"Export Annotated PDF"** | Result / History row | Renders and downloads the annotated PDF | `GET /api/results/:id/export` | Opens PDF download |
| **"Audit Logs"** | Result | Opens the raw LLM request/response log | `GET /api/results/:id/logs` | Opens `AuditLogModal` |
| **Rubric row / red-pen highlight** | Result | Cross-highlights the matching paper text / rubric row | None (client state) | Updates `selectedRubricPointId` |
| **"Edit" / "Delete"** (per annotation, shown on hover) | Result | Edits or removes one correction note | `PATCH` / `DELETE /api/annotations/:id` | Updates DB & UI, **never re-grades** |
| **"+ Add Correction Box"** | Result | Adds a manual teacher note | `POST /api/annotations` | Inserts new annotation |
| **"✎ Edit"** (collapsed summary bar) / **"Grade Another Paper"** (bottom of Result) | Result | Returns to a clean, blank form | None | `phase = 'form'`, result cleared |
| **"All" / "Needs Review" toggle** | History | Filters the table client-side | None | Toggles local `filter` |
| **History row click** | History | Opens that result — ONLY the Result block, no form above it | `GET /api/results/:id` | `activeView='grade'`, `viewingFromHistory=true` |

---

## 4. End-to-End Data & Execution Flows

### Flow A: Submitting & Grading a Student Answer Paper

```
[ User fills the form, clicks "Grade This Paper" — form locks, ProcessingStrip appends below it ]
                  │
                  ▼
[ POST /api/submissions ] ──> Extract PDF text if uploaded ──> Insert into `submissions`
                  │
                  ▼
[ POST /api/submissions/:id/grade ]  (gradingPipeline.ts)
                  │
                  ├─ 1. Short-circuit: blank/whitespace answer → all points "missing", 0 marks,
                  │      confidence 1.0, no API call at all
                  │
                  ├─ 2. Primary grading call
                  │      - network/API failure  → one backoff retry (300ms) → still failing → `isDegraded`
                  │      - schema-invalid JSON  → one retry with a stricter "JSON only" prompt → still
                  │        invalid → `isFailedSchema`
                  │      (these are DIFFERENT failure modes with different recoveries — see llmOutputSchema.ts)
                  │
                  ├─ 3. Safety-net fallback: if either failure happened, MockGrader produces a real
                  │      result so the user always gets one — but `status` stays honest:
                  │        isDegraded    → status: 'degraded' ("primary API failed")
                  │        isFailedSchema→ status: 'failed'   ("primary output never validated")
                  │
                  ├─ 4. Deterministic post-processing (code, never the LLM):
                  │      - marksAwarded clamped to [0, maxMarks] per point
                  │      - fuzzyMatchQuote locates each evidence quote in the ORIGINAL answer text
                  │        (case/whitespace-tolerant) and returns real [startOffset, endOffset)
                  │      - totalMarks = Σ marksAwarded, always recomputed, never read from the model
                  │      - annotations are placed via textLayout.computeTextLayout + boxesForRange,
                  │        using those same offsets — one box per line the quote visually spans.
                  │        An UNMATCHED quote gets NO annotation (nothing is drawn that can't be justified).
                  │
                  ├─ 5. Verification pass: re-checks every point that has an evidence quote
                  │      ("does this quote actually support this status?")
                  │
                  ├─ 6. Confidence & review flag (uniform — no full-score exemption):
                  │      confidence = weighted(quoteMatchRate, verificationAgreeRate)
                  │      needsHumanReview = isDegraded OR isFailedSchema OR confidence < 0.75
                  │                         OR verification disagreed OR unmatched evidence on a
                  │                         nonzero-mark point — including a FULL-SCORE result; a
                  │                         perfect score with a fabricated evidence quote is exactly
                  │                         the case this flag exists to catch.
                  │
                  └─ 7. Persist to SQLite (result, point results, annotations, raw LLM logs) & return
                                    │
                                    ▼
[ ProcessingStrip shows completion → form collapses to a summary → Result block appends below it, page auto-scrolls down ]
```

### Flow B: Highlighting & Annotation Placement

```
studentAnswerText (original, unmodified)
        │
        ├─► fuzzyMatchQuote(quote, text) → { matched, startOffset, endOffset }
        │         (used for BOTH the on-screen highlight and the annotation boxes —
        │          one calculation, two consumers, so they can never show different things)
        │
        ├─► Frontend: PdfViewerCanvas slices the text at those offsets, HTML-escapes every
        │   segment, and wraps only the matched range in a <mark> — untrusted student text
        │   is never passed to dangerouslySetInnerHTML unescaped.
        │
        └─► Backend: textLayout.computeTextLayout(text) word-wraps the same text into a
            fixed-width paginated line layout; boxesForRange(layout, start, end) returns
            one box per line the quote spans. Stored as real Annotation rows.
```

### Flow C: Non-Destructive Annotation Editing

```
[ User edits/deletes/adds an annotation on Stage 3 ]
                  │
                  ▼
[ PATCH / POST / DELETE /api/annotations/:id ]  ──>  `annotations` table only
                  │
                  ▼
[ UI updates instantly — the grading_results / rubric_point_results rows are never touched ]
```

### Flow D: Generating the Annotated PDF Export

```
[ "Export Annotated PDF" ]  ──>  GET /api/results/:id/export
                                            │
                                            ▼
                          [ pdfService.exportAnnotatedPdf ]
                          - Renders a clean, paginated PDF from the extracted answer text using
                            the SAME textLayout module that computed every annotation's position
                            (deliberate: pdf-parse gives text only, no glyph coordinates, so
                            drawing on top of an arbitrary uploaded PDF's original bytes would be
                            guesswork — this guarantees every box is exactly where its quote is)
                          - Draws each stored annotation box/underline + correction callout
                          - The originally uploaded file is never opened in write mode
                                            │
                                            ▼
                          [ Browser downloads annotated-grade-res-xxx.pdf ]
```

---

## 5. Summary of Key File Locations

- **Backend Express Server:** [`backend/src/server.ts`](backend/src/server.ts)
- **Grading Pipeline (retry, clamping, review-flag logic):** [`backend/src/services/gradingPipeline.ts`](backend/src/services/gradingPipeline.ts)
- **LLM Output Schema (Zod):** [`backend/src/services/llmOutputSchema.ts`](backend/src/services/llmOutputSchema.ts)
- **Shared Text Layout (annotation placement + PDF rendering source of truth):** [`backend/src/services/textLayout.ts`](backend/src/services/textLayout.ts)
- **Deterministic Mock Grader:** [`backend/src/services/mockGrader.ts`](backend/src/services/mockGrader.ts)
- **Gemini / Vertex AI Grader:** [`backend/src/services/geminiGrader.ts`](backend/src/services/geminiGrader.ts)
- **PDF Exporter:** [`backend/src/services/pdfService.ts`](backend/src/services/pdfService.ts)
- **Database Schema & Migrations:** [`backend/src/db/schema.ts`](backend/src/db/schema.ts)
- **Root App / view switch:** [`frontend/src/App.tsx`](frontend/src/App.tsx)
- **Grade Flow state machine:** [`frontend/src/components/GradeFlow.tsx`](frontend/src/components/GradeFlow.tsx)
- **Paper render & offset-based highlights:** [`frontend/src/components/PdfViewerCanvas.tsx`](frontend/src/components/PdfViewerCanvas.tsx)
- **History + Review filter:** [`frontend/src/components/HistoryView.tsx`](frontend/src/components/HistoryView.tsx)
- **Design System CSS:** [`frontend/src/index.css`](frontend/src/index.css)
