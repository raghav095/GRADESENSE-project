# GradeSense — How It Works

This is a plain-language walkthrough of how GradeSense actually works, followed by a detailed reference map (file locations, every button, every data flow) for anyone who wants to look something up.

---

## The short version

A teacher uploads (or pastes) a student's answer to a question that already has a model answer and a rubric attached to it. GradeSense sends the answer, the question, and the rubric to an LLM (or a deterministic offline grader if no LLM is configured) and asks it to judge each rubric point separately — not just produce one number.

For every rubric point, the model has to say: is this correct, partial, missing, or wrong; how many marks; and — critically — quote the exact part of the student's answer that justifies that judgment. That evidence quote is the load-bearing part of the whole design. The backend takes that quote and actually searches for it in the student's real answer text. If it's not there, or doesn't match closely enough, that's a red flag — the system just caught the model claiming evidence that doesn't exist, and it refuses to draw an annotation for something it can't back up.

Once every point is graded, some plain arithmetic (not the LLM) clamps each mark to its maximum and adds them up for the total — the model is never trusted to do that math itself. Then a confidence score gets computed from how much of the evidence actually matched and whether a second "does this quote really justify this?" check agreed with the first pass. If confidence is low, or the API failed, or the model's output didn't parse, or a rubric point needs a diagram nobody can actually see — the result gets flagged for a human to check, with a specific reason attached, instead of just being presented as correct.

The flagged mistakes get underlined or boxed directly on a rendered copy of the answer, each with its own correction note, and a teacher can move, edit, or delete any of those notes afterward without re-running the whole grading process — annotations live in their own table, completely separate from the grade itself. When it's time to hand the result back, GradeSense builds a fresh annotated PDF from scratch (never edits the file the student actually uploaded) and that's what gets exported.

That's the whole system: grade every point with evidence, verify the evidence is real, never trust the model's arithmetic, and say so clearly whenever something couldn't actually be checked.

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
│   │   │   ├── geminiGrader.ts      # Live Gemini/Vertex grader + GraderCallError; also vision assessment (diagrams) and handwriting transcription
│   │   │   ├── pdfService.ts        # pdfjs-dist text extraction + pdf-lib canonical PDF renderer/annotation exporter
│   │   │   ├── docxService.ts       # mammoth DOCX text extraction (question papers and student answers, alongside PDF)
│   │   │   ├── studentMeta.ts       # Regex fallback-fill of student name/roll from a "Name:"/"Roll No:" line in the upload
│   │   │   └── pdfRasterize.ts      # Shells out to poppler's pdftoppm to render a PDF page to PNG for Gemini vision input
│   │   │                            #   (optional system dependency — gracefully no-ops if poppler isn't installed)
│   │   ├── routes/
│   │   │   ├── questions.ts         # GET/POST questions & rubric points
│   │   │   ├── submissions.ts       # POST upload student paper & POST trigger grading pipeline
│   │   │   ├── results.ts           # GET past results, GET detail payload, GET logs, GET PDF export
│   │   │   └── annotations.ts       # Decoupled CRUD endpoints (PATCH, POST, DELETE annotations)
│   │   └── server.ts                # Express server entry point (port from $PORT, default 3001)
│   └── tests/
│       └── gradingPipeline.test.ts  # 14 automated Vitest unit & integration edge-case tests
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
                            (deliberate: pdfjs-dist gives text only, no glyph coordinates, so
                            drawing on top of an arbitrary uploaded PDF's original bytes would be
                            guesswork — this guarantees every box is exactly where its quote is)
                          - Draws each stored annotation box/underline + correction callout
                          - The originally uploaded file is never opened in write mode
                                            │
                                            ▼
                          [ Browser downloads "<Student Name>_<Question Title>_Annotated.pdf" ]
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
