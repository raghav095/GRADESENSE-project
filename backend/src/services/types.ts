export type RubricStatus = 'correct' | 'partial' | 'missing' | 'incorrect';

export interface Question {
  id: string;
  subject: string;
  title: string;
  text: string;
  maxMarks: number;
  modelAnswerText?: string | null;
  createdAt: string;
}

export interface RubricPoint {
  id: string;
  questionId: string;
  criterion: string;
  maxMarks: number;
  orderIndex: number;
}

export interface Submission {
  id: string;
  questionId: string;
  studentName: string;
  rollNumber: string;
  studentAnswerText: string;
  studentAnswerFilePath?: string;
  sourceType: 'pasted' | 'pdf';
  createdAt: string;
}

export interface RubricPointResult {
  id: string;
  gradingResultId: string;
  rubricPointId: string;
  marksAwarded: number;
  maxMarks: number;
  status: RubricStatus;
  evidenceQuote: string | null;
  evidenceMatched: boolean;
  /** Character offsets of the matched evidence within the student's answer text (null if unmatched). */
  evidenceStart: number | null;
  evidenceEnd: number | null;
  feedback: string;
}

export interface GradingResult {
  id: string;
  submissionId: string;
  totalMarks: number;
  maxMarks: number;
  confidence: number;
  needsHumanReview: boolean;
  reviewReason?: string;
  /** Set once a teacher explicitly acknowledges a flagged result (see PATCH /api/results/:id/review) — an audit trail distinct from needsHumanReview itself, which that action clears. */
  reviewedAt?: string | null;
  status: 'complete' | 'degraded' | 'failed';
  createdAt: string;
  pointResults: RubricPointResult[];
  annotations?: Annotation[];
}

export interface Annotation {
  id: string;
  gradingResultId: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  type: 'underline' | 'box';
  linkedPointResultId?: string;
  correctionText: string;
  createdByUser: boolean;
  updatedAt: string;
}

export interface LlmCallLog {
  id: string;
  gradingResultId: string;
  pass: 'grading' | 'verification';
  rawRequest: string;
  rawResponse: string;
  model: string;
  latencyMs: number;
  error?: string;
  createdAt: string;
}

export interface RawLlmPointResult {
  rubricPointId: string;
  status: RubricStatus;
  marksAwarded: number;
  evidenceQuote: string | null;
  feedback: string;
}

export interface RawLlmGradingOutput {
  pointResults: RawLlmPointResult[];
  generalFeedback?: string;
}

export interface GradeOptions {
  /** Ask the grader to be extra strict about returning ONLY valid JSON — used for the one retry after a schema-validation failure. */
  strict?: boolean;
}

export interface Grader {
  grade(question: Question, rubric: RubricPoint[], answerText: string, opts?: GradeOptions): Promise<{
    rawOutput: RawLlmGradingOutput;
    log: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>;
  }>;
  verify?(question: Question, rubricPoint: RubricPoint, evidenceQuote: string, claimedStatus: RubricStatus): Promise<{
    agrees: boolean;
    reasoning: string;
    log: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>;
  }>;
}
