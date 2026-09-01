import { Router } from 'express';
import multer from 'multer';
import { getDb } from '../db/index.js';
import { extractTextFromPdf } from '../services/pdfService.js';
import { GeminiGrader, GraderCallError } from '../services/geminiGrader.js';
import crypto from 'crypto';

const router = Router();

// Memory storage, not disk: the uploaded file here is only ever used to
// extract text for one drafting call — unlike a student submission, it's
// never a persisted artifact, so it's never written to disk at all.
const draftUpload = multer({ storage: multer.memoryStorage() });

router.get('/', (req, res) => {
  const db = getDb();
  const questions = db.prepare('SELECT * FROM questions ORDER BY created_at DESC').all();
  const result = questions.map((q: any) => {
    const rubrics = db.prepare('SELECT * FROM rubric_points WHERE question_id = ? ORDER BY order_index ASC').all(q.id);
    return {
      id: q.id,
      subject: q.subject,
      title: q.title,
      text: q.text,
      maxMarks: q.max_marks,
      modelAnswerText: q.model_answer_text,
      createdAt: q.created_at,
      rubricPoints: rubrics.map((r: any) => ({
        id: r.id,
        questionId: r.question_id,
        criterion: r.criterion,
        maxMarks: r.max_marks,
        orderIndex: r.order_index,
      })),
    };
  });
  res.json(result);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const q: any = db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id);
  if (!q) {
    return res.status(404).json({ error: 'Question not found' });
  }

  const rubrics = db.prepare('SELECT * FROM rubric_points WHERE question_id = ? ORDER BY order_index ASC').all(q.id);
  res.json({
    id: q.id,
    subject: q.subject,
    title: q.title,
    text: q.text,
    maxMarks: q.max_marks,
    createdAt: q.created_at,
    rubricPoints: rubrics.map((r: any) => ({
      id: r.id,
      questionId: r.question_id,
      criterion: r.criterion,
      maxMarks: r.max_marks,
      orderIndex: r.order_index,
    })),
  });
});

router.post('/', (req, res) => {
  const { subject, title, text, modelAnswerText, rubricPoints } = req.body;

  if (!title || !title.trim() || !text || !text.trim()) {
    return res.status(400).json({ error: 'Question title and text are required.' });
  }
  if (!Array.isArray(rubricPoints) || rubricPoints.length === 0) {
    return res.status(400).json({ error: 'At least one rubric point is required.' });
  }
  const invalid = rubricPoints.find((r: any) => !r.criterion || !r.criterion.trim() || !(Number(r.maxMarks) > 0));
  if (invalid) {
    return res.status(400).json({ error: 'Every rubric point needs a non-empty criterion and a max marks value greater than 0.' });
  }

  const db = getDb();
  const qId = `q-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // The question's total is always the sum of its rubric points' marks — the
  // same "never trust a separately-stated total" invariant enforced when
  // computing a GRADED result's total also applies at question-authoring time.
  const totalMarks = rubricPoints.reduce((sum: number, r: any) => sum + Number(r.maxMarks), 0);

  const insertQ = db.prepare('INSERT INTO questions (id, subject, title, text, max_marks, model_answer_text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  const insertR = db.prepare('INSERT INTO rubric_points (id, question_id, criterion, max_marks, order_index) VALUES (?, ?, ?, ?, ?)');

  const transaction = db.transaction(() => {
    insertQ.run(qId, (subject || 'General').trim(), title.trim(), text.trim(), totalMarks, (modelAnswerText || '').trim() || null, now);
    rubricPoints.forEach((r: any, idx: number) => {
      insertR.run(`rp-${crypto.randomUUID()}`, qId, r.criterion.trim(), Number(r.maxMarks), idx + 1);
    });
  });

  transaction();
  res.status(201).json({ id: qId, maxMarks: totalMarks, message: 'Question created successfully' });
});

// Drafts a model answer + rubric from a question paper (uploaded PDF or
// pasted text) using the live LLM, for a human to review before saving —
// never auto-saved, never used to grade anything on its own. If the LLM
// isn't configured or the call fails even after a retry, this returns a
// clear error rather than a fabricated rubric standing in for a real one.
router.post('/draft', draftUpload.single('file'), async (req, res) => {
  try {
    let questionText = (req.body.text || '').trim();

    if (req.file) {
      try {
        const extracted = await extractTextFromPdf(req.file.buffer);
        if (extracted.text) questionText = extracted.text;
      } catch (err: any) {
        return res.status(400).json({ error: `Could not read the uploaded PDF: ${err.message}` });
      }
    }

    if (!questionText) {
      return res.status(400).json({ error: 'Provide the question text (paste it or upload a PDF) before drafting.' });
    }

    const grader = new GeminiGrader();

    let draft;
    try {
      draft = await grader.draftQuestion(questionText);
    } catch (err: any) {
      if (err instanceof GraderCallError && err.kind === 'malformed') {
        // One retry with a stricter prompt — same pattern as the grading pipeline.
        draft = await grader.draftQuestion(questionText, { strict: true });
      } else {
        throw err;
      }
    }

    res.json({ questionText, ...draft });
  } catch (err: any) {
    const message =
      err instanceof GraderCallError
        ? 'AI drafting is unavailable right now (no configured Gemini/Vertex credentials, or the model call failed) — fill in the question and rubric manually instead.'
        : err.message || 'Failed to draft question.';
    res.status(503).json({ error: message });
  }
});

export default router;
