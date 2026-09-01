import { getDb } from '../db/index.js';
import {
  Grader,
  Question,
  RubricPoint,
  Submission,
  GradingResult,
  RubricPointResult,
  Annotation,
  LlmCallLog,
  RawLlmGradingOutput,
} from './types.js';
import { MockGrader } from './mockGrader.js';
import { GeminiGrader, GraderCallError } from './geminiGrader.js';
import { RawLlmGradingOutputSchema } from './llmOutputSchema.js';
import { computeTextLayout, boxesForRange } from './textLayout.js';
import { fuzzyMatchQuote } from './textMatch.js';
import { renderPdfPagesToImages } from './pdfRasterize.js';
import crypto from 'crypto';
import fs from 'fs';

export { fuzzyMatchQuote } from './textMatch.js';

type LogEntry = Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function selectGrader(customGrader?: Grader): Grader {
  if (customGrader) return customGrader;

  if (process.env.USE_LLM === 'true' || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
    try {
      return new GeminiGrader();
    } catch {
      // fall through to mock
    }
  }

  return new MockGrader();
}

/**
 * Runs one grading attempt against `grader`, then validates the response
 * against the locked JSON schema (Zod). Returns a discriminated result so the
 * caller can apply the right recovery strategy: a `network` failure gets a
 * backoff retry, a `malformed` one gets a stricter-prompt retry — these are
 * different problems with different fixes, and were previously conflated.
 */
async function attemptGrade(
  grader: Grader,
  question: Question,
  rubricPoints: RubricPoint[],
  answerText: string,
  logs: LogEntry[],
  strict: boolean
): Promise<{ ok: true; data: RawLlmGradingOutput } | { ok: false; kind: 'network' | 'malformed' }> {
  try {
    const res = await grader.grade(question, rubricPoints, answerText, strict ? { strict: true } : undefined);
    logs.push(res.log);

    const parsed = RawLlmGradingOutputSchema.safeParse(res.rawOutput);
    if (parsed.success) {
      return { ok: true, data: parsed.data };
    }

    logs.push({
      pass: 'grading',
      rawRequest: '(schema validation)',
      rawResponse: JSON.stringify(res.rawOutput),
      model: 'zod-validator',
      latencyMs: 0,
      error: `Schema validation failed: ${parsed.error.issues.map(i => i.message).join('; ')}`,
    });
    return { ok: false, kind: 'malformed' };
  } catch (err: any) {
    if (err instanceof GraderCallError) {
      if (err.log) logs.push(err.log);
      return { ok: false, kind: err.kind };
    }
    return { ok: false, kind: 'network' };
  }
}

