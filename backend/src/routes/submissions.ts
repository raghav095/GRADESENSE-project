import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { extractTextFromPdf } from '../services/pdfService.js';
import { extractTextFromDocx } from '../services/docxService.js';
import { renderPdfPagesToImages } from '../services/pdfRasterize.js';
import { GeminiGrader } from '../services/geminiGrader.js';
import { runGradingPipeline } from '../services/gradingPipeline.js';
import { toPublicFileUrl } from '../services/fileUrl.js';
import { extractStudentMeta } from '../services/studentMeta.js';
import { Submission } from '../services/types.js';

// A photographed or scanned answer sheet (PNG/JPG) has no text layer at
// all — there's nothing for pdfjs-style extraction to find. These are
// accepted and routed straight to Gemini vision transcription instead
// (GeminiGrader.transcribeHandwriting) — the real "student wrote it by hand,
// took a photo, uploaded it" workflow. If no live Gemini credentials are
// configured, this fails gracefully (see below) rather than silently
// grading an empty answer as if it were confidently blank.
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);
const SUPPORTED_EXTENSIONS = new Set(['.pdf', '.docx', '.png', '.jpg', '.jpeg']);

const router = Router();

// Resolved relative to this file, not process.cwd() — the same class of bug
// as the earlier dotenv path fix (see server.ts): whichever directory the
// server happens to be launched from would otherwise change where uploads
// are written, silently splitting them across two different folders depending
// on how the process was started.
const uploadsDir = path.join(__dirname, '../../uploads');
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
    let sourceType: 'pasted' | 'pdf' | 'docx' | 'image' = 'pasted';
    let finalStudentName = (studentName || '').trim();
    let finalRollNumber = (rollNumber || '').trim();
    let extractionNote: string | undefined;

    if (req.file) {
      const ext = path.extname(req.file.originalname).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        fs.unlinkSync(req.file.path); // uploaded but never going to be used — don't leave it on disk
        return res.status(400).json({
          error: `Unsupported file type "${ext || 'unknown'}" — upload a PDF, DOCX, PNG, or JPG file, or use "Paste Text" instead.`,
        });
      }

      filePath = req.file.path;
      sourceType = IMAGE_EXTENSIONS.has(ext) ? 'image' : ext === '.docx' ? 'docx' : 'pdf';
      const fileBuffer = fs.readFileSync(filePath);

      if (sourceType === 'image') {
        // A photographed/scanned answer sheet — no text layer exists at
        // all, so this always goes straight to vision transcription (the
        // uploaded image IS the page; no rasterization step needed).
        const transcribed = await new GeminiGrader().transcribeHandwriting([fileBuffer]);
        if (transcribed) {
          finalAnswerText = transcribed;
          const meta = extractStudentMeta(transcribed);
          if (!finalStudentName && meta.studentName) finalStudentName = meta.studentName;
          if (!finalRollNumber && meta.rollNumber) finalRollNumber = meta.rollNumber;
          // Kept short deliberately — the exported PDF's score banner only has
          // room for two wrapped lines (a fixed layout budget shared with
          // annotation-position math, see textLayout.ts), and a longer message
          // here was silently truncating mid-sentence in that banner.
          extractionNote =
            "This image was transcribed using AI. Handwriting transcription isn't always fully accurate — check the original uploaded file before trusting this score.";
        } else {
          // Could not read it at all. This must NOT be treated as a
          // confident blank answer further down the pipeline — the student
          // may have written a full page that simply couldn't be read
          // (no live Gemini credentials configured, or the call failed) —
          // so it's flagged distinctly rather than silently scored 0/100%.
          extractionNote =
            'This image could not be read (no live credentials, or the read failed). This is NOT a confident blank — check the original file before trusting any score here.';
        }
      } else {
        let extractedText = '';
        let pageCount = 1; // DOCX has no page concept here — treated as a single "page" for the length heuristic below

        if (sourceType === 'docx') {
          extractedText = await extractTextFromDocx(fileBuffer);
        } else {
          const pdfResult = await extractTextFromPdf(fileBuffer);
          extractedText = pdfResult.text;
          pageCount = pdfResult.pageCount;
        }

        if (extractedText) {
          finalAnswerText = extractedText;

          // Fill in name/roll from the page itself only when the teacher left
          // the field blank — an explicitly typed value always wins.
          const meta = extractStudentMeta(extractedText);
          if (!finalStudentName && meta.studentName) finalStudentName = meta.studentName;
          if (!finalRollNumber && meta.rollNumber) finalRollNumber = meta.rollNumber;
        }

        // A one-page PDF (or any DOCX) that yields under ~40 characters of
        // extractable text usually means the page is mostly a scanned image,
        // handwriting, or a diagram — pdfjs's text-layer extraction can't
        // read pixels, only an actual embedded text layer.
        const looksLikeLowText = extractedText.length < pageCount * 40;

        // For a PDF specifically (rasterization isn't built for DOCX), attempt
        // to actually read it via Gemini vision instead of only flagging it —
        // this is the scanned/photographed handwritten answer sheet case,
        // just arriving as a PDF instead of a raw image. Best-effort:
        // silently does nothing if poppler isn't installed or no live
        // credentials are configured, falling through to the existing
        // honest review-flag note below either way. AI transcription of
        // handwriting is never treated as fully trustworthy on its own —
        // when it succeeds, the note below still asks a human to verify it.
        if (looksLikeLowText && sourceType === 'pdf') {
          try {
            const pageImages = await renderPdfPagesToImages(fileBuffer);
            if (pageImages.length > 0) {
              const transcribed = await new GeminiGrader().transcribeHandwriting(pageImages);
              if (transcribed && transcribed.length > extractedText.length) {
                finalAnswerText = transcribed;
                const meta = extractStudentMeta(transcribed);
                if (!finalStudentName && meta.studentName) finalStudentName = meta.studentName;
                if (!finalRollNumber && meta.rollNumber) finalRollNumber = meta.rollNumber;
                extractionNote =
                  'This PDF had almost no machine-readable text, so its content was transcribed from the page image using AI. Check the original file before trusting this score.';
              }
            }
          } catch {
            // Vision transcription unavailable or failed — falls through to
            // the plain extraction-quality note below, unchanged.
          }
        }

        // Flagging a plain near-empty extraction distinctly means it reads as
        // "verify the original file," not as "the student wrote almost
        // nothing" — only set if the vision fallback above didn't already
        // produce a better note.
        if (!extractionNote && looksLikeLowText) {
          extractionNote = `This ${sourceType === 'docx' ? 'DOCX' : 'PDF'} yielded very little extractable text — it may contain a scan, handwriting, or a diagram. Check the original file before trusting this score.`;
        }
      }
    }

    const db = getDb();
    const subId = `sub-${crypto.randomUUID()}`;
    const now = new Date().toISOString();

    const insertSub = db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, student_answer_file_path, source_type, extraction_note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertSub.run(
      subId,
      questionId,
      finalStudentName || 'Anonymous Student',
      finalRollNumber || '00',
      finalAnswerText,
      filePath || null,
      sourceType,
      extractionNote || null,
      now
    );

    const submission: Submission = {
      id: subId,
      questionId,
      studentName: finalStudentName || 'Anonymous Student',
      rollNumber: finalRollNumber || '00',
      studentAnswerText: finalAnswerText,
      studentAnswerFilePath: filePath,
      sourceType,
      extractionNote,
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
      extractionNote: sub.extraction_note || undefined,
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
