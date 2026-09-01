import React, { useEffect, useRef, useState } from 'react';
import { Question, GradingResult } from '../types';
import { Stage1Provide } from './Stage1Provide';
import { ProcessingStrip } from './ProcessingStrip';
import { Stage3Result } from './Stage3Result';
import { readJson } from '../utils/api';

interface GradeFlowProps {
  questions: Question[];
  /** Set by History when a row is clicked — jumps straight to the Result block for that saved result. */
  openResultId: string | null;
  onResultOpened: () => void;
  onResultSaved: () => void;
  onQuestionCreated: () => void;
}

type Phase = 'form' | 'grading' | 'done';

/**
 * The whole grading journey as ONE always-mounted page, not a routed wizard.
 * `phase` only ever controls what's appended below the form in the same
 * scroll — it is never a page-level transition, so there's no state that can
 * exist independently of whether a result actually does (the exact failure
 * shape that made the old "Active Sheet" nav tab go stale).
 *
 * A result opened from History is a genuinely different situation — it's a
 * saved paper being reviewed, not a paper mid-flow — so it renders ONLY the
 * result block, with no ghost form or processing strip above it.
 */
export const GradeFlow: React.FC<GradeFlowProps> = ({ questions, openResultId, onResultOpened, onResultSaved, onQuestionCreated }) => {
  const [phase, setPhase] = useState<Phase>('form');
  const [gradingStart, setGradingStart] = useState<(() => Promise<GradingResult>) | null>(null);
  const [result, setResult] = useState<GradingResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewingFromHistory, setViewingFromHistory] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!openResultId) return;
    fetch(`/api/results/${openResultId}`)
      .then(res => readJson(res))
      .then((data: GradingResult) => {
        setResult(data);
        setViewingFromHistory(true);
        setPhase('done');
      })
      .finally(() => onResultOpened());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openResultId]);

  useEffect(() => {
    if (phase === 'done' && !viewingFromHistory) {
      resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, result]);

  const handleGradingStarted = (start: () => Promise<GradingResult>) => {
    setError(null);
    setGradingStart(() => start);
    setPhase('grading');
  };

  const handleComplete = (r: GradingResult) => {
    setResult(r);
    setPhase('done');
    onResultSaved();
  };

  const handleError = (message: string) => {
    setError(message);
    setGradingStart(null);
    setPhase('form');
  };

  const resetToForm = () => {
    setResult(null);
    setGradingStart(null);
    setError(null);
    setViewingFromHistory(false);
    setPhase('form');
  };

  if (viewingFromHistory && result) {
    return <Stage3Result result={result} onGradeAnother={resetToForm} onReviewed={onResultSaved} />;
  }

  return (
    <div>
      {phase !== 'done' && (
        <Stage1Provide
          questions={questions}
          onGradingStarted={handleGradingStarted}
          error={error}
          disabled={phase === 'grading'}
          onQuestionCreated={onQuestionCreated}
        />
      )}

      {phase === 'grading' && gradingStart && (
        <div style={{ maxWidth: 820, margin: '0 auto' }}>
          <ProcessingStripBridge start={gradingStart} onComplete={handleComplete} onError={handleError} />
        </div>
      )}

      {phase === 'done' && result && (
        // No separate "here's what you submitted" bar here — Stage3Result's
        // own ResultHeader already leads with question/student/roll, so a
        // second copy of the same three facts directly above it was pure
        // duplication, not a helpful reminder.
        <div ref={resultRef}>
          <Stage3Result result={result} onGradeAnother={resetToForm} onReviewed={onResultSaved} />
        </div>
      )}
    </div>
  );
};

// Invokes the not-yet-started grading request exactly once when this mounts.
//
// This MUST run inside useEffect with a ref guard, not a useState lazy
// initializer (`useState(() => start())`). React 18 StrictMode intentionally
// double-invokes state initializer functions in development to surface
// impure ones — and `start` isn't pure, it fires two real network requests
// (POST /submissions, POST /grade). The lazy-initializer version graded every
// paper twice: two submissions, two grading results, two duplicate rows in
// History, and — if you're on the live Gemini grader — double the real API
// calls and cost, every single time, silently. A ref guard inside an effect
// survives StrictMode's mount->cleanup->remount simulation, so the side
// effect only actually fires once.
const ProcessingStripBridge: React.FC<{
  start: () => Promise<GradingResult>;
  onComplete: (result: GradingResult) => void;
  onError: (message: string) => void;
}> = ({ start, onComplete, onError }) => {
  const [promise, setPromise] = useState<Promise<GradingResult> | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    setPromise(start());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!promise) return null;
  return <ProcessingStrip gradingPromise={promise} onComplete={onComplete} onError={onError} />;
};
