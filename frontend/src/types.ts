export type RubricStatus = 'correct' | 'partial' | 'missing' | 'incorrect';

export interface Question {
  id: string;
  subject: string;
  title: string;
  text: string;
  maxMarks: number;
  createdAt: string;
  rubricPoints: RubricPoint[];
}

export interface RubricPoint {
  id: string;
  questionId: string;
  criterion: string;
  maxMarks: number;
  orderIndex: number;
}

export interface RubricPointResult {
  id: string;
  gradingResultId: string;
  rubricPointId: string;
  criterion: string;
  marksAwarded: number;
  maxMarks: number;
  status: RubricStatus;
  evidenceQuote: string | null;
  evidenceMatched: boolean;
  evidenceStart: number | null;
  evidenceEnd: number | null;
  feedback: string;
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

export interface GradingResult {
  id: string;
  submissionId: string;
  studentName: string;
  rollNumber: string;
  studentAnswerText: string;
  /** Public URL to the originally uploaded file (null if the answer was pasted text) — the grading pipeline only ever sees extracted text, so any diagram/image in an uploaded PDF is otherwise invisible; this lets a teacher open the real file directly. */
  originalFileUrl?: string | null;
  sourceType: 'pasted' | 'pdf' | 'docx';
  questionId: string;
  questionTitle: string;
  questionText: string;
  questionSubject: string;
  modelAnswerText?: string | null;
  totalMarks: number;
  maxMarks: number;
  confidence: number;
  needsHumanReview: boolean;
  reviewReason?: string;
  reviewedAt?: string | null;
  status: 'complete' | 'degraded' | 'failed';
  createdAt: string;
  pointResults: RubricPointResult[];
  annotations: Annotation[];
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
