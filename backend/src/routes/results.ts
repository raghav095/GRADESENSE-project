import { Router } from 'express';
import { getDb } from '../db/index.js';
import { exportAnnotatedPdf } from '../services/pdfService.js';
import { toPublicFileUrl } from '../services/fileUrl.js';

const router = Router();

router.get('/', (req, res) => {
  const db = getDb();
  const reviewOnly = req.query.reviewOnly === 'true';

  const query = reviewOnly
    ? 'SELECT r.*, s.student_name, s.roll_number, q.title as question_title FROM grading_results r JOIN submissions s ON r.submission_id = s.id JOIN questions q ON s.question_id = q.id WHERE r.needs_human_review = 1 ORDER BY r.created_at DESC'
    : 'SELECT r.*, s.student_name, s.roll_number, q.title as question_title FROM grading_results r JOIN submissions s ON r.submission_id = s.id JOIN questions q ON s.question_id = q.id ORDER BY r.created_at DESC';

  const rows = db.prepare(query).all();
  const results = rows.map((r: any) => ({
    id: r.id,
    submissionId: r.submission_id,
    studentName: r.student_name,
    rollNumber: r.roll_number,
    questionTitle: r.question_title,
    totalMarks: r.total_marks,
    maxMarks: r.max_marks,
    confidence: r.confidence,
    needsHumanReview: Boolean(r.needs_human_review),
    reviewReason: r.review_reason,
    reviewedAt: r.reviewed_at,
    status: r.status,
    createdAt: r.created_at,
  }));

  res.json(results);
});

router.get('/:id', (req, res) => {
  const db = getDb();
  const r: any = db.prepare(`
    SELECT r.*, s.student_name, s.roll_number, s.student_answer_text, s.student_answer_file_path, s.source_type, s.question_id,
           q.title as question_title, q.text as question_text, q.subject as question_subject, q.model_answer_text
    FROM grading_results r
    JOIN submissions s ON r.submission_id = s.id
    JOIN questions q ON s.question_id = q.id
    WHERE r.id = ?
  `).get(req.params.id);

  if (!r) {
    return res.status(404).json({ error: 'Grading result not found' });
  }

  const pointRows = db.prepare(`
    SELECT pr.*, rp.criterion
    FROM rubric_point_results pr
    JOIN rubric_points rp ON pr.rubric_point_id = rp.id
    WHERE pr.grading_result_id = ?
    ORDER BY rp.order_index ASC
  `).all(r.id);

  const annotationRows = db.prepare('SELECT * FROM annotations WHERE grading_result_id = ?').all(r.id);

  res.json({
    id: r.id,
    submissionId: r.submission_id,
    studentName: r.student_name,
    rollNumber: r.roll_number,
    studentAnswerText: r.student_answer_text,
    originalFileUrl: toPublicFileUrl(r.student_answer_file_path),
    sourceType: r.source_type,
    questionId: r.question_id,
    questionTitle: r.question_title,
    questionText: r.question_text,
    questionSubject: r.question_subject,
    modelAnswerText: r.model_answer_text,
    totalMarks: r.total_marks,
    maxMarks: r.max_marks,
    confidence: r.confidence,
    needsHumanReview: Boolean(r.needs_human_review),
    reviewReason: r.review_reason,
    reviewedAt: r.reviewed_at,
    status: r.status,
    createdAt: r.created_at,
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
  });
});

// Acknowledges a flagged result: a teacher has looked at the specific reason,
// checked the evidence/annotations, and is satisfied (having corrected the
// annotation text if needed) — this clears the flag without touching marks
// or re-grading. It is NOT a marks-override; the brief only requires the
// system to flag uncertainty, not to let a human silently rewrite the score,
// so adjusting marks stays a manual, out-of-band teacher decision reflected
// via the editable annotations/feedback, same as everything else here.
router.patch('/:id/review', (req, res) => {
  const db = getDb();
  const now = new Date().toISOString();
  const info = db.prepare('UPDATE grading_results SET needs_human_review = 0, reviewed_at = ? WHERE id = ?').run(now, req.params.id);
  if (info.changes === 0) {
    return res.status(404).json({ error: 'Grading result not found' });
  }
  res.json({ needsHumanReview: false, reviewedAt: now });
});

router.get('/:id/logs', (req, res) => {
  const db = getDb();
  const logs = db.prepare('SELECT * FROM llm_logs WHERE grading_result_id = ? ORDER BY created_at ASC').all(req.params.id);
  res.json(logs.map((l: any) => ({
    id: l.id,
    gradingResultId: l.grading_result_id,
    pass: l.pass,
    rawRequest: l.raw_request,
    rawResponse: l.raw_response,
    model: l.model,
    latencyMs: l.latency_ms,
    error: l.error,
    createdAt: l.created_at,
  })));
});

router.get('/:id/export', async (req, res) => {
  try {
    const db = getDb();
    const r: any = db.prepare(`
      SELECT r.*, s.student_answer_text, s.student_answer_file_path, s.student_name, s.roll_number,
             q.title as question_title, q.subject as question_subject
      FROM grading_results r
      JOIN submissions s ON r.submission_id = s.id
      JOIN questions q ON s.question_id = q.id
      WHERE r.id = ?
    `).get(req.params.id);

    if (!r) {
      return res.status(404).json({ error: 'Result not found' });
    }

    const annotations: any[] = db.prepare('SELECT * FROM annotations WHERE grading_result_id = ?').all(r.id);
    const parsedAnnotations = annotations.map((a: any) => ({
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
    }));

    // The exported PDF has no sidebar or ResultHeader to show the score,
    // status, or which rubric criterion a note belongs to — unlike the
    // in-app view, all of that has to be fetched and drawn explicitly here.
    const pointRows: any[] = db.prepare(`
      SELECT pr.id, rp.criterion, pr.marks_awarded, pr.max_marks, pr.status, pr.feedback
      FROM rubric_point_results pr
      JOIN rubric_points rp ON pr.rubric_point_id = rp.id
      WHERE pr.grading_result_id = ?
      ORDER BY rp.order_index ASC
    `).all(r.id);
    const exportPointResults = pointRows.map(p => ({
      id: p.id,
      criterion: p.criterion,
      marksAwarded: p.marks_awarded,
      maxMarks: p.max_marks,
      status: p.status,
      feedback: p.feedback,
    }));

    const pdfBuffer = await exportAnnotatedPdf(
      r.student_answer_text || '',
      parsedAnnotations,
      {
        studentName: r.student_name,
        rollNumber: r.roll_number,
        questionTitle: r.question_title,
        subject: r.question_subject,
      },
      exportPointResults,
      {
        totalMarks: r.total_marks,
        maxMarks: r.max_marks,
        confidence: r.confidence,
        needsHumanReview: Boolean(r.needs_human_review),
        reviewReason: r.review_reason,
        status: r.status,
        reviewedAt: r.reviewed_at,
      }
    );

    // A raw result ID ("annotated-grade-res-<uuid>.pdf") tells a teacher
    // nothing about which paper it is once they've downloaded a few —
    // built from the student's name and the question instead.
    const filenameSafe = (s: string) =>
      s
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '') // strip accents (post-NFKD combining marks)
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 60) || 'Unknown';
    const downloadName = `${filenameSafe(r.student_name || 'Student')}_${filenameSafe(r.question_title || 'Question')}_Annotated.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`);
    res.send(pdfBuffer);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
