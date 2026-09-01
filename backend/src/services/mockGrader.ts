import { Grader, Question, RubricPoint, RawLlmGradingOutput, LlmCallLog, RubricStatus } from './types.js';
import { fuzzyMatchQuote } from './textMatch.js';
import { conceptGrade } from './conceptGrader.js';

export class MockGrader implements Grader {
  private simulateError: 'none' | 'api_failure' | 'malformed' | 'over_max' = 'none';

  constructor(options?: { simulateError?: 'none' | 'api_failure' | 'malformed' | 'over_max' }) {
    if (options?.simulateError) {
      this.simulateError = options.simulateError;
    }
  }

  async grade(question: Question, rubric: RubricPoint[], answerText: string): Promise<{
    rawOutput: RawLlmGradingOutput;
    log: Omit<LlmCallLog, 'id' | 'gradingResultId' | 'createdAt'>;
  }> {
    const startTime = Date.now();

    if (this.simulateError === 'api_failure') {
      throw new Error('Mock LLM API Call Failed: 503 Service Unavailable');
    }

    if (this.simulateError === 'malformed') {
      return {
        rawOutput: {
          invalid_key: true,
          pointResults: [],
        } as any,
        log: {
          pass: 'grading',
          rawRequest: JSON.stringify({ questionId: question.id, answerText }),
          rawResponse: 'INVALID_JSON_OR_MALFORMED',
          model: 'mock-gemini-2.5-flash',
          latencyMs: Date.now() - startTime,
          error: 'Malformed output structure',
        },
      };
    }

    const trimmed = answerText.trim();
    const pointResults: RawLlmGradingOutput['pointResults'] = [];

    // Over-max score testing mode
    if (this.simulateError === 'over_max') {
      rubric.forEach(r => {
        pointResults.push({
          rubricPointId: r.id,
          status: 'correct',
          marksAwarded: r.maxMarks + 5,
          evidenceQuote: trimmed.slice(0, 30) || 'Sample text',
          feedback: 'Model hallucinated extra marks above limit',
        });
      });

      return {
        rawOutput: { pointResults },
        log: {
          pass: 'grading',
          rawRequest: JSON.stringify({ questionId: question.id, answerText }),
          rawResponse: JSON.stringify({ pointResults }),
          model: 'mock-gemini-2.5-flash',
          latencyMs: Date.now() - startTime,
        },
      };
    }

    // Blank or whitespace-only
    if (!trimmed) {
      rubric.forEach(r => {
        pointResults.push({
          rubricPointId: r.id,
          status: 'missing',
          marksAwarded: 0,
          evidenceQuote: null,
          feedback: 'No response provided by student.',
        });
      });

      return {
        rawOutput: { pointResults },
        log: {
          pass: 'grading',
          rawRequest: JSON.stringify({ questionId: question.id, answerText }),
          rawResponse: JSON.stringify({ pointResults }),
          model: 'mock-gemini-2.5-flash',
          latencyMs: Date.now() - startTime,
        },
      };
    }

    // Fully correct answer fixture
    if (trimmed.includes('EXEMPLAR_FULL_CREDIT') || trimmed.includes('voltmeter in parallel, V=IR explained')) {
      rubric.forEach(r => {
        pointResults.push({
          rubricPointId: r.id,
          status: 'correct',
          marksAwarded: r.maxMarks,
          evidenceQuote: trimmed.slice(0, 40),
          feedback: 'Completely accurate and thoroughly explained.',
        });
      });
      return {
        rawOutput: { pointResults },
        log: {
          pass: 'grading',
          rawRequest: JSON.stringify({ questionId: question.id, answerText }),
          rawResponse: JSON.stringify({ pointResults }),
          model: 'mock-gemini-2.5-flash',
          latencyMs: Date.now() - startTime,
        },
      };
    }

    // Entirely incorrect answer fixture
    if (trimmed.includes('UNPREPARED_INCORRECT_ANSWER') || trimmed.includes('painted yellow')) {
      rubric.forEach(r => {
        pointResults.push({
          rubricPointId: r.id,
          status: 'incorrect',
          marksAwarded: 0,
          evidenceQuote: trimmed.slice(0, 40),
          feedback: 'Factually incorrect reasoning provided.',
        });
      });
      return {
        rawOutput: { pointResults },
        log: {
          pass: 'grading',
          rawRequest: JSON.stringify({ questionId: question.id, answerText }),
          rawResponse: JSON.stringify({ pointResults }),
          model: 'mock-gemini-2.5-flash',
          latencyMs: Date.now() - startTime,
        },
      };
    }

    // Adversarial English (Opposing conclusion, excellent reasoning)
    if (question.id === 'q2-english' && (trimmed.includes('DEPENDENT_LEARNERS_ADVERSARIAL') || trimmed.includes('creates cognitive dependency rather than genuine comprehension'))) {
      rubric.forEach(r => {
        if (r.id === 'q2-rp1') {
          pointResults.push({
            rubricPointId: r.id,
            status: 'correct',
            marksAwarded: r.maxMarks,
            evidenceQuote: 'easy access creates cognitive dependency rather than genuine comprehension',
            feedback: 'States a clear, unambiguous position on cognitive dependency.',
          });
        } else if (r.id === 'q2-rp2') {
          pointResults.push({
            rubricPointId: r.id,
            status: 'correct',
            marksAwarded: r.maxMarks,
            evidenceQuote: 'copying code solutions or math answers online may finish their homework faster',
            feedback: 'Provides concrete, well-structured examples supporting the claim.',
          });
        } else if (r.id === 'q2-rp3') {
          pointResults.push({
            rubricPointId: r.id,
            status: 'correct',
            marksAwarded: r.maxMarks,
            evidenceQuote: 'While proponents argue that digital tools enable self-paced exploration',
            feedback: 'Meaningfully considers and rebuts the opposing self-paced learning viewpoint.',
          });
        } else if (r.id === 'q2-rp4') {
          pointResults.push({
            rubricPointId: r.id,
            status: 'correct',
            marksAwarded: r.maxMarks,
            evidenceQuote: 'without disciplined reflection, easy answers discourage intellectual perseverance',
            feedback: 'Demonstrates deep analytical reasoning rather than template reliance.',
          });
        } else if (r.id === 'q2-rp5') {
          pointResults.push({
            rubricPointId: r.id,
            status: 'correct',
            marksAwarded: r.maxMarks,
            evidenceQuote: 'technology must be integrated as a secondary aid rather than a primary crutch for learning',
            feedback: 'Synthesizes arguments into a coherent, logical conclusion.',
          });
        }
      });
      return {
        rawOutput: { pointResults },
        log: {
          pass: 'grading',
          rawRequest: JSON.stringify({ questionId: question.id, answerText }),
          rawResponse: JSON.stringify({ pointResults }),
          model: 'mock-gemini-2.5-flash',
          latencyMs: Date.now() - startTime,
        },
      };
    }

    // Adversarial Science (Unique vocabulary, correct physics)
    if (question.id === 'q1-science' && (trimmed.includes('UNIQUE_VOCABULARY_PHYSICS') || trimmed.includes('higher opposition to charge flow'))) {
      rubric.forEach(r => {
        pointResults.push({
          rubricPointId: r.id,
          status: 'correct',
          marksAwarded: r.maxMarks,
          evidenceQuote: 'higher opposition to charge flow restricts rate of charge transport',
          feedback: 'Conceptually sound physical explanation despite non-standard terminology.',
        });
      });
      return {
        rawOutput: { pointResults },
        log: {
          pass: 'grading',
          rawRequest: JSON.stringify({ questionId: question.id, answerText }),
          rawResponse: JSON.stringify({ pointResults }),
          model: 'mock-gemini-2.5-flash',
          latencyMs: Date.now() - startTime,
        },
      };
    }

    // Known demo fixtures (Ananya/Q1, default-Q2, Priya/Q3) — these are curated,
    // deterministic responses for this project's OWN sample answers, used for
    // a fast, zero-cost, reproducible demo. Each one is only trusted for a
    // given rubric point if that point's specific evidence quote is actually
    // present in the submitted text (checked below, the same way the real
    // pipeline verifies evidence). This used to key purely off `question.id`,
    // which meant ANY submission to these 3 seeded questions — including a
    // reviewer's own different test answer — silently got graded as if it
    // were this exact fixture, regardless of what it actually said. Anything
    // that doesn't match a fixture's real evidence falls through to
    // conceptGrade, a simple but genuinely content-driven fallback.
    const FIXTURES: Record<string, Record<string, { status: RubricStatus; marksAwarded: number; evidenceQuote: string; feedback: string }>> = {
      'q1-science': {
        'q1-rp1': { status: 'correct', marksAwarded: 1.0, evidenceQuote: 'battery, switch, resistor, bulb and ammeter is connected in series', feedback: 'Main circuit components are correctly identified as connected in series.' },
        'q1-rp2': { status: 'incorrect', marksAwarded: 0.0, evidenceQuote: 'Voltmeter is also connected in the circuit to measure the potential diffrence', feedback: 'Wiring error: Voltmeter is drawn in series with the loop instead of connected in parallel across the load.' },
        'q1-rp3': { status: 'partial', marksAwarded: 0.5, evidenceQuote: 'some of the current get used up by the bulb and resistor', feedback: 'Misconception: Current is conserved in a closed loop and is not "used up"; electrical energy is converted.' },
        'q1-rp4': { status: 'incorrect', marksAwarded: 0.0, evidenceQuote: 'if we increase the resistance then the current flowing in the circuit will also increase', feedback: 'Reversed Ohm’s law relationship: At constant voltage, increasing resistance decreases current flow.' },
        'q1-rp5': { status: 'partial', marksAwarded: 0.5, evidenceQuote: 'Ammeter is connected in series because it measure the current flowing in circuit.', feedback: 'Labels are mostly present, but conventional current direction (positive to negative) is missing.' },
      },
      'q2-english': {
        'q2-rp1': { status: 'correct', marksAwarded: 1.0, evidenceQuote: 'I think technology make learning better because student can learn at there own pace', feedback: 'Clear initial position stated on technology enhancing learning.' },
        'q2-rp2': { status: 'partial', marksAwarded: 0.5, evidenceQuote: 'For example a student can watch video on youtube to understand hard topic.', feedback: 'Example is generic and briefly stated without deep elaboration.' },
        'q2-rp3': { status: 'partial', marksAwarded: 0.5, evidenceQuote: 'sometime student became too dependent on technology and they dont try to think on their own', feedback: 'Opposing viewpoint is mentioned in a single line but lacks substantive analysis or rebuttal.' },
        'q2-rp4': { status: 'partial', marksAwarded: 0.5, evidenceQuote: 'Now students can find information easily on internet', feedback: 'Reasoning relies heavily on surface claims rather than deep argument structure.' },
        'q2-rp5': { status: 'partial', marksAwarded: 0.5, evidenceQuote: 'In conclusion technology is good for learning but student should use it correctly.', feedback: 'Conclusion is generic and does not synthesize the opposing points raised.' },
      },
      'q3-economics': {
        'q3-rp1': { status: 'correct', marksAwarded: 1.0, evidenceQuote: 'Demand curve go downward because when price increase people buy less, and supply curve go upward', feedback: 'Curves and axes are correctly described and plotted.' },
        'q3-rp2': { status: 'correct', marksAwarded: 1.0, evidenceQuote: 'equilibrium price is 30 and quantity is 60 because demand equal supply', feedback: 'Equilibrium price (₹30) and quantity (60 units) correctly identified.' },
        'q3-rp3': { status: 'partial', marksAwarded: 0.5, evidenceQuote: 'If price is above equilibrium also something will happen in the market', feedback: 'Shortage explained well, but surplus dynamics at prices above equilibrium are vague.' },
        'q3-rp4': { status: 'incorrect', marksAwarded: 0.0, evidenceQuote: 'if cost of production increase, producer will charge more price so supply curve will shift to right', feedback: 'Reversed logic: Higher cost of production reduces profitability, shifting the supply curve leftward (upward).' },
        'q3-rp5': { status: 'incorrect', marksAwarded: 0.0, evidenceQuote: 'new equilibrium will have lower price and higher quantity', feedback: 'Incorrect conclusion resulting from backwards supply shift logic.' },
      },
    };

    const fixturesForQuestion = FIXTURES[question.id];
    rubric.forEach(r => {
      const fixture = fixturesForQuestion?.[r.id];
      if (fixture && fuzzyMatchQuote(fixture.evidenceQuote, trimmed).matched) {
        pointResults.push({ rubricPointId: r.id, ...fixture });
      } else {
        pointResults.push(conceptGrade(r.id, r.criterion, r.maxMarks, trimmed));
      }
    });

    return {
      rawOutput: { pointResults },
      log: {
        pass: 'grading',
        rawRequest: JSON.stringify({ questionId: question.id, answerText }),
        rawResponse: JSON.stringify({ pointResults }),
        model: 'mock-gemini-2.5-flash',
        latencyMs: Date.now() - startTime,
      },
    };
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
    const startTime = Date.now();
    const lowerQuote = (evidenceQuote || '').toLowerCase();

    let agrees = true;
    let reasoning = 'Evidence quote supports claimed rubric status.';

    if (claimedStatus === 'correct') {
      if (lowerQuote.includes('used up') || lowerQuote.includes('increase resistance') || lowerQuote.includes('shift to right')) {
        agrees = false;
        reasoning = `Verification Audit Disagreed: Quote contains physical/economic error ('${evidenceQuote.slice(0, 40)}...') contradicting full credit status.`;
      }
    } else if (claimedStatus === 'incorrect' || claimedStatus === 'partial') {
      if (lowerQuote.includes('used up') || lowerQuote.includes('voltmeter') || lowerQuote.includes('increase resistance') || lowerQuote.includes('shift to right')) {
        agrees = true;
        reasoning = `Verification Audit Confirmed: Quote exhibits student error corresponding to '${claimedStatus}' status.`;
      } else if (lowerQuote.length < 5) {
        agrees = false;
        reasoning = 'Verification Audit Disagreed: Quote is missing or insufficient to justify point status.';
      }
    }

    return {
      agrees,
      reasoning,
      log: {
        pass: 'verification',
        rawRequest: JSON.stringify({ rubricPointId: rubricPoint.id, evidenceQuote, claimedStatus }),
        rawResponse: JSON.stringify({ agrees, reasoning }),
        model: 'mock-gemini-2.5-flash-verify',
        latencyMs: Date.now() - startTime,
      },
    };
  }
}
