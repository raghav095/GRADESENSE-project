import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { GradingResult } from '../types';

interface ProcessingStripProps {
  gradingPromise: Promise<GradingResult>;
  onComplete: (result: GradingResult) => void;
  onError: (message: string) => void;
}

const STEPS = [
  { label: 'Reading the answer paper...', afterMs: 0 },
  { label: 'Checking each rubric point...', afterMs: 300 },
  { label: 'Verifying evidence...', afterMs: 1100 },
];

// Transient feedback appended under the (now locked) form while the one real
// grading request is in flight — not a numbered step with false parity to
// "Select & Provide" or "Result". It shows the real pipeline stages
// (short-circuit -> grading pass -> verification pass, gradingPipeline.ts)
// as they complete; the backend doesn't stream incremental progress today,
// so steps 2-3 reveal on a short timer capped by whichever finishes first,
// the timer or the actual response.
export const ProcessingStrip: React.FC<ProcessingStripProps> = ({ gradingPromise, onComplete, onError }) => {
  const [visibleSteps, setVisibleSteps] = useState(1);
  const [settled, setSettled] = useState(false);
  const handledRef = useRef(false);

  useEffect(() => {
    const timers = STEPS.map((step, i) =>
      i === 0 ? null : setTimeout(() => setVisibleSteps(v => Math.max(v, i + 1)), step.afterMs)
    );

    gradingPromise
      .then(result => {
        setSettled(true);
        setVisibleSteps(STEPS.length);
        setTimeout(() => {
          if (!handledRef.current) {
            handledRef.current = true;
            onComplete(result);
          }
        }, 350);
      })
      .catch((err: any) => {
        if (!handledRef.current) {
          handledRef.current = true;
          onError(err?.message || 'An unexpected error occurred during grading.');
        }
      });

    return () => timers.forEach(t => t && clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card" style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {STEPS.map((step, i) => {
        const isDone = i < visibleSteps - 1 || (settled && i === STEPS.length - 1);
        const isActive = i === visibleSteps - 1 && !isDone;
        const isShown = i < visibleSteps;

        return (
          <div
            key={step.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              fontSize: '0.9375rem',
              color: isShown ? 'var(--ink)' : 'var(--ink-soft)',
              opacity: isShown ? 1 : 0.35,
              transition: 'opacity 0.2s',
            }}
          >
            <span style={{ width: 18, display: 'inline-flex', justifyContent: 'center' }}>
              {isDone ? <Check size={16} color="var(--marks-good)" /> : isActive ? <Loader2 size={16} className="spin" /> : null}
            </span>
            {step.label}
          </div>
        );
      })}
    </div>
  );
};
