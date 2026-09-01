import { z } from 'zod';

// Runtime contract for whatever a grader (Gemini or Mock) returns. Any raw
// LLM response — valid JSON or not — is validated against this before the
// pipeline trusts a single field of it. This is the schema-validation step
// described in the architecture doc that previously didn't exist: without
// it, a structurally-valid-but-garbage response (wrong enum value, string
// where a number belongs) would have flowed straight into the database.
export const RawLlmPointResultSchema = z.object({
  rubricPointId: z.string().min(1),
  status: z.enum(['correct', 'partial', 'missing', 'incorrect']),
  marksAwarded: z.number(),
  evidenceQuote: z.string().nullable(),
  feedback: z.string().min(1),
});

export const RawLlmGradingOutputSchema = z.object({
  pointResults: z.array(RawLlmPointResultSchema).min(1),
  generalFeedback: z.string().optional(),
});

export type ValidatedLlmGradingOutput = z.infer<typeof RawLlmGradingOutputSchema>;
