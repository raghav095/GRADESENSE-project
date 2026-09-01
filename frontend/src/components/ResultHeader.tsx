import React, { useState } from 'react';
import { GradingResult } from '../types';
import { CheckCircle2 } from 'lucide-react';

interface ResultHeaderProps {
  result: GradingResult;
  onReviewed: () => void;
}

// Identity (title/student) is a plain heading. The verdict (score + status +
// reason) is ONE grouped banner, per the flow design's own rule: "status and
// reason, inline, together, always — never a badge without its explanation
// next to it." Action buttons (export, audit, reset) live in Stage3Result's
// footer instead of competing for space in this header.
export const ResultHeader: React.FC<ResultHeaderProps> = ({ result, onReviewed }) => {
  const [markingReviewed, setMarkingReviewed] = useState(false);

  const handleMarkReviewed = async () => {
    setMarkingReviewed(true);
    try {
      const res = await fetch(`/api/results/${result.id}/review`, { method: 'PATCH' });
      if (res.ok) onReviewed();
    } finally {
      setMarkingReviewed(false);
    }
  };

  const banner = result.needsHumanReview
    ? { color: 'var(--red-pen)', dot: 'status-dot-bad', label: 'Needs Review', detail: result.reviewReason || 'Verification check required' }
    : result.reviewedAt
    ? { color: 'var(--marks-good)', dot: 'status-dot-good', label: 'Reviewed by Teacher', detail: `${Math.round(result.confidence * 100)}% model confidence` }
    : result.status === 'degraded'
    ? { color: 'var(--marks-partial)', dot: 'status-dot-partial', label: 'Degraded Mode', detail: result.reviewReason || 'Executed via mock fallback' }
    : { color: 'var(--marks-good)', dot: 'status-dot-good', label: 'Evaluated', detail: `${Math.round(result.confidence * 100)}% confidence` };

  return (
    <div style={{ marginBottom: '1.5rem' }}>
      <h1 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.375rem', fontWeight: 600, color: 'var(--ink)' }}>{result.questionTitle}</h1>
      <div style={{ fontSize: '0.875rem', color: 'var(--ink-soft)', marginTop: '0.25rem', marginBottom: '1rem' }}>
        Student: <strong>{result.studentName}</strong> (Roll {result.rollNumber}) · Subject: <strong>{result.questionSubject}</strong>
      </div>

      <div
        style={{
          border: `1px solid ${banner.color}`,
          background: 'var(--paper)',
          padding: '1rem 1.25rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <div className="mono" style={{ fontSize: '1.75rem', fontWeight: 600, color: 'var(--ink)' }}>
            {result.totalMarks} / {result.maxMarks}
          </div>
          <div style={{ fontSize: '0.875rem' }}>
            <div style={{ color: banner.color, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className={`status-dot ${banner.dot}`} />
              {banner.label}
            </div>
            <div style={{ color: 'var(--ink-soft)', marginTop: 2 }}>{banner.detail}</div>
          </div>
        </div>

        {result.needsHumanReview && (
          <button
            className="btn btn-secondary"
            onClick={handleMarkReviewed}
            disabled={markingReviewed}
            title="Acknowledge this flag once you've checked the evidence and, if needed, corrected the annotation notes — this does not change any marks."
            style={{ flexShrink: 0, whiteSpace: 'nowrap' }}
          >
            <CheckCircle2 size={14} />
            {markingReviewed ? 'Marking...' : 'Mark as Reviewed'}
          </button>
        )}
      </div>
    </div>
  );
};
