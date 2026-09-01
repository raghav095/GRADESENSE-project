# GradeSense — Test Suite and Output

## How to run

```bash
cd backend
npm run test
```

## What's covered

The suite has 14 automated tests in `backend/tests/gradingPipeline.test.ts`. The first 8 map directly to the assignment's required test cases; the remaining 6 cover additional reliability and reasoning-quality checks found valuable during development.

| # | Test | Required case covered |
|---|------|------------------------|
| 1 | Should award max marks for a fully correct answer fixture | A fully correct answer |
| 2 | Should correctly calculate mixed marks for a partially correct answer | A partially correct answer |
| 3 | Should award 0 or low marks for an entirely incorrect answer | An incorrect answer |
| 4 | Should short-circuit blank answers to 0 marks without invoking LLM API | A blank answer |
| 5 | Should match evidence and grade accurately despite OCR-like spelling errors | An answer with OCR-like spelling errors |
| 6 | Should handle malformed model output gracefully and flag for human review | Malformed or incomplete model output |
| 7 | Should fall back to degraded mode on primary API failure | A model/API failure |
| 8 | Should strictly clamp marks to maxMarks and recompute total sum | An answer where the score would exceed the maximum unless corrected |
| 9 | Should award 5/5 to English essay arguing OPPOSITE conclusion with strong reasoning | (bonus) reasoning-over-similarity |
| 10 | Should award 5/5 to Science answer using unique vocabulary but correct physics | (bonus) reasoning-over-keyword-matching |
| 11 | Should mark voltmeter in series as incorrect despite keyword overlap | (bonus) catches a real misconception despite matching keywords |
| 12 | Should flag needsHumanReview even on a full-score result if evidence is unmatched | (bonus) reliability — no exemption for a "good" score |
| 13 | Should place annotation boxes at the evidence quote's real computed position | (bonus) annotation-position correctness |
| 14 | Should grade a genuinely different, correct Q1 answer on its own merits, not as Ananya's fixed wrong answers | (bonus) proves the grader isn't returning canned/fixed answers |

## Actual output (captured 2026-09-02)

```
 RUN  v3.2.7 /Users/raghavrathi/Gradesense/backend

 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 1. Should award max marks for a fully correct answer fixture 7ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 2. Should correctly calculate mixed marks for a partially correct answer (Ananya Rao Q1) 2ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 3. Should award 0 or low marks for an entirely incorrect answer 1ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 4. Should short-circuit blank answers to 0 marks without invoking LLM API 1ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 5. Should match evidence and grade accurately despite OCR-like spelling errors 1ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 6. Should handle malformed model output gracefully and flag for human review 1ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 7. Should fall back to degraded mode on primary API failure 305ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 8. Should strictly clamp marks to maxMarks and recompute total sum 6ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 9. Should award 5/5 to English essay arguing OPPOSITE conclusion with strong reasoning 6ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 10. Should award 5/5 to Science answer using unique vocabulary but correct physics 5ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 11. Should mark voltmeter in series as incorrect despite keyword overlap 5ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 12. Should flag needsHumanReview even on a full-score result if evidence is unmatched 3ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 13. Should place annotation boxes at the evidence quote's real computed position 3ms
 ✓ tests/gradingPipeline.test.ts > GradeSense Reliability & Grading Pipeline Test Suite > 14. Should grade a genuinely different, correct Q1 answer on its own merits, not as Ananya's fixed wrong answers 8ms

 Test Files  1 passed (1)
      Tests  14 passed (14)
   Start at  00:37:25
   Duration  675ms (transform 61ms, setup 0ms, collect 116ms, tests 356ms, environment 0ms, prepare 51ms)
```

## Manual end-to-end verification

Beyond the automated suite, the following were verified manually against the running application this session (live route-level tests against isolated scratch databases, never the production data):

- Question upload/creation persists across server restarts.
- Each of the three sample answer PDFs (`samples/Student_Answer_Ananya_Rao_Q1_Science.pdf`, `_Q2_English.pdf`, `_Q3_Economics.pdf` — one file per question, matching how the app is actually used: one upload per question) graded correctly and independently against its own question, with scores consistent with the intended mistakes in `ERROR_KEY.md`.
- DOCX upload → text extraction → grading, verified against a real minimal .docx.
- A fully blank submission scores 0 with `needsHumanReview: false` (a blank answer is not "uncertain," it's confidently empty).
- A pasted-text submission (no file) grades correctly and is never flagged for a diagram it couldn't have.
- Manual teacher notes: create, edit, and delete, independent of re-grading.
- Marking a result "reviewed" clears its review flag and the app-wide review count updates.
- Deleting a result removes it from history immediately.
- Rejecting an unsupported upload (e.g. an image) returns a clear error and leaves no orphaned file on disk.
- Exporting the annotated PDF produces a real, valid PDF with a human-readable filename (student name + question), never touching the original uploaded file.
- The diagram/figure rubric criterion, when Gemini vision + poppler are available, is assessed from the actual uploaded page image rather than being blindly flagged — verified against `samples/Student_Answer_Ananya_Rao_Q1_Science.pdf`'s real circuit diagram with a live API call, both as a full-marks (satisfied) and a docked (unsatisfied) result depending on the diagram's actual content.
