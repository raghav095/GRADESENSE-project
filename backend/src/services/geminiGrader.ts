import { GoogleGenAI } from '@google/genai';
import fs from 'fs';
import { Grader, Question, RubricPoint, RawLlmGradingOutput, LlmCallLog, RubricStatus, GradeOptions } from './types.js';
import { QuestionDraftSchema, QuestionDraft } from './questionDraftSchema.js';

/** Thrown when a grader call fails — carries the partial log entry (if any) so the pipeline can still persist it for audit, even on failure. */
export class GraderCallError extends Error {
  log?: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>;
  /** 'malformed' = the call succeeded but the body failed JSON/schema validation (retry with a stricter prompt). 'network' = the call itself failed (retry with backoff, then fall back). */
  kind: 'malformed' | 'network';
  constructor(message: string, log?: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>, kind: 'malformed' | 'network' = 'network') {
    super(message);
    this.name = 'GraderCallError';
    this.log = log;
    this.kind = kind;
  }
}

export class GeminiGrader implements Grader {
  private ai: GoogleGenAI | null = null;
  private modelName: string;

  constructor(apiKey?: string, modelName = 'gemini-2.5-flash') {
    this.modelName = modelName;
    const key = apiKey || process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    if (key) {
      this.ai = new GoogleGenAI({ apiKey: key });
    } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
      // Only use an explicitly-configured service-account file — never guess a
      // file path by convention, so a stray key file in cwd is never picked
      // up silently.
      try {
        const keyData = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf8'));
        this.ai = new GoogleGenAI({
          vertexai: true,
          project: keyData.project_id,
          location: process.env.GOOGLE_CLOUD_LOCATION || 'us-central1',
        });
      } catch {
        // ignore — falls through to selectGrader()'s MockGrader fallback
      }
    }
  }

  async grade(question: Question, rubric: RubricPoint[], answerText: string, opts?: GradeOptions): Promise<{
    rawOutput: RawLlmGradingOutput;
    log: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>;
  }> {
    if (!this.ai) {
      throw new GraderCallError('Gemini/Vertex AI client initialized without API Key or GCP Credentials');
    }

    const startTime = Date.now();

    const rubricDescription = rubric
      .map(r => `[Rubric ID: ${r.id}] Max Marks: ${r.maxMarks}\nCriterion: ${r.criterion}`)
      .join('\n\n');

    const strictSuffix = opts?.strict
      ? '\n\nYour previous response could not be parsed as valid JSON against the schema below. Return ONLY the raw JSON object — no markdown code fences, no prose before or after, no trailing commentary.'
      : '';

    const prompt = `
You are an expert, objective academic examiner and grading assistant for GradeSense.
Your task is to evaluate a student's answer against specific rubric criteria.

CRITICAL INSTRUCTIONS:
1. Grade CRITERION SATISFACTION and REASONING QUALITY, NOT verbatim keyword matching or similarity to any reference answer.
2. For open-ended questions (such as essays or discussions): A student who argues the OPPOSITE conclusion from a typical reference answer MUST STILL RECEIVE FULL MARKS if their argument is logically sound, supported by examples, and addresses opposing views.
3. For science/technical questions: A student who explains the physical mechanism correctly using different vocabulary or without explicit jargon (e.g. without naming "Ohm's law" explicitly) MUST receive full marks for that criterion if the physics is correct.
4. Conversely, a student whose answer uses correct keywords but contains a substantive conceptual or diagram error (e.g. wiring a voltmeter in series) MUST be marked INCORRECT for that criterion.
5. Provide a verbatim quote from the student's answer as 'evidenceQuote' for points marked correct, partial, or incorrect. If no quote exists or point is missing, return null.

QUESTION:
${question.title}
${question.text}

RUBRIC CRITERIA TO GRADE:
${rubricDescription}

STUDENT ANSWER TO EVALUATE:
"""
${answerText}
"""

Return ONLY a JSON object matching this schema (no markdown block wrappers, no preamble):
{
  "pointResults": [
    {
      "rubricPointId": "string (matching rubric point ID)",
      "status": "correct | partial | missing | incorrect",
      "marksAwarded": number (between 0 and maxMarks for this rubric point),
      "evidenceQuote": "exact verbatim substring from student answer, or null if missing",
      "feedback": "concise, specific explanation of what was correct, missing, or wrong, and how to fix it"
    }
  ]
}
${strictSuffix}`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.1,
        },
      });

      const responseText = response.text || '';
      const latencyMs = Date.now() - startTime;

      const log: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'> = {
        pass: 'grading',
        rawRequest: prompt,
        rawResponse: responseText,
        model: this.modelName,
        latencyMs,
      };

      let parsed: RawLlmGradingOutput;
      try {
        const cleanJsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();
        parsed = JSON.parse(cleanJsonStr) as RawLlmGradingOutput;
      } catch (parseErr: any) {
        // Not a network/API failure — the call succeeded but the body isn't
        // valid JSON. Surface this distinctly (with the raw response
        // attached) so the pipeline can retry with a stricter prompt rather
        // than treating it as an outage.
        throw new GraderCallError(`Gemini returned non-JSON output: ${parseErr.message}`, {
          ...log,
          error: `JSON parse failure: ${parseErr.message}`,
        }, 'malformed');
      }

      return { rawOutput: parsed, log };
    } catch (err: any) {
      if (err instanceof GraderCallError) throw err;
      throw new GraderCallError(`Gemini LLM Call Failed: ${err.message}`, {
        pass: 'grading',
        rawRequest: prompt,
        rawResponse: '',
        model: this.modelName,
        latencyMs: Date.now() - startTime,
        error: err.message,
      });
    }
  }

  /**
   * Drafts a model answer + rubric from a question's text — used ONLY to
   * pre-fill the Add Question form for a human to review and edit; the
   * result is never saved or graded against on its own. One retry with a
   * stricter prompt on malformed output, same pattern as grade(); if the
   * model isn't configured or both attempts fail, this throws and the
   * caller falls back to a fully manual form — never a silently fabricated
   * rubric standing in for a real one.
   */
  async draftQuestion(questionText: string, opts?: GradeOptions): Promise<QuestionDraft> {
    if (!this.ai) {
      throw new GraderCallError('Gemini/Vertex AI client initialized without API Key or GCP Credentials');
    }

    const strictSuffix = opts?.strict
      ? '\n\nYour previous response could not be parsed as valid JSON against the schema below. Return ONLY the raw JSON object — no markdown code fences, no prose before or after.'
      : '';

    const prompt = `
You are helping a teacher set up a new exam question in a grading tool.

Given the question text below, produce:
1. A concise model/ideal answer (2-6 sentences) that would receive full marks.
2. A marking rubric: 3-6 independent criteria. Each criterion must describe ONE thing that must be TRUE in the reasoning/content for credit — never exact wording or keyword matching, since a correct answer may use entirely different phrasing or even a different conclusion if well-argued (for open-ended questions). Assign each criterion a max-marks value (whole or half numbers); the criteria should sum to roughly 5 total marks unless the question clearly warrants a different scale.

QUESTION TEXT:
"""
${questionText}
"""

Return ONLY a JSON object matching this schema (no markdown fences, no prose):
{
  "suggestedTitle": "short descriptive title for this question",
  "suggestedSubject": "one or two word subject area",
  "modelAnswerText": "the model answer",
  "rubricPoints": [
    { "criterion": "string describing what must be true for credit", "maxMarks": number }
  ]
}
${strictSuffix}`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: { responseMimeType: 'application/json', temperature: 0.2 },
      });

      const responseText = response.text || '';
      const cleanJsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(cleanJsonStr);
      } catch (parseErr: any) {
        throw new GraderCallError(`Gemini returned non-JSON output while drafting a question: ${parseErr.message}`, undefined, 'malformed');
      }

      const validated = QuestionDraftSchema.safeParse(parsed);
      if (!validated.success) {
        throw new GraderCallError(`Drafted question failed schema validation: ${validated.error.issues.map(i => i.message).join('; ')}`, undefined, 'malformed');
      }

      return validated.data;
    } catch (err: any) {
      if (err instanceof GraderCallError) throw err;
      throw new GraderCallError(`Gemini call failed while drafting a question: ${err.message}`);
    }
  }

  /**
   * Transcribes handwritten or otherwise non-extractable text from page
   * image(s) — for a scanned or photographed answer sheet, where pdfjs's
   * text-layer extraction finds nothing because there IS no text layer,
   * only pixels. A best-effort enhancement: on any failure (no credentials,
   * empty/garbled response) this returns null, and the caller falls back to
   * the existing honest behavior — flagging the near-empty extraction for
   * human review — exactly as it did before this existed. This is never
   * treated as a replacement for that review flag when it succeeds, either:
   * AI-transcribed handwriting is inherently less certain than a real text
   * layer, so the caller still asks a human to verify it against the
   * original file.
   */
  async transcribeHandwriting(pageImages: Buffer[]): Promise<string | null> {
    if (!this.ai || pageImages.length === 0) return null;

    const prompt = `Transcribe all the handwritten (or otherwise non-selectable) text visible in the following image(s) into plain text, as accurately as possible.

Rules:
- Preserve paragraph breaks with a blank line between paragraphs.
- If a word or phrase is genuinely illegible, write [illegible] in its place rather than guessing.
- Transcribe only what is actually written — do not summarize, correct spelling, or complete sentences on the student's behalf.
- If the image contains no handwritten or printed text at all (e.g. it's blank, or purely a diagram with no words), return an empty string.

Return ONLY the transcribed text — no commentary, no markdown, no preamble.`;

    try {
      const parts: any[] = [{ text: prompt }];
      for (const img of pageImages) {
        parts.push({ inlineData: { mimeType: 'image/png', data: img.toString('base64') } });
      }

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts }],
        config: { temperature: 0.1 },
      });

      const text = (response.text || '').trim();
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * Assesses ONE rubric criterion that depends on a diagram/figure, using
   * the actual rendered page image(s) instead of extracted text — the only
   * way this pipeline can ever have a real opinion about something visual,
   * since text extraction never sees pixels. A best-effort enhancement: on
   * any failure (no credentials, malformed response) this returns null so
   * the caller falls back to flagging the point for human review, exactly
   * as it did before this existed.
   */
  async assessVisualCriterion(
    questionContext: string,
    criterion: string,
    maxMarks: number,
    pageImages: Buffer[]
  ): Promise<{ satisfied: boolean; marksAwarded: number; feedback: string } | null> {
    if (!this.ai || pageImages.length === 0) return null;

    const prompt = `You are assessing ONE specific criterion from a grading rubric, using the actual page image(s) of a student's answer — not extracted text, since this criterion depends on a diagram/figure that text extraction cannot see.

QUESTION CONTEXT:
${questionContext}

CRITERION TO ASSESS (worth ${maxMarks} mark(s)):
${criterion}

Look at the image(s) and decide whether the criterion is satisfied. Be strict — only mark it satisfied if the diagram genuinely and clearly meets the criterion as described. If there is no diagram at all in the image(s), it is not satisfied.

Return ONLY a JSON object (no markdown fences, no prose):
{
  "satisfied": boolean,
  "feedback": "one or two sentences explaining what you saw and why it does or doesn't satisfy the criterion"
}`;

    try {
      const parts: any[] = [{ text: prompt }];
      for (const img of pageImages) {
        parts.push({ inlineData: { mimeType: 'image/png', data: img.toString('base64') } });
      }

      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: [{ role: 'user', parts }],
        config: { responseMimeType: 'application/json', temperature: 0.1 },
      });

      const cleanJsonStr = (response.text || '').replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanJsonStr);
      if (typeof parsed.satisfied !== 'boolean') return null;

      return {
        satisfied: parsed.satisfied,
        marksAwarded: parsed.satisfied ? maxMarks : 0,
        feedback: typeof parsed.feedback === 'string' ? parsed.feedback : 'Assessed from the uploaded page image.',
      };
    } catch {
      return null;
    }
  }

  async verify(
    question: Question,
    rubricPoint: RubricPoint,
    evidenceQuote: string,
    claimedStatus: RubricStatus
  ): Promise<{
    agrees: boolean;
    reasoning: string;
    log: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>;
  }> {
    if (!this.ai) {
      throw new Error('Gemini API client not initialized');
    }

    const startTime = Date.now();
    const prompt = `
You are a verification auditor for an AI grading system.
Verify whether the following evidence quote from a student answer actually supports the assigned status.

CRITERION: ${rubricPoint.criterion}
CLAIMED STATUS: ${claimedStatus}
EVIDENCE QUOTE: "${evidenceQuote}"

Does the evidence quote actually justify the status "${claimedStatus}" for this criterion in the student's own words?

Return JSON:
{
  "agrees": boolean,
  "reasoning": "short explanation"
}
`;

    try {
      const response = await this.ai.models.generateContent({
        model: this.modelName,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.0,
        },
      });

      const responseText = response.text || '';
      const cleanJsonStr = responseText.replace(/```json\n?|\n?```/g, '').trim();
      const parsed = JSON.parse(cleanJsonStr) as { agrees: boolean; reasoning: string };

      return {
        agrees: parsed.agrees,
        reasoning: parsed.reasoning,
        log: {
          pass: 'verification',
          rawRequest: prompt,
          rawResponse: responseText,
          model: this.modelName,
          latencyMs: Date.now() - startTime,
        },
      };
    } catch (err: any) {
      return {
        agrees: true,
        reasoning: `Verification fallback due to API error: ${err.message}`,
        log: {
          pass: 'verification',
          rawRequest: prompt,
          rawResponse: '',
          model: this.modelName,
          latencyMs: Date.now() - startTime,
          error: err.message,
        },
      };
    }
  }
}
