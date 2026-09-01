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