export async function runGradingPipeline(
  submission: Submission,
  customGrader?: Grader,
  dbPath?: string
): Promise<GradingResult> {
  const db = getDb(dbPath);
  const now = new Date().toISOString();
  const gradingResultId = `res-${crypto.randomUUID()}`;

  const rawQ: any = db.prepare('SELECT * FROM questions WHERE id = ?').get(submission.questionId);
  if (!rawQ) {
    throw new Error(`Question not found: ${submission.questionId}`);
  }

  const question: Question = {
    id: rawQ.id,
    subject: rawQ.subject,
    title: rawQ.title,
    text: rawQ.text,
    maxMarks: Number(rawQ.max_marks) || 5.0,
    createdAt: rawQ.created_at,
  };

  const rawRubrics = db.prepare('SELECT * FROM rubric_points WHERE question_id = ? ORDER BY order_index ASC').all(submission.questionId) as any[];
  if (!rawRubrics || rawRubrics.length === 0) {
    throw new Error(`No rubric points found for question: ${submission.questionId}`);
  }

  const rubricPoints: RubricPoint[] = rawRubrics.map(r => ({
    id: r.id,
    questionId: r.question_id,
    criterion: r.criterion,
    maxMarks: Number(r.max_marks) || 1.0,
    orderIndex: r.order_index,
  }));

  const primaryGrader: Grader = selectGrader(customGrader);
  const fallbackGrader: Grader = new MockGrader();

  const logs: LogEntry[] = [];
  let isDegraded = false; // primary grader API itself failed, even after a retry
  let isFailedSchema = false; // primary grader responded, but never produced valid schema, even after a stricter retry
  let rawOutput: RawLlmGradingOutput | null = null;

  const trimmedText = submission.studentAnswerText.trim();

  // Step 1: Short-circuit for blank answers — deterministic, no API call.
  if (!trimmedText) {
    const pointResults: RubricPointResult[] = rubricPoints.map(r => ({
      id: `pr-${crypto.randomUUID()}`,
      gradingResultId,
      rubricPointId: r.id,
      marksAwarded: 0,
      maxMarks: r.maxMarks,
      status: 'missing',
      evidenceQuote: null,
      evidenceMatched: false,
      evidenceStart: null,
      evidenceEnd: null,
      feedback: 'No response submitted.',
    }));

    const result: GradingResult = {
      id: gradingResultId,
      submissionId: submission.id,
      totalMarks: 0,
      maxMarks: question.maxMarks,
      confidence: 1.0,
      needsHumanReview: false,
      reviewReason: undefined,
      status: 'complete',
      createdAt: now,
      pointResults,
      annotations: [],
    };

    saveGradingResultToDb(db, result, []);
    return result;
  }

  // Step 2: First attempt. A network/API failure gets one backoff retry;
  // a schema-invalid response gets one retry with a stricter "JSON only" prompt.
  // These are handled as distinct failure modes per the reliability spec.
  let attempt = await attemptGrade(primaryGrader, question, rubricPoints, submission.studentAnswerText, logs, false);

  if (!attempt.ok && attempt.kind === 'network') {
    await sleep(300);
    attempt = await attemptGrade(primaryGrader, question, rubricPoints, submission.studentAnswerText, logs, false);
  }

  if (!attempt.ok && attempt.kind === 'malformed') {
    attempt = await attemptGrade(primaryGrader, question, rubricPoints, submission.studentAnswerText, logs, true);
  }

  if (attempt.ok) {
    rawOutput = attempt.data;
  } else if (attempt.kind === 'network') {
    isDegraded = true;
  } else {
    isFailedSchema = true;
  }

  // Step 3: Safety-net fallback. Both failure modes end up graded by the
  // deterministic MockGrader so a result always exists — but the *status* and
  // review reason keep telling the truth about which failure actually happened.
  if (!rawOutput) {
    const fallbackRes = await fallbackGrader.grade(question, rubricPoints, submission.studentAnswerText);
    logs.push({
      ...fallbackRes.log,
      error: isDegraded
        ? 'Primary grader API failed after a retry. Used MockGrader fallback.'
        : 'Primary grader returned output that failed schema validation, even after a stricter retry. Used MockGrader safety fallback.',
    });
    rawOutput = fallbackRes.rawOutput;
  }

  // Step 4: Deterministic post-processing (code, not the LLM) — clamping,
  // evidence matching with real character offsets, and annotation placement.
  let matchedCount = 0;
  let totalQuoteCount = 0;
  const unmatchedCriteria: string[] = [];
  const unmatchedNonzeroCriteria: string[] = [];
  const pointResults: RubricPointResult[] = [];
  const annotations: Annotation[] = [];
  const layout = computeTextLayout(submission.studentAnswerText);

  // A rubric criterion that depends on a diagram/figure can never be
  // verified by this text-only pipeline — if the answer came from an
  // uploaded document (PDF or DOCX, either of which can contain a real
  // diagram as an embedded image, invisible to text extraction), the
  // per-point feedback itself needs to say that plainly rather than stating
  // "no diagram provided" with the same unqualified confidence as every
  // other point — that reads as a confident, verified judgment when the
  // model never actually looked at anything visual on the page.
  const visualCriterionPattern = /\bdiagram\b|\bfigure\b|\bgraph\b|\bsketch\b|\bdraw(?:ing|n)?\b|\bplot\b|\bchart\b|\billustrat/i;
  const isVisualEvidenceBlind = submission.sourceType !== 'pasted';

  for (let i = 0; i < rubricPoints.length; i++) {
    const r = rubricPoints[i];
    const rawPoint = rawOutput.pointResults.find(pr => pr.rubricPointId === r.id) || {
      rubricPointId: r.id,
      status: 'missing' as const,
      marksAwarded: 0,
      evidenceQuote: null,
      feedback: 'Criterion not evaluated by model.',
    };

    const clampedMarks = Math.min(Math.max(0, Number(rawPoint.marksAwarded) || 0), r.maxMarks);

    const { matched, normalizedQuote, startOffset, endOffset } = fuzzyMatchQuote(rawPoint.evidenceQuote, submission.studentAnswerText);
    if (rawPoint.evidenceQuote) {
      totalQuoteCount++;
      if (matched) {
        matchedCount++;
      } else {
        unmatchedCriteria.push(r.criterion);
        if (clampedMarks > 0) unmatchedNonzeroCriteria.push(r.criterion);
      }
    }

    const prId = `pr-${crypto.randomUUID()}`;
    const pointStatus = rawPoint.status || (clampedMarks === r.maxMarks ? 'correct' : clampedMarks > 0 ? 'partial' : 'incorrect');
    const isMistakePoint = pointStatus !== 'correct' || clampedMarks < r.maxMarks;

    const baseFeedback = rawPoint.feedback || 'Evaluated against rubric criterion.';
    const feedback =
      isVisualEvidenceBlind && visualCriterionPattern.test(r.criterion)
        ? `${baseFeedback} (This system grades from extracted text only and did not look at any diagram/figure — verify this point against the original uploaded file.)`
        : baseFeedback;

    pointResults.push({
      id: prId,
      gradingResultId,
      rubricPointId: r.id,
      marksAwarded: clampedMarks,
      maxMarks: r.maxMarks,
      status: pointStatus,
      evidenceQuote: normalizedQuote,
      evidenceMatched: matched,
      evidenceStart: matched ? startOffset : null,
      evidenceEnd: matched ? endOffset : null,
      feedback,
    });

    // Only auto-generate an annotation when the evidence is actually
    // locatable in the student's text — an unmatched/fabricated quote gets
    // no box, per the reliability rule: never draw a mark you can't justify.
    if (isMistakePoint && matched && startOffset !== null && endOffset !== null) {
      const boxes = boxesForRange(layout, startOffset, endOffset);
      boxes.forEach((box, boxIdx) => {
        annotations.push({
          id: `ann-${crypto.randomUUID()}`,
          gradingResultId,
          page: box.page,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          type: pointStatus === 'incorrect' ? 'box' : 'underline',
          linkedPointResultId: prId,
          // Only the first line of a multi-line quote carries the visible
          // correction callout, so a long quote doesn't repeat its note once per line.
          // Stored as plain feedback (no "[criterion]:" prefix) — the UI shows the
          // criterion as this row's own header, and the PDF exporter adds the
          // prefix itself at export time (it has no such header to rely on).
          correctionText: boxIdx === 0 ? rawPoint.feedback : '',
          createdByUser: false,
          updatedAt: now,
        });
      });
    }
  }

  // Step 4.5: Best-effort vision assessment for diagram/figure criteria —
  // only attempted when the primary grader actually has vision capability
  // (a real GeminiGrader with working credentials) and the original upload
  // is a rasterizable PDF (DOCX rasterization isn't built — those criteria
  // still fall back to the honest review flag below). On ANY failure (no
  // credentials, a missing native rendering dependency in whatever
  // environment this runs in, a malformed response) this silently does
  // nothing and every diagram criterion keeps behaving exactly as before —
  // this can only ever add a real check on top of that, never regress it.
  const visuallyAssessedRubricPointIds = new Set<string>();
  if (isVisualEvidenceBlind && primaryGrader instanceof GeminiGrader && submission.studentAnswerFilePath?.toLowerCase().endsWith('.pdf')) {
    try {
      const visualTargets = pointResults
        .map((pr, idx) => ({ pr, idx, rp: rubricPoints.find(r => r.id === pr.rubricPointId) }))
        .filter((t): t is { pr: RubricPointResult; idx: number; rp: RubricPoint } => Boolean(t.rp) && visualCriterionPattern.test(t.rp!.criterion));

      if (visualTargets.length > 0) {
        const fileBuffer = fs.readFileSync(submission.studentAnswerFilePath);
        const pageImages = await renderPdfPagesToImages(fileBuffer);

        if (pageImages.length > 0) {
          const assessments = await Promise.all(
            visualTargets.map(async ({ idx, rp }) => ({
              idx,
              rubricPointId: rp.id,
              result: await primaryGrader.assessVisualCriterion!(`${question.title}\n${question.text}`, rp.criterion, rp.maxMarks, pageImages),
            }))
          );

          for (const { idx, rubricPointId, result } of assessments) {
            if (!result) continue; // this one point falls back to the honest review flag
            pointResults[idx] = {
              ...pointResults[idx],
              marksAwarded: result.marksAwarded,
              status: result.satisfied ? 'correct' : 'incorrect',
              // Cleared, not carried over — whatever quote the earlier
              // text-only pass guessed for this criterion (often just
              // picking up the diagram's own text labels) has nothing to do
              // with this new vision-derived judgment. Left in place, Step
              // 5's text-verification pass would still run against it and
              // spuriously "disagree" (the quote can't justify a visual
              // judgment), forcing exactly the review flag this feature
              // exists to lift — confirmed happening before this fix.
              evidenceQuote: null,
              evidenceMatched: false,
              evidenceStart: null,
              evidenceEnd: null,
              feedback: `AI visual assessment (from the uploaded page image): ${result.feedback}`,
            };
            visuallyAssessedRubricPointIds.add(rubricPointId);
          }
        }
      }
    } catch {
      // Rasterization or vision assessment failed entirely — every
      // diagram/figure criterion falls back to the honest review flag.
    }
  }

  const computedTotal = pointResults.reduce((sum, pr) => sum + pr.marksAwarded, 0);

  // Step 5: Verification pass — re-check every point that has an evidence
  // quote. Each point's verification call is fully independent of every
  // other, so they run concurrently (Promise.all) rather than one at a
  // time — a rubric with 4-5 scored points previously meant 4-5 sequential
  // LLM round-trips before this step could finish, which is exactly the
  // "why does verifying evidence take so long" latency this was causing.
  let verificationAgreements = 0;
  let verificationTotal = 0;
  const disagreedCriteria: string[] = [];

  if (primaryGrader.verify) {
    const verifyTasks = pointResults
      .filter(pr => pr.evidenceQuote)
      .map(pr => {
        const rp = rubricPoints.find(r => r.id === pr.rubricPointId);
        if (!rp) return null;
        return primaryGrader
          .verify!(question, rp, pr.evidenceQuote!, pr.status)
          .then(vRes => ({ criterion: rp.criterion, log: vRes.log, agrees: vRes.agrees }))
          .catch(() => null); // ignore — verification is a confidence signal, not a hard requirement
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    const verifyResults = await Promise.all(verifyTasks);
    for (const result of verifyResults) {
      if (!result) continue;
      logs.push(result.log);
      verificationTotal++;
      if (result.agrees) {
        verificationAgreements++;
      } else {
        disagreedCriteria.push(result.criterion);
      }
    }
  }

  // Step 6: Confidence & review-flag logic.
  const quoteMatchRate = totalQuoteCount > 0 ? matchedCount / totalQuoteCount : 1.0;
  const verifyRate = verificationTotal > 0 ? verificationAgreements / verificationTotal : 1.0;
  const isFullScore = computedTotal === question.maxMarks;

  const baseConfidence = isFullScore
    ? (quoteMatchRate * 0.3 + verifyRate * 0.7)
    : (quoteMatchRate * 0.5 + verifyRate * 0.5);
  const confidence = (isDegraded || isFailedSchema) ? Math.min(0.6, baseConfidence) : Number(baseConfidence.toFixed(2));

  // Same diagram/figure blindness computed in Step 4 (used there to caveat
  // each matching point's own feedback text) — reused here to also force the
  // overall review flag, per the reliability rule ("if the system is
  // uncertain, it should say so instead of pretending to be correct").
  // Excludes any point Step 4.5 actually got a real vision assessment for —
  // that one genuinely was checked, so forcing review for it too would just
  // be re-adding the exact manual-review burden this feature exists to cut.
  const visualCriteriaNeedingReview = isVisualEvidenceBlind
    ? rubricPoints.filter(r => visualCriterionPattern.test(r.criterion) && !visuallyAssessedRubricPointIds.has(r.id)).map(r => r.criterion)
    : [];

  // needsHumanReview applies uniformly regardless of score — a full-score
  // result with a fabricated/unmatched evidence quote is exactly the case
  // this flag exists to catch, not an exemption from it.
  const needsHumanReview =
    isDegraded ||
    isFailedSchema ||
    confidence < 0.75 ||
    disagreedCriteria.length > 0 ||
    unmatchedNonzeroCriteria.length > 0 ||
    Boolean(submission.extractionNote) ||
    visualCriteriaNeedingReview.length > 0;

  let reviewReason: string | undefined;

  if (isDegraded) {
    reviewReason = 'Graded in degraded mode — primary LLM API failed after a retry; results are from the fallback mock grader.';
  } else if (isFailedSchema) {
    reviewReason = 'Primary model returned output that failed schema validation even after a stricter retry — graded using a fallback safety model; please verify carefully.';
  } else if (needsHumanReview) {
    const reasons: string[] = [];
    if (submission.extractionNote) reasons.push(submission.extractionNote);
    if (visualCriteriaNeedingReview.length > 0) {
      reasons.push(
        `this system grades from extracted text only and cannot see diagrams/figures — check the original file for: ${visualCriteriaNeedingReview.map(c => `"${c}"`).join(', ')}`
      );
    }
    if (disagreedCriteria.length > 0) {
      reasons.push(`verification disagreed on: ${disagreedCriteria.map(c => `"${c}"`).join(', ')}`);
    }
    if (unmatchedNonzeroCriteria.length > 0) {
      reasons.push(`evidence quote did not match student text for a scored point: ${unmatchedNonzeroCriteria.map(c => `"${c}"`).join(', ')}`);
    }
    if (confidence < 0.75 && reasons.length === 0) {
      reasons.push(`overall confidence ${Math.round(confidence * 100)}% is below 75% threshold`);
    }
    reviewReason = `Needs review — ${reasons.join('; ')}.`;
  }

  const result: GradingResult = {
    id: gradingResultId,
    submissionId: submission.id,
    totalMarks: Number(computedTotal.toFixed(1)),
    maxMarks: question.maxMarks,
    confidence,
    needsHumanReview,
    reviewReason,
    status: isDegraded ? 'degraded' : isFailedSchema ? 'failed' : 'complete',
    createdAt: now,
    pointResults,
    annotations,
  };

  saveGradingResultToDb(db, result, logs);
  return result;
}

function saveGradingResultToDb(db: any, result: GradingResult, logs: LogEntry[]) {
  const insertResult = db.prepare(`
    INSERT INTO grading_results (id, submission_id, total_marks, max_marks, confidence, needs_human_review, review_reason, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertPoint = db.prepare(`
    INSERT INTO rubric_point_results (id, grading_result_id, rubric_point_id, marks_awarded, max_marks, status, evidence_quote, evidence_matched, evidence_start, evidence_end, feedback)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertAnn = db.prepare(`
    INSERT INTO annotations (id, grading_result_id, page, x, y, width, height, type, linked_point_result_id, correction_text, created_by_user, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertLog = db.prepare(`
    INSERT INTO llm_logs (id, grading_result_id, pass, raw_request, raw_response, model, latency_ms, error, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const transaction = db.transaction(() => {
    insertResult.run(
      result.id,
      result.submissionId,
      result.totalMarks,
      result.maxMarks,
      result.confidence,
      result.needsHumanReview ? 1 : 0,
      result.reviewReason || null,
      result.status,
      result.createdAt
    );

    result.pointResults.forEach(pr => {
      insertPoint.run(
        pr.id,
        pr.gradingResultId,
        pr.rubricPointId,
        pr.marksAwarded,
        pr.maxMarks,
        pr.status,
        pr.evidenceQuote,
        pr.evidenceMatched ? 1 : 0,
        pr.evidenceStart,
        pr.evidenceEnd,
        pr.feedback
      );
    });

    (result.annotations || []).forEach(ann => {
      insertAnn.run(
        ann.id,
        ann.gradingResultId,
        ann.page,
        ann.x,
        ann.y,
        ann.width,
        ann.height,
        ann.type,
        ann.linkedPointResultId || null,
        ann.correctionText,
        ann.createdByUser ? 1 : 0,
        ann.updatedAt
      );
    });

    logs.forEach(l => {
      insertLog.run(
        `log-${crypto.randomUUID()}`,
        result.id,
        l.pass,
        l.rawRequest,
        l.rawResponse,
        l.model,
        l.latencyMs,
        l.error || null,
        result.createdAt
      );
    });
  });

  transaction();
}
