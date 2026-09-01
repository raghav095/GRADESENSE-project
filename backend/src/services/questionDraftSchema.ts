import { z } from 'zod';

// The runtime contract for an AI-drafted question — validated the same way
// a grading response is (Zod, never trusted blind). Critically, a draft is
// NEVER saved or used to grade anything on its own: it only pre-fills the
// Add Question form for a human to review, edit, and explicitly submit via
// the same POST /api/questions path (and its own validation) as a fully
// manually-typed question. If drafting fails or the model isn't configured,
// the form stays exactly as usable as it was before this feature existed.
export const DraftedRubricPointSchema = z.object({
  criterion: z.string().min(5),
  maxMarks: z.number().min(0.5).max(10),
});

export const QuestionDraftSchema = z.object({
  suggestedTitle: z.string().min(3).optional(),
  suggestedSubject: z.string().min(2).optional(),
  modelAnswerText: z.string().min(20),
  rubricPoints: z.array(DraftedRubricPointSchema).min(2).max(8),
});

export type QuestionDraft = z.infer<typeof QuestionDraftSchema>;
