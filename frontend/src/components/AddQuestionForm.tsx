import React, { useEffect, useState } from 'react';
import { Plus, Trash2, X, Sparkles, Upload } from 'lucide-react';
import { readJson } from '../utils/api';

interface AddQuestionFormProps {
  onCreated: (newQuestionId: string) => void;
  onCancel: () => void;
}

interface DraftRubricPoint {
  criterion: string;
  maxMarks: string;
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: 'var(--ink-soft)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.75rem',
};

// A modal (not an inline section pushing down the main grading form) — this
// is an occasional, secondary action, and the earlier inline version cluttered
// the primary "grade a paper" flow every time it was open.
//
// This is a thin form over POST /api/questions — the brief's own "Upload" row
// lists "read the question paper... and model answer/rubric" as a minimum
// expectation, which previously only worked for the 3 questions seeded at
// dev time. A teacher can either type everything in directly, or upload the
// question paper (PDF or pasted text) and use "Draft with AI" to get a
// starting model answer + rubric from the live LLM — which is ALWAYS just a
// pre-fill: nothing is saved or ever used to grade a real student until the
// teacher reviews it and explicitly clicks "Create Question", identical to
// typing it by hand. If drafting fails (no configured credentials, API
// error), the form stays fully usable manually — it never fabricates a
// rubric to fall back on.
//
// Laid out as two columns — "The Question" (what's being asked) on the left,
// "The Marking Standard" (model answer + rubric) on the right — at a wide
// enough modal size that neither a long criterion sentence nor the model
// answer textarea feels squeezed. The two-column grid collapses to one on
// a narrow viewport via auto-fit, no separate mobile layout needed.
export const AddQuestionForm: React.FC<AddQuestionFormProps> = ({ onCreated, onCancel }) => {
  const [subject, setSubject] = useState('');
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [modelAnswerText, setModelAnswerText] = useState('');
  const [rubricPoints, setRubricPoints] = useState<DraftRubricPoint[]>([{ criterion: '', maxMarks: '1' }]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [draftedFromAI, setDraftedFromAI] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const totalMarks = rubricPoints.reduce((sum, r) => sum + (Number(r.maxMarks) || 0), 0);
  const hasContent = Boolean(
    subject.trim() || title.trim() || text.trim() || modelAnswerText.trim() || file || rubricPoints.some(r => r.criterion.trim())
  );
  const hasDraftableContent = Boolean(modelAnswerText.trim() || rubricPoints.some(r => r.criterion.trim()));
  const canSubmit =
    title.trim().length > 0 &&
    text.trim().length > 0 &&
    rubricPoints.length > 0 &&
    rubricPoints.every(r => r.criterion.trim().length > 0 && Number(r.maxMarks) > 0);
  const canDraft = Boolean(file || text.trim().length > 0);

  const updateRow = (idx: number, patch: Partial<DraftRubricPoint>) => {
    setRubricPoints(rows => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => setRubricPoints(rows => [...rows, { criterion: '', maxMarks: '1' }]);
  const removeRow = (idx: number) => setRubricPoints(rows => rows.filter((_, i) => i !== idx));

  // Closing (X, Cancel, backdrop click, or Escape) used to discard whatever
  // was typed or drafted with no warning — a real way to lose a few minutes
  // of work by a stray click. Only asks when there's actually something to lose.
  const handleClose = () => {
    if (hasContent && !window.confirm('Discard this question? Anything you typed or drafted will be lost.')) return;
    onCancel();
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasContent]);

  const acceptFile = (f: File | null) => {
    if (f && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return;
    setFile(f);
  };

  const handleDraft = async () => {
    if (!canDraft || drafting) return;
    // Drafting a second time silently overwrote whatever model answer/rubric
    // was already there (AI-drafted or hand-typed) — only warn when there's
    // actually something on the line.
    if (hasDraftableContent && !window.confirm('This will replace the current model answer and rubric with a new AI draft. Continue?')) return;
    setDrafting(true);
    setError(null);
    try {
      let res: Response;
      if (file) {
        const formData = new FormData();
        formData.append('file', file);
        res = await fetch('/api/questions/draft', { method: 'POST', body: formData });
      } else {
        res = await fetch('/api/questions/draft', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
      }
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Drafting failed');

      setText(data.questionText || text);
      if (data.suggestedTitle && !title.trim()) setTitle(data.suggestedTitle);
      if (data.suggestedSubject && !subject.trim()) setSubject(data.suggestedSubject);
      setModelAnswerText(data.modelAnswerText || '');
      if (Array.isArray(data.rubricPoints) && data.rubricPoints.length > 0) {
        setRubricPoints(data.rubricPoints.map((r: any) => ({ criterion: r.criterion, maxMarks: String(r.maxMarks) })));
      }
      setDraftedFromAI(true);
    } catch (err: any) {
      setError(err.message || 'Drafting failed — fill in the rubric manually below.');
    } finally {
      setDrafting(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: subject.trim() || 'General',
          title: title.trim(),
          text: text.trim(),
          modelAnswerText: modelAnswerText.trim() || undefined,
          rubricPoints: rubricPoints.map(r => ({ criterion: r.criterion.trim(), maxMarks: Number(r.maxMarks) })),
        }),
      });
      const data = await readJson(res);
      if (!res.ok) throw new Error(data.error || 'Failed to create question');
      onCreated(data.id);
    } catch (err: any) {
      setError(err.message || 'Failed to create question');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={handleClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(3px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="card"
        style={{ width: '100%', maxWidth: 960, maxHeight: '92vh', display: 'flex', flexDirection: 'column', background: 'var(--paper-raised)', border: '1px solid var(--rule)', padding: '1.75rem' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1.25rem', borderBottom: '1px solid var(--rule)', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.375rem', fontWeight: 600, color: 'var(--ink)' }}>Add a New Question</div>
            <div style={{ fontSize: '0.8125rem', color: 'var(--ink-soft)', marginTop: '0.2rem' }}>
              Upload or type the question, then optionally draft a starting model answer and rubric with AI — review everything before saving.
            </div>
          </div>
          <button type="button" onClick={handleClose} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer', flexShrink: 0, marginLeft: '1rem' }}>
            <X size={22} />
          </button>
        </div>

        {/*
          Deliberately a <div>, not a <form> — this modal is rendered as a
          child of Stage1Provide's own <form> (the "Grade This Paper" form).
          A <form> nested inside another <form> is invalid HTML with
          undefined submit behavior across browsers — see the git history on
          this file for the bug that caused.
        */}
        <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.5rem' }}>
            {error && (
              <div style={{ background: '#FFF5F5', border: '1px solid var(--red-pen)', padding: '0.75rem 1rem', marginBottom: '1.25rem', color: 'var(--red-pen)', fontSize: '0.8125rem' }}>
                {error}
              </div>
            )}

            {draftedFromAI && (
              <div style={{ fontSize: '0.8125rem', color: 'var(--marks-good)', fontWeight: 600, marginBottom: '1rem' }}>
                ✓ Drafted by AI — review every field below before creating this question.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '2rem' }}>
              {/* Left column — the question itself */}
              <div>
                <div style={sectionLabelStyle}>The Question</div>

                <label
                  htmlFor="question-pdf-upload"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.4rem',
                    border: `1px dashed ${isDragOver ? 'var(--ink)' : 'var(--rule)'}`,
                    background: isDragOver ? '#FFFFFF' : 'var(--paper)',
                    padding: '1rem',
                    marginBottom: '1.25rem',
                    transition: 'border-color 0.15s, background 0.15s',
                    cursor: 'pointer',
                    fontSize: '0.8125rem',
                    color: 'var(--ink)',
                    fontWeight: 600,
                  }}
                  onDragOver={e => {
                    e.preventDefault();
                    setIsDragOver(true);
                  }}
                  onDragLeave={() => setIsDragOver(false)}
                  onDrop={e => {
                    e.preventDefault();
                    setIsDragOver(false);
                    acceptFile(e.dataTransfer.files?.[0] || null);
                  }}
                >
                  <Upload size={14} />
                  {file ? file.name : 'Drop the question paper here, or click to upload (PDF, optional)'}
                  <input id="question-pdf-upload" type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => acceptFile(e.target.files?.[0] || null)} />
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem', marginBottom: '1.25rem' }}>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Subject</label>
                    <input className="form-input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Science" />
                  </div>
                  <div className="form-group" style={{ marginBottom: 0 }}>
                    <label className="form-label">Title</label>
                    <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Question 4 — Photosynthesis" required />
                  </div>
                </div>

                <div className="form-group" style={{ marginBottom: '1rem' }}>
                  <label className="form-label">Question Text</label>
                  <textarea className="form-textarea" rows={9} value={text} onChange={e => setText(e.target.value)} placeholder="Paste or type the full question prompt..." required />
                </div>

                {/* Placed AFTER both ways of providing the question (upload or
                    type) instead of crammed inside the dropzone — it reads as
                    "now draft from what's above," not "part of uploading a file," and stays disabled until there's something to draft from either way. */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    background: 'var(--paper)',
                    border: '1px solid var(--rule)',
                    padding: '0.75rem 1rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--ink-soft)' }}>
                    <Sparkles size={14} color="var(--ink)" style={{ flexShrink: 0 }} />
                    Draft a model answer and rubric from the question above using AI
                  </div>
                  <button
                    type="button"
                    onClick={handleDraft}
                    disabled={!canDraft || drafting}
                    className="btn btn-primary"
                    style={{ fontSize: '0.8125rem', padding: '0.4rem 0.75rem', flexShrink: 0, opacity: !canDraft || drafting ? 0.6 : 1 }}
                    title="Sends the question text to the live LLM for a suggested model answer and rubric — only ever pre-fills this form, nothing is saved automatically."
                  >
                    <Sparkles size={14} /> {drafting ? 'Drafting...' : 'Draft with AI'}
                  </button>
                </div>
              </div>

              {/* Right column — the marking standard */}
              <div>
                <div style={sectionLabelStyle}>The Marking Standard</div>

                <div className="form-group">
                  <label className="form-label">Model Answer (optional — shown as a reference in the result view)</label>
                  <textarea className="form-textarea" rows={5} value={modelAnswerText} onChange={e => setModelAnswerText(e.target.value)} placeholder="The ideal/reference answer for this question..." />
                </div>

                <div className="form-group" style={{ marginBottom: 0 }}>
                  <label className="form-label">
                    Rubric Points <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>(total: {totalMarks} marks)</span>
                  </label>
                  {rubricPoints.map((row, idx) => (
                    <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem', alignItems: 'flex-start' }}>
                      <textarea
                        className="form-textarea"
                        rows={2}
                        style={{ flex: 1, resize: 'vertical' }}
                        value={row.criterion}
                        onChange={e => updateRow(idx, { criterion: e.target.value })}
                        placeholder="What must be true for full credit on this point?"
                      />
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
                        <input
                          className="form-input"
                          type="number"
                          min="0.5"
                          step="0.5"
                          style={{ width: 72 }}
                          value={row.maxMarks}
                          onChange={e => updateRow(idx, { maxMarks: e.target.value })}
                        />
                        <button
                          type="button"
                          onClick={() => removeRow(idx)}
                          disabled={rubricPoints.length <= 1}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem', justifyContent: 'center', opacity: rubricPoints.length <= 1 ? 0.4 : 1 }}
                          title="Remove this rubric point"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                  <button type="button" onClick={addRow} className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.4rem 0.75rem', marginTop: '0.25rem' }}>
                    <Plus size={13} /> Add Rubric Point
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem', paddingTop: '1.25rem', borderTop: '1px solid var(--rule)' }}>
            <button type="button" onClick={handleClose} className="btn btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={handleSubmit} className="btn btn-primary" disabled={!canSubmit || saving} style={{ minWidth: 160 }}>
              {saving ? 'Creating...' : 'Create Question'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
