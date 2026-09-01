import React, { useState } from 'react';
import { GradingResult, RubricPointResult } from '../types';
import { ExternalLink } from 'lucide-react';

interface PdfViewerCanvasProps {
  result: GradingResult;
  selectedRubricPointId: string | null;
  onSelectRubricPoint: (rubricPointId: string | null) => void;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// This pane answers exactly one question: WHERE in the student's answer a
// mistake is. WHY it's wrong, how many marks it cost, and the editable
// correction note all live in RubricSidebar — one authoritative place,
// instead of being repeated here too.
type PaperTab = 'student' | 'model';

export const PdfViewerCanvas: React.FC<PdfViewerCanvasProps> = ({ result, selectedRubricPointId, onSelectRubricPoint }) => {
  const [tab, setTab] = useState<PaperTab>('student');
  const studentText = result.studentAnswerText || '';
  const studentName = result.studentName || 'Student';
  const rollNumber = result.rollNumber || '00';
  const hasModelAnswer = Boolean(result.modelAnswerText?.trim());

  // Student-supplied text is untrusted input rendered via dangerouslySetInnerHTML,
  // so every raw segment is HTML-escaped — only our own <mark> wrapper is unescaped markup.
  const renderAnnotatedText = () => {
    if (!studentText) {
      return (
        <div style={{ color: 'var(--ink-soft)', fontStyle: 'italic', padding: '1rem 0' }}>
          (No student answer text available)
        </div>
      );
    }

    // Points with a matched evidence quote and real character offsets, that
    // aren't a clean full-marks "correct" — these are the ones we can locate
    // and highlight (an unmatched quote gets no on-screen mark, same rule as annotations).
    const activePoints = result.pointResults
      .filter(
        pr =>
          pr.evidenceMatched &&
          pr.evidenceStart !== null &&
          pr.evidenceEnd !== null &&
          (pr.status !== 'correct' || pr.marksAwarded < pr.maxMarks)
      )
      .sort((a, b) => (a.evidenceStart as number) - (b.evidenceStart as number));

    if (activePoints.length === 0) {
      return <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8 }}>{studentText}</div>;
    }

    // Drop any range that overlaps one already placed, so two flagged spans
    // can never produce malformed nested <mark> tags.
    const ranges: { start: number; end: number; pr: RubricPointResult }[] = [];
    let lastEnd = -1;
    for (const pr of activePoints) {
      const start = pr.evidenceStart as number;
      const end = pr.evidenceEnd as number;
      if (start >= lastEnd) {
        ranges.push({ start, end, pr });
        lastEnd = end;
      }
    }

    let html = '';
    let cursor = 0;
    ranges.forEach(({ start, end, pr }) => {
      html += escapeHtml(studentText.slice(cursor, start));
      const isSelected = pr.rubricPointId === selectedRubricPointId;
      const highlightStyle = isSelected
        ? 'background: rgba(178, 58, 46, 0.18); border-bottom: 2.5px solid var(--red-pen); font-weight: 600;'
        : 'border-bottom: 2.5px dashed var(--red-pen); background: rgba(178, 58, 46, 0.08);';
      html += `<mark class="red-annotation-mark" data-point-id="${pr.rubricPointId}" style="${highlightStyle} color: var(--ink); padding: 0.1em 0.2em;">${escapeHtml(
        studentText.slice(start, end)
      )}</mark>`;
      cursor = end;
    });
    html += escapeHtml(studentText.slice(cursor));

    return (
      <div
        style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: '0.9375rem', color: 'var(--ink)' }}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={e => {
          const target = (e.target as HTMLElement).closest('.red-annotation-mark');
          if (target) {
            const pointId = target.getAttribute('data-point-id');
            onSelectRubricPoint(pointId === selectedRubricPointId ? null : pointId);
          }
        }}
      />
    );
  };

  return (
    <div className="pdf-container">
      <div style={{ width: '100%', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: '1.25rem' }}>
          <button
            onClick={() => setTab('student')}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: 'pointer',
              fontSize: '0.8125rem',
              fontWeight: tab === 'student' ? 700 : 500,
              color: tab === 'student' ? 'var(--ink)' : 'var(--ink-soft)',
              borderBottom: tab === 'student' ? '2px solid var(--ink)' : '2px solid transparent',
              paddingBottom: '0.25rem',
            }}
          >
            Student's Answer
          </button>
          {hasModelAnswer && (
            <button
              onClick={() => setTab('model')}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontSize: '0.8125rem',
                fontWeight: tab === 'model' ? 700 : 500,
                color: tab === 'model' ? 'var(--ink)' : 'var(--ink-soft)',
                borderBottom: tab === 'model' ? '2px solid var(--marks-good)' : '2px solid transparent',
                paddingBottom: '0.25rem',
              }}
            >
              Model Answer
            </button>
          )}
        </div>

        {result.originalFileUrl && (
          <a
            href={result.originalFileUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 4 }}
            title="Opens the original uploaded file exactly as submitted — including any diagrams or images, which the text-based grading pipeline doesn't see."
          >
            <ExternalLink size={12} /> View Original Uploaded File
          </a>
        )}
      </div>

      {tab === 'student' ? (
        <div className="pdf-paper-sheet">
          <div style={{ borderBottom: '1px solid var(--rule)', paddingBottom: '0.75rem', marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', fontWeight: 600 }}>GradeSense Answer Paper</div>
              <div style={{ fontSize: '0.875rem', color: 'var(--ink-soft)', marginTop: '0.125rem' }}>
                Student: <strong>{studentName}</strong> · Roll: <strong>{rollNumber}</strong>
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--ink-soft)' }}>
              <div>
                Subject: <strong>{result.questionSubject || 'General'}</strong>
              </div>
              <div>Date: {new Date(result.createdAt || Date.now()).toLocaleDateString()}</div>
            </div>
          </div>

          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: '1rem', marginBottom: '0.875rem', color: 'var(--ink)' }}>{result.questionTitle}</div>

          {renderAnnotatedText()}
        </div>
      ) : (
        <div className="pdf-paper-sheet" style={{ borderLeft: '3px solid var(--marks-good)' }}>
          <div style={{ borderBottom: '1px solid var(--rule)', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', fontWeight: 600 }}>Model Answer — Reference</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--marks-good)', marginTop: '0.25rem', fontWeight: 600 }}>
              Not graded — provided as the marking-scheme reference for this question.
            </div>
          </div>
          <div style={{ fontFamily: 'var(--font-serif)', fontWeight: 600, fontSize: '1rem', marginBottom: '0.875rem', color: 'var(--ink)' }}>{result.questionTitle}</div>
          <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.8, fontSize: '0.9375rem', color: 'var(--ink)' }}>{result.modelAnswerText}</div>
        </div>
      )}
    </div>
  );
};
