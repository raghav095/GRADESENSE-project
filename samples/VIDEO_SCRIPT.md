# GradeSense — Demo Script (~2:20)

Read naturally, don't recite word-for-word. Timed to ~150 words/minute with a little slack. Each beat has the line to say and the action to do at the same time. This runs about 20 seconds over the "short 2 min" target because of the added AI-drafting beat — if you need to claw that back, the tightest place to cut is the Manual Notes beat (drop it entirely, it's the least essential of the eight).

---

**[0:00–0:10] Intro**

> "Hello, my name is Raghav Rathi, and this is the GradeSense project — a grading and annotation tool."

*(no action — just the camera/screen on the home screen)*

**[0:10–0:30] Create and draft a new question**

> "In this tool, you can also create and upload your own question. I'll add one here — and instead of writing the model answer and rubric by hand, I can click Draft with AI, and it generates the model answer and marking rubric for this question automatically."

*(Click "Add Question", paste in a question, click "Draft with AI", let it fill in, click "Create Question")*

**[0:30–0:40] Select the question**

> "Now I'll select this question to grade an answer against it."

*(Click the question dropdown, select the question you just created — or switch to Question 2 for the next part, since that's the one with the real handwritten sample)*

**[0:40–1:00] Upload a real handwritten answer sheet**

> "Now here's the part I want to actually show — a real student doesn't type their answer, they write it by hand. So instead of a PDF, I'm uploading an actual photo of a handwritten answer sheet."

*(Click Upload File, select the real handwritten photo — e.g. the full-correct Q2 sample — and show the file name/thumbnail briefly before grading)*

**[1:00–1:20] The LLM + fallback**

> "For grading, we've integrated Google Vertex AI — Google's enterprise AI platform — authenticated through a GCP service account key. It reads the handwriting directly using AI vision, transcribes it, and grades it. And for reliability, we've also built a structured fallback grader in code, so if the live API is ever unavailable, the system still evaluates the answer deterministically instead of failing."

*(Click "Grade This Paper" — this is where the live API call happens, so this line covers that wait time)*

**[1:20–1:50] The result — marks, rubric, feedback, and the real photo**

> "Here's the result — full marks on this one. On the right is the rubric — each criterion it was actually checked against, with feedback tied to evidence from the transcribed answer. And because this came from a photo, it's honestly flagged for human review — AI reading handwriting isn't guaranteed perfect, so it never pretends otherwise. Here's the 'Original Upload' tab, showing the exact photo it read, right next to what it transcribed — so a teacher can double-check it in seconds."

*(Point at the score banner and the "Needs Review" flag, click into a rubric point to show Evidence + Feedback, then click the "Original Upload" tab to show the real photo)*

**[1:50–2:00] Manual notes**

> "The teacher can also add their own manual note on top of this, independent of the AI's grading."

*(Click "+ Add Manual Note", type a short note)*

**[2:00–2:15] Download / export**

> "And finally, we download this as a file — the annotated answer, the original handwritten photo, and the model answer, all in one PDF, so the teacher has everything without needing the app open."

*(Click "Export Annotated PDF", open the downloaded file, scroll through the annotated page, the original photo page, and the model-answer page)*

**[2:15–2:20] Close**

> "That's GradeSense — thank you."

---

## Notes for recording

- Practice "Draft with AI → Create Question", "Upload photo → Grade", and "Export → open PDF" once before recording — those are the three parts with real wait time (API calls, file download).
- Have your question text and the real handwritten photo ready beforehand (e.g. the full-correct Q2 sample, which scores 5/5) so those steps are instant, not fumbled live.
- If grading takes a little longer than expected, the LLM/vision line naturally covers that gap — just don't rush past it.
- The honest "Needs Review" flag on an AI-transcribed photo is a feature, not something to apologize for — say it plainly and move on to showing the Original Upload tab as the reason it's trustworthy anyway.
