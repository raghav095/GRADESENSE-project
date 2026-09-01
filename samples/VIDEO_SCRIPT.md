# GradeSense — 2-Minute Demo Script

Read this naturally, don't recite it word-for-word — it's timed to ~150 words/minute so you have a little slack. Adjust pacing live based on how the recording is going.

---

**[0:00–0:15] Hook**

"Hi, I'm Raghav, and this is GradeSense — a tool that grades a student's answer against a model answer and rubric, and shows exactly where marks were gained or lost, directly on the paper. The core problem it solves isn't just 'give a score' — it's making that score something a teacher can actually verify."

**[0:15–0:45] Live: create a question with AI drafting**

"Let me build a new question live. I'll click Add Question, paste in a question prompt, and hit Draft with AI." *(paste your question, click Draft with AI, let it fill in the model answer and rubric)* "It's drafted a model answer and a five-point rubric — but this is only ever a pre-fill. Nothing is saved until I review it and click Create, so a teacher stays in control of the marking standard."

**[0:45–1:15] Live: grade a real answer**

"Now I'll paste in a student's answer to this exact question and grade it." *(paste a deliberately imperfect answer, click Grade)* "And here's the result — total marks, and a full breakdown per rubric point. Each one shows the exact evidence quoted from the student's own answer, whether it's correct, partial, or wrong, and specific feedback — never just a bare number."

**[1:15–1:40] Reliability**

"If I grade a blank answer instead" *(show or mention a blank submission)* "it scores zero, confidently — not a guess. And if a point genuinely can't be verified — like a diagram — the system says so and flags it for manual review instead of pretending it checked something it didn't. That's deliberate: the whole design is built around never being confidently wrong."

**[1:40–1:55] Annotation and export**

"Every mistake is underlined or boxed right on the answer, with the correction next to it — and these annotations are fully editable without re-grading the paper. I can export this as an annotated PDF" *(click Export)* "which is a clean copy — the original upload is never touched."

**[1:55–2:00] Close**

"And all of this works with a live LLM or, with zero configuration, a fully offline deterministic grader — so it's never dependent on an API being up. That's GradeSense."

---

## Notes for recording

- Practice the "Draft with AI" + grading beats once before recording — that's the part with real latency (a few seconds per API call), so know what you're waiting for.
- If something is slow or fails live, that's actually fine to show briefly — it's a good moment to say "and if this API call fails, it retries once, then falls back to a deterministic grader automatically" (you don't have to force a failure, just mention it exists).
- Keep the on-screen answer text short (3–5 sentences) so grading finishes fast during the live take.
