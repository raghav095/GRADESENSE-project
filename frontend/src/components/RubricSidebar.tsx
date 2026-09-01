import React, { useState } from 'react';
import { GradingResult, RubricPointResult, Annotation } from '../types';
import { Edit3, Trash2, Plus, ChevronRight, ChevronDown } from 'lucide-react';

interface RubricSidebarProps {
  result: GradingResult;
  annotations: Annotation[];
  onUpdateAnnotations: (annotations: Annotation[]) => void;
  selectedRubricPointId: string | null;
  onSelectRubricPoint: (id: string | null) => void;
}

const STATUS_COLOR: Record<string, string> = {
  good: 'var(--marks-good)',
  partial: 'var(--marks-partial)',
  bad: 'var(--red-pen)',
};

function statusKey(status: string, marks: number, max: number): 'good' | 'partial' | 'bad' {
  if (status === 'correct' || marks === max) return 'good';
  if (status === 'partial' || marks > 0) return 'partial';
  return 'bad';
}

const labelStyle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: 'var(--ink-soft)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

// This is the SINGLE place a rubric point's evidence, feedback, and
// edit/delete controls live — the paper only answers "where," this answers
// "why, how much, and what to fix." A chevron marks each row as expandable
// (previously "click a row" was only explained in a footnote, not shown),
// and Evidence/Feedback are labeled separately instead of running together,
// with an explicit note when there's nothing editable — rather than the
// Edit/Delete buttons just silently not being there.
export const RubricSidebar: React.FC<RubricSidebarProps> = ({
  result,
  annotations,
  onUpdateAnnotations,
  selectedRubricPointId,
  onSelectRubricPoint,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState('');

  const manualAnnotations = annotations.filter(a => !a.linkedPointResultId);

  const handleStartEdit = (ann: { id: string; correctionText: string }) => {
    setEditingId(ann.id);
    setEditingText(ann.correctionText);
  };

  const handleSaveEdit = async (id: string) => {
    try {
      const res = await fetch(`/api/annotations/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correctionText: editingText }),
      });
      if (res.ok) {
        const updated = await res.json();
        onUpdateAnnotations(annotations.map(a => (a.id === id ? updated : a)));
      }
    } catch {
      // ignore
    } finally {
      setEditingId(null);
    }
  };

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/annotations/${id}`, { method: 'DELETE' });
      if (res.ok) onUpdateAnnotations(annotations.filter(a => a.id !== id));
    } catch {
      // ignore
    }
  };

  const handleAddManualNote = async () => {
    const res = await fetch('/api/annotations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        gradingResultId: result.id,
        page: 1,
        type: 'box',
        correctionText: 'Teacher note — click Edit to fill this in.',
      }),
    });
    if (res.ok) {
      const created: Annotation = await res.json();
      onUpdateAnnotations([...annotations, created]);
      handleStartEdit(created);
    }
  };

  const renderEditableRow = (id: string, text: string, onDelete?: (e: React.MouseEvent) => void) => (
    <div>
      {editingId === id ? (
        <div style={{ display: 'flex', gap: 4 }} onClick={e => e.stopPropagation()}>
          <input
            type="text"
            autoFocus
            value={editingText}
            onChange={e => setEditingText(e.target.value)}
            style={{ fontSize: '0.75rem', padding: '0.25rem 0.4rem', flex: 1, border: '1px solid var(--rule)' }}
          />
          <button onClick={() => handleSaveEdit(id)} style={{ fontSize: '0.7rem', padding: '0.2rem 0.5rem', background: 'var(--ink)', color: '#fff', border: 'none', cursor: 'pointer' }}>
            Save
          </button>
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.8125rem', color: 'var(--ink)', lineHeight: 1.5 }}>{text}</div>
          <div style={{ display: 'flex', gap: '0.4rem', marginTop: '0.4rem' }}>
            <button
              onClick={e => {
                e.stopPropagation();
                handleStartEdit({ id, correctionText: text });
              }}
              className="btn btn-secondary"
              style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem' }}
            >
              <Edit3 size={11} /> Edit
            </button>
            {onDelete && (
              <button onClick={onDelete} className="btn btn-secondary" style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', color: 'var(--red-pen)' }}>
                <Trash2 size={11} /> Delete
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );

  return (
    <div style={{ background: 'var(--paper-raised)', border: '1px solid var(--rule)', padding: '1.25rem' }}>
      <div
        style={{
          ...labelStyle,
          fontSize: '0.8125rem',
          marginBottom: '1rem',
          borderBottom: '1px solid var(--rule)',
          paddingBottom: '0.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>Rubric Criteria</span>
        <span className="mono" style={{ fontSize: '0.75rem' }}>
          Score: {result.totalMarks} / {result.maxMarks}
        </span>
      </div>

      <div>
        {result.pointResults.map((pr: RubricPointResult) => {
          const isSelected = pr.rubricPointId === selectedRubricPointId;
          const key = statusKey(pr.status, pr.marksAwarded, pr.maxMarks);
          const linkedAnn = annotations.find(a => a.linkedPointResultId === pr.id);
          const hasEvidence = Boolean(pr.evidenceQuote && pr.evidenceMatched);

          return (
            <div key={pr.id} style={{ borderBottom: '1px solid var(--rule)' }}>
              <div
                className="rubric-row"
                style={{
                  background: isSelected ? 'var(--paper)' : 'transparent',
                  padding: '0.625rem 0.5rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: '0.75rem',
                }}
                onClick={() => onSelectRubricPoint(isSelected ? null : pr.rubricPointId)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                  {isSelected ? <ChevronDown size={14} color="var(--ink-soft)" style={{ flexShrink: 0 }} /> : <ChevronRight size={14} color="var(--ink-soft)" style={{ flexShrink: 0 }} />}
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_COLOR[key], flexShrink: 0 }} />
                  <span style={{ fontSize: '0.9375rem', fontWeight: isSelected ? 600 : 500, color: 'var(--ink)' }}>{pr.criterion}</span>
                </div>
                <div className="mono" style={{ fontSize: '0.875rem', fontWeight: 600, color: STATUS_COLOR[key], flexShrink: 0 }}>
                  {pr.marksAwarded}/{pr.maxMarks}
                </div>
              </div>

              {isSelected && (
                <div style={{ padding: '0 0.5rem 1rem 1.75rem', borderLeft: `3px solid ${STATUS_COLOR[key]}`, marginLeft: '0.25rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {hasEvidence && (
                    <div>
                      <div style={labelStyle}>Evidence</div>
                      <blockquote
                        style={{
                          margin: '0.3rem 0 0',
                          padding: '0.4rem 0.6rem',
                          background: 'var(--paper)',
                          fontSize: '0.8125rem',
                          fontStyle: 'italic',
                          color: 'var(--ink-soft)',
                          borderLeft: '2px solid var(--rule)',
                        }}
                      >
                        "{pr.evidenceQuote}"
                      </blockquote>
                    </div>
                  )}

                  <div>
                    <div style={labelStyle}>Feedback</div>
                    <div style={{ marginTop: '0.3rem' }}>
                      {linkedAnn ? (
                        renderEditableRow(linkedAnn.id, linkedAnn.correctionText, e => handleDelete(e, linkedAnn.id))
                      ) : (
                        <>
                          <div style={{ fontSize: '0.8125rem', color: 'var(--ink)', lineHeight: 1.5 }}>{pr.feedback}</div>
                          <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', fontStyle: 'italic', marginTop: '0.3rem' }}>
                            {key === 'good' ? 'No note attached — this point was marked correct.' : 'No editable note attached (no locatable evidence to anchor one to).'}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--rule)', background: 'var(--paper)', margin: '1.25rem -1.25rem -1.25rem', padding: '1rem 1.25rem' }}>
        <div style={{ ...labelStyle, marginBottom: '0.25rem' }}>Teacher Notes</div>
        <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginBottom: '0.75rem' }}>
          Free-standing notes you add yourself — not tied to any rubric point or its marks. These appear on their own
          "Teacher Notes" page in the exported PDF, separate from the rubric breakdown.
        </div>

        {manualAnnotations.length > 0 && (
          <div style={{ marginBottom: '0.5rem' }}>
            {manualAnnotations.map(ann => (
              <div key={ann.id} style={{ padding: '0.6rem 0', borderBottom: '1px solid var(--rule)' }}>
                <div style={labelStyle}>Teacher Note</div>
                <div style={{ marginTop: '0.3rem' }}>{renderEditableRow(ann.id, ann.correctionText, e => handleDelete(e, ann.id))}</div>
              </div>
            ))}
          </div>
        )}

        {/* Kept as its own clearly separate block from the notes above —
            an action to add a new note, not a continuation of the last one. */}
        <div style={{ marginTop: manualAnnotations.length > 0 ? '0.75rem' : 0 }}>
          <button
            onClick={handleAddManualNote}
            className="btn btn-secondary"
            style={{ width: '100%', justifyContent: 'center', fontSize: '0.8125rem', padding: '0.5rem' }}
          >
            <Plus size={13} /> Add Manual Note
          </button>
        </div>
      </div>
    </div>
  );
};
