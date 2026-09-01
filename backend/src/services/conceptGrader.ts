import { RubricStatus } from './types.js';

/**
 * A deterministic, non-LLM grader used by MockGrader as its fallback for any
 * answer that isn't one of the specific known demo fixtures. Explicitly NOT
 * trying to be as good as a real LLM — it can't judge reasoning quality, only
 * concept presence — but it actually looks at the submitted text, which the
 * fixed per-question-ID branches it replaces did not: those returned the
 * exact same score for ANY submission to a given question, entirely
 * independent of what that submission actually said. A grader whose own
 * "extra test cases" (per the brief) don't happen to match a hardcoded demo
 * answer word-for-word deserves a real, content-driven result, not someone
 * else's canned grade.
 */

interface ConceptConfig {
  /** Each inner array is one "concept group" — the group counts as present if ANY of its terms appears in the answer. */
  concepts: string[][];
  /** A regex match forces status:'incorrect', 0 marks — for the specific "correct keywords, reversed reasoning" traps this app's own tests are built around. */
  traps?: { pattern: RegExp; feedback: string }[];
}

const CONCEPT_CONFIG: Record<string, ConceptConfig> = {
  'q1-rp1': { concepts: [['battery'], ['switch'], ['bulb', 'lamp'], ['resistor'], ['series']] },
  'q1-rp2': {
    concepts: [['ammeter'], ['series'], ['voltmeter'], ['parallel']],
    traps: [
      {
        pattern: /voltmeter[^.]{0,40}\bseries\b/i,
        feedback: 'Wiring error: the answer places the voltmeter in series rather than in parallel across the component being measured.',
      },
    ],
  },
  'q1-rp3': { concepts: [['closed', 'complete', 'loop'], ['current', 'charge'], ['flow', 'flowing', 'flows']] },
  'q1-rp4': {
    concepts: [['resistance', 'ohm'], ['current', 'charge']],
    traps: [
      {
        pattern: /(increas|more|higher)[^.]{0,40}resistance[^.]{0,40}(increas|more|higher)[^.]{0,20}current/i,
        feedback: "Reversed Ohm's law relationship: at constant voltage, increasing resistance decreases current, not increases it.",
      },
    ],
  },
  'q1-rp5': { concepts: [['label', 'labeled', 'labelled'], ['diagram'], ['direction']] },

  'q2-rp1': { concepts: [['technology'], ['learn', 'learning', 'learner']] },
  'q2-rp2': { concepts: [['example', 'instance', 'such as', 'e.g']] },
  'q2-rp3': { concepts: [['however', 'but', 'although', 'opposing', 'dependent', 'dependency', 'risk']] },
  'q2-rp4': { concepts: [['because', 'therefore', 'reason', 'since']] },
  'q2-rp5': { concepts: [['conclusion', 'overall', 'in summary', 'in conclusion']] },

  'q3-rp1': { concepts: [['demand'], ['supply'], ['downward', 'decreas', 'go down'], ['upward', 'increas', 'go up']] },
  'q3-rp2': { concepts: [['equilibrium'], ['30'], ['60']] },
  'q3-rp3': { concepts: [['shortage'], ['surplus']] },
  'q3-rp4': {
    concepts: [['cost'], ['supply'], ['shift']],
    traps: [
      {
        pattern: /cost[^.]{0,50}increas[^.]{0,60}(supply|curve)[^.]{0,30}(right|increas)/i,
        feedback: 'Reversed logic: an increase in production cost shifts the supply curve left/upward (less is supplied at each price), not right.',
      },
    ],
  },
  'q3-rp5': {
    concepts: [['equilibrium', 'price'], ['quantity']],
    traps: [
      {
        pattern: /lower[^.]{0,20}price[^.]{0,40}(higher|more|greater)[^.]{0,20}quantity/i,
        feedback: 'Incorrect conclusion: after a leftward supply shift, the new equilibrium should show a HIGHER price and LOWER quantity, not the reverse.',
      },
    ],
  },
};

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'are', 'has', 'have', 'will', 'would', 'could', 'should',
  'their', 'they', 'them', 'which', 'when', 'where', 'what', 'how', 'why', 'into', 'onto', 'than', 'then',
  'these', 'those', 'because', 'while', 'also', 'such', 'more', 'some', 'each', 'both', 'either', 'about',
]);

function extractSignificantWords(text: string): string[] {
  return Array.from(
    new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(w => w.length >= 4 && !STOPWORDS.has(w))
    )
  ).slice(0, 8);
}

export interface ConceptGradeResult {
  rubricPointId: string;
  status: RubricStatus;
  marksAwarded: number;
  evidenceQuote: string | null;
  feedback: string;
}

export function conceptGrade(rubricPointId: string, criterion: string, maxMarks: number, studentText: string): ConceptGradeResult {
  const config: ConceptConfig = CONCEPT_CONFIG[rubricPointId] || { concepts: extractSignificantWords(criterion).map(w => [w]) };
  const sentences = studentText
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(Boolean);

  if (config.traps) {
    for (const trap of config.traps) {
      const match = sentences.find(s => trap.pattern.test(s));
      if (match) {
        return { rubricPointId, status: 'incorrect', marksAwarded: 0, evidenceQuote: match, feedback: trap.feedback };
      }
    }
  }

  const lowerText = studentText.toLowerCase();
  const hitGroups = config.concepts.filter(group => group.some(term => lowerText.includes(term.toLowerCase())));
  const coverage = config.concepts.length > 0 ? hitGroups.length / config.concepts.length : 0;

  const scoreSentence = (s: string) => {
    const lower = s.toLowerCase();
    return config.concepts.reduce((acc, group) => acc + (group.some(term => lower.includes(term.toLowerCase())) ? 1 : 0), 0);
  };
  let bestSentence: string | null = null;
  let bestScore = 0;
  for (const s of sentences) {
    const score = scoreSentence(s);
    if (score > bestScore) {
      bestScore = score;
      bestSentence = s;
    }
  }

  if (coverage === 0 || !bestSentence) {
    return { rubricPointId, status: 'missing', marksAwarded: 0, evidenceQuote: null, feedback: `The answer does not appear to address this criterion: ${criterion}` };
  }
  if (coverage >= 0.7) {
    return { rubricPointId, status: 'correct', marksAwarded: maxMarks, evidenceQuote: bestSentence, feedback: `The answer addresses this criterion: ${criterion}` };
  }
  return {
    rubricPointId,
    status: 'partial',
    marksAwarded: Number((maxMarks * 0.5).toFixed(2)),
    evidenceQuote: bestSentence,
    feedback: `The answer partially addresses this criterion but is incomplete: ${criterion}`,
  };
}
