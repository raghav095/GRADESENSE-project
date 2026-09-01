import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { extractTextFromPdf } from '../services/pdfService.js';
import { runGradingPipeline } from '../services/gradingPipeline.js';
import { toPublicFileUrl } from '../services/fileUrl.js';
import { Submission } from '../services/types.js';

const router = Router();

const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `sub-${Date.now()}-${crypto.randomUUID().slice(0, 8)}${ext}`);
  },
});

const upload = multer({ storage });

router.post('/', upload.single('file'), async (req, res) => {
  try {
    const { questionId, studentName, rollNumber, studentAnswerText } = req.body;
    if (!questionId) {
      return res.status(400).json({ error: 'questionId is required' });
    }

    let finalAnswerText = studentAnswerText || '';
    let filePath: string | undefined = undefined;
    let sourceType: 'pasted' | 'pdf' = 'pasted';

    if (req.file) {
      filePath = req.file.path;
      sourceType = 'pdf';
      const fileBuffer = fs.readFileSync(filePath);
      const pdfText = await extractTextFromPdf(fileBuffer);
      if (pdfText.trim()) {
        finalAnswerText = pdfText;
      }
    }

    const db = getDb();
    const subId = `sub-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const insertSub = db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, student_answer_file_path, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertSub.run(
      subId,
      questionId,
      studentName || 'Anonymous Student',
      rollNumber || '00',
      finalAnswerText,
      filePath || null,
      sourceType,
      now
    );

    const submission: Submission = {
      id: subId,
      questionId,
      studentName: studentName || 'Anonymous Student',
      rollNumber: rollNumber || '00',
      studentAnswerText: finalAnswerText,
      studentAnswerFilePath: filePath,
      sourceType,
      createdAt: now,
    };

    res.status(201).json(submission);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/grade', async (req, res) => {
  try {
    const db = getDb();
    const sub: any = db.prepare('SELECT * FROM submissions WHERE id = ?').get(req.params.id);
    if (!sub) {
      return res.status(404).json({ error: 'Submission not found' });
    }

    const submission: Submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      studentAnswerFilePath: sub.student_answer_file_path || undefined,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const resultSummary = await runGradingPipeline(submission);

    // Fetch fully populated result from DB to ensure studentName, rollNumber, answerText are present
    const fullResult: any = db.prepare(`
      SELECT r.*, s.student_name, s.roll_number, s.student_answer_text, s.student_answer_file_path, s.source_type, s.question_id,
             q.title as question_title, q.text as question_text, q.subject as question_subject, q.model_answer_text
      FROM grading_results r
      JOIN submissions s ON r.submission_id = s.id
      JOIN questions q ON s.question_id = q.id
      WHERE r.id = ?
    `).get(resultSummary.id);

    const pointRows = db.prepare(`
      SELECT pr.*, rp.criterion
      FROM rubric_point_results pr
      JOIN rubric_points rp ON pr.rubric_point_id = rp.id
      WHERE pr.grading_result_id = ?
      ORDER BY rp.order_index ASC
    `).all(resultSummary.id);

    const annotationRows = db.prepare('SELECT * FROM annotations WHERE grading_result_id = ?').all(resultSummary.id);

    const responsePayload = {
      id: fullResult.id,
      submissionId: fullResult.submission_id,
      studentName: fullResult.student_name,
      rollNumber: fullResult.roll_number,
      studentAnswerText: fullResult.student_answer_text,
      originalFileUrl: toPublicFileUrl(fullResult.student_answer_file_path),
      sourceType: fullResult.source_type,
      questionId: fullResult.question_id,
      questionTitle: fullResult.question_title,
      questionText: fullResult.question_text,
      questionSubject: fullResult.question_subject,
      modelAnswerText: fullResult.model_answer_text,
      totalMarks: fullResult.total_marks,
      maxMarks: fullResult.max_marks,
      confidence: fullResult.confidence,
      needsHumanReview: Boolean(fullResult.needs_human_review),
      reviewReason: fullResult.review_reason,
      reviewedAt: fullResult.reviewed_at,
      status: fullResult.status,
      createdAt: fullResult.created_at,
      pointResults: pointRows.map((pr: any) => ({
        id: pr.id,
        gradingResultId: pr.grading_result_id,
        rubricPointId: pr.rubric_point_id,
        criterion: pr.criterion,
        marksAwarded: pr.marks_awarded,
        maxMarks: pr.max_marks,
        status: pr.status,
        evidenceQuote: pr.evidence_quote,
        evidenceMatched: Boolean(pr.evidence_matched),
        evidenceStart: pr.evidence_start,
        evidenceEnd: pr.evidence_end,
        feedback: pr.feedback,
      })),
      annotations: annotationRows.map((a: any) => ({
        id: a.id,
        gradingResultId: a.grading_result_id,
        page: a.page,
        x: a.x,
        y: a.y,
        width: a.width,
        height: a.height,
        type: a.type,
        linkedPointResultId: a.linked_point_result_id,
        correctionText: a.correction_text,
        createdByUser: Boolean(a.created_by_user),
        updatedAt: a.updated_at,
      })),
    };

    res.json(responsePayload);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
