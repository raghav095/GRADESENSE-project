import { describe, it, expect, beforeEach } from 'vitest';
import { runGradingPipeline } from '../src/services/gradingPipeline.js';
import { MockGrader } from '../src/services/mockGrader.js';
import { initializeDatabase } from '../src/db/schema.js';
import { getDb } from '../src/db/index.js';
import { computeTextLayout, boxesForRange } from '../src/services/textLayout.js';
import { Grader, Question, RubricPoint } from '../src/services/types.js';
import path from 'path';
import fs from 'fs';

const TEST_DB_PATH = path.join(process.cwd(), 'test_gradesense.db');

describe('GradeSense Reliability & Grading Pipeline Test Suite', () => {
  beforeEach(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    initializeDatabase(TEST_DB_PATH);
  });

  // Test 1: Fully correct answer
  it('1. Should award max marks for a fully correct answer fixture', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-correct-1';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Ideal Student', '01', 'Complete circuit connected in series, voltmeter in parallel, V=IR explained.', 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    expect(res.totalMarks).toBe(5.0);
    expect(res.status).toBe('complete');
    expect(res.needsHumanReview).toBe(false);
  });

  // Test 2: Partially correct answer (Ananya Rao Q1 Science)
  it('2. Should correctly calculate mixed marks for a partially correct answer (Ananya Rao Q1)', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-partial-1';
    const answerText = `
An electric circuit is a close path in which electric current can flow. Battery gives potentiall diffrence.
Ammeter is connected in series. Voltmeter is also connected in series as shown in diagram.
When current pass through the circuit some of the current get used up by the bulb and resistor.
As per Ohms law V=IR. If we increase resistance current will also increase.
    `;
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Ananya Rao', '24B', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    expect(res.totalMarks).toBe(2.0); // 1.0 (rp1) + 0 (rp2) + 0.5 (rp3) + 0 (rp4) + 0.5 (rp5)
    expect(res.maxMarks).toBe(5.0);
    expect(res.pointResults).toHaveLength(5);
  });

  // Test 3: Incorrect answer
  it('3. Should award 0 or low marks for an entirely incorrect answer', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-incorrect-1';
    const answerText = 'Electricity comes from magnets that spin around in the air. The bulb glows because it is painted yellow.';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Unprepared Student', '99', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    expect(res.totalMarks).toBe(0.0);
    expect(res.annotations!.length).toBeGreaterThan(0);
  });

  // Test 4: Blank answer short-circuit
  it('4. Should short-circuit blank answers to 0 marks without invoking LLM API', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-blank-1';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Blank Student', '00', '   ', 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    expect(res.totalMarks).toBe(0.0);
    expect(res.confidence).toBe(1.0);
    expect(res.needsHumanReview).toBe(false);
  });

  // Test 5: OCR-like spelling errors tolerance
  it('5. Should match evidence and grade accurately despite OCR-like spelling errors', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-ocr-1';
    const answerText = 'battery, switch, resistor, bulb and ammeter is connected in series with potentiall diffrence push current.';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'OCR Student', '12', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    const rp1 = res.pointResults.find(p => p.rubricPointId === 'q1-rp1');
    expect(rp1?.evidenceMatched).toBe(true);
    expect(rp1?.marksAwarded).toBe(1.0);
  });

  // Test 6: Malformed LLM output handling
  it('6. Should handle malformed model output gracefully and flag for human review', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-malformed-1';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Test Student', '03', 'Sample answer text', 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const malformedGrader = new MockGrader({ simulateError: 'malformed' });
    const res = await runGradingPipeline(submission, malformedGrader, TEST_DB_PATH);

    // Malformed schema output is a distinct failure mode from an API outage:
    // it gets one stricter-prompt retry, and — if that still fails schema
    // validation — is reported as 'failed' (not 'degraded', which is reserved
    // for the primary grader's API call itself failing).
    expect(res.needsHumanReview).toBe(true);
    expect(res.status).toBe('failed');
    expect(res.reviewReason).toContain('schema validation');
  });

  // Test 7: API failure fallback
  it('7. Should fall back to degraded mode on primary API failure', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-apifail-1';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Test Student', '04', 'battery, switch, resistor, bulb and ammeter is connected in series', 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const failingGrader = new MockGrader({ simulateError: 'api_failure' });
    const res = await runGradingPipeline(submission, failingGrader, TEST_DB_PATH);

    expect(res.status).toBe('degraded');
    expect(res.needsHumanReview).toBe(true);
    expect(res.reviewReason).toContain('degraded mode');
  });

  // Test 8: Score exceeding max marks clamping
  it('8. Should strictly clamp marks to maxMarks and recompute total sum', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-overmax-1';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Test Student', '05', 'Sample text', 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const overMaxGrader = new MockGrader({ simulateError: 'over_max' });
    const res = await runGradingPipeline(submission, overMaxGrader, TEST_DB_PATH);

    res.pointResults.forEach(pr => {
      expect(pr.marksAwarded).toBeLessThanOrEqual(pr.maxMarks);
    });
    expect(res.totalMarks).toBe(5.0);
  });

  // Test 9: Adversarial English (Opposing conclusion, excellent reasoning)
  it('9. Should award 5/5 to English essay arguing OPPOSITE conclusion with strong reasoning', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-adv-english-1';
    const answerText = 'Technology has fundamentally reshaped learning dynamics, but I argue that easy access creates cognitive dependency rather than genuine comprehension. When information is instantly retrievable, students frequently substitute superficial searching for deep analytical thinking. For example, a student copying code solutions or math answers online may finish their homework faster, but fails to internalize the underlying concepts. While proponents argue that digital tools enable self-paced exploration, without disciplined reflection, easy answers discourage intellectual perseverance. Therefore, technology must be integrated as a secondary aid rather than a primary crutch for learning.';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q2-english', 'Adversarial Student', '77', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    expect(res.totalMarks).toBe(5.0);
    expect(res.needsHumanReview).toBe(false);
  });

  // Test 10: Adversarial Science (Unique vocabulary, correct physics)
  it('10. Should award 5/5 to Science answer using unique vocabulary but correct physics', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-adv-science-1';
    const answerText = 'In a closed electrical loop, higher opposition to charge flow restricts rate of charge transport...';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Physics Scholar', '88', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    expect(res.totalMarks).toBe(5.0);
  });

  // Test 11: Surface matching wrong answer
  it('11. Should mark voltmeter in series as incorrect despite keyword overlap', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-surface-1';
    const answerText = 'battery, switch, resistor, bulb and ammeter is connected in series. Voltmeter is also connected in the circuit to measure the potential diffrence, as shown in diagram below';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Ananya Rao', '24B', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    const rp2 = res.pointResults.find(p => p.rubricPointId === 'q1-rp2');
    expect(rp2?.status).toBe('incorrect');
    expect(rp2?.marksAwarded).toBe(0.0);
  });

  // Test 12: A full-score result with a fabricated (unmatched) evidence quote
  // must still be flagged for human review — this was the bug where a perfect
  // score was structurally exempt from the evidence-match check.
  it('12. Should flag needsHumanReview even on a full-score result if evidence is unmatched', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-fabricated-evidence-1';
    const answerText = 'battery, switch, resistor, bulb and ammeter is connected in series with voltmeter in parallel, V=IR explained.';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Test Student', '06', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const fabricatingGrader: Grader = {
      async grade(question: Question, rubric: RubricPoint[]) {
        return {
          rawOutput: {
            pointResults: rubric.map(r => ({
              rubricPointId: r.id,
              status: 'correct' as const,
              marksAwarded: r.maxMarks,
              evidenceQuote: 'this exact phrase never appears anywhere in the actual student answer',
              feedback: 'Looks complete.',
            })),
          },
          log: { pass: 'grading' as const, rawRequest: 'n/a', rawResponse: 'n/a', model: 'fabricator', latencyMs: 1 },
        };
      },
      async verify() {
        // Verification only judges "does this quote support this status" —
        // it has no way to know the quote itself is fabricated, so it agrees.
        return { agrees: true, reasoning: 'Quote appears self-consistent.', log: { pass: 'verification' as const, rawRequest: 'n/a', rawResponse: 'n/a', model: 'fabricator', latencyMs: 1 } };
      },
    };

    const res = await runGradingPipeline(submission, fabricatingGrader, TEST_DB_PATH);
    expect(res.totalMarks).toBe(res.maxMarks); // full score
    expect(res.needsHumanReview).toBe(true); // but still caught
    expect(res.reviewReason).toContain('did not match');
  });

  // Test 13: Auto-generated annotations must be positioned using the actual
  // matched-evidence character offsets (via the shared text-layout module),
  // not an arbitrary fixed stack — and must skip points with no locatable evidence.
  it('13. Should place annotation boxes at the evidence quote\'s real computed position', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-annotation-position-1';
    const answerText = 'battery, switch, resistor, bulb and ammeter is connected in series. Voltmeter is also connected in the circuit to measure the potential diffrence, as shown in diagram below';
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'Ananya Rao', '24B', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    const rp2 = res.pointResults.find(p => p.rubricPointId === 'q1-rp2'); // voltmeter-in-series, incorrect
    expect(rp2?.evidenceStart).not.toBeNull();
    expect(rp2?.evidenceEnd).not.toBeNull();

    const layout = computeTextLayout(answerText);
    const expectedBoxes = boxesForRange(layout, rp2!.evidenceStart!, rp2!.evidenceEnd!);
    const actualBoxes = (res.annotations || []).filter(a => a.linkedPointResultId === rp2!.id);

    expect(actualBoxes.length).toBe(expectedBoxes.length);
    expect(actualBoxes.length).toBeGreaterThan(0);
    actualBoxes.forEach((box, i) => {
      expect(box.x).toBeCloseTo(expectedBoxes[i].x, 5);
      expect(box.y).toBeCloseTo(expectedBoxes[i].y, 5);
      expect(box.page).toBe(expectedBoxes[i].page);
    });
  });

  // Test 14: A genuinely different, correct answer to a seeded question must
  // be graded on its own merits, not silently returned as Ananya's fixed
  // wrong-answer breakdown. This is exactly the scenario an evaluator's own
  // "extra test cases" would hit — MockGrader previously keyed its q1-science
  // response purely on questionId, so ANY submission to Q1 got Ananya's exact
  // 2/5 result regardless of what it actually said. It's now guarded: a
  // fixture only applies when its specific evidence is actually present.
  it('14. Should grade a genuinely different, correct Q1 answer on its own merits, not as Ananya\'s fixed wrong answers', async () => {
    const db = getDb(TEST_DB_PATH);
    const subId = 'sub-different-correct-q1';
    const answerText = "The battery, switch, resistor and bulb are connected in series and the ammeter is also in series to measure current. The voltmeter is connected in parallel across the bulb to measure potential difference. Current flows in a closed loop from the battery through all components. According to Ohm's law, if resistance increases, current decreases when voltage is constant. The diagram is labeled with the conventional current direction shown from positive to negative terminal.";
    db.prepare(`
      INSERT INTO submissions (id, question_id, student_name, roll_number, student_answer_text, source_type, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(subId, 'q1-science', 'A Different Student', '55', answerText, 'pasted', new Date().toISOString());

    const sub = db.prepare('SELECT * FROM submissions WHERE id = ?').get(subId) as any;
    const submission = {
      id: sub.id,
      questionId: sub.question_id,
      studentName: sub.student_name,
      rollNumber: sub.roll_number,
      studentAnswerText: sub.student_answer_text,
      sourceType: sub.source_type,
      createdAt: sub.created_at,
    };

    const res = await runGradingPipeline(submission, new MockGrader(), TEST_DB_PATH);
    const rp2 = res.pointResults.find(p => p.rubricPointId === 'q1-rp2'); // ammeter series / voltmeter parallel
    const rp4 = res.pointResults.find(p => p.rubricPointId === 'q1-rp4'); // Ohm's law direction

    // Ananya's fixed fixture marks these 'incorrect' — this answer states them
    // correctly, so it must NOT come back with Ananya's wrong-answer status.
    expect(rp2?.status).not.toBe('incorrect');
    expect(rp4?.status).not.toBe('incorrect');
    expect(res.totalMarks).toBeGreaterThan(2.0); // Ananya's fixed total — this answer is better and must score differently
  });
});
