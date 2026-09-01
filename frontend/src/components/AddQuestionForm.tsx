import React, { useState } from 'react';
import { Plus, Trash2, X, Sparkles, Upload } from 'lucide-react';

interface AddQuestionFormProps {
  onCreated: (newQuestionId: string) => void;
  onCancel: () => void;
}

interface DraftRubricPoint {
  criterion: string;
  maxMarks: string;
}

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

  const totalMarks = rubricPoints.reduce((sum, r) => sum + (Number(r.maxMarks) || 0), 0);
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

  const handleDraft = async () => {
    if (!canDraft || drafting) return;
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
      const data = await res.json();
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create question');
      onCreated(data.id);
    } catch (err: any) {
      setError(err.message || 'Failed to create question');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
      <div className="card" style={{ width: '100%', maxWidth: 640, maxHeight: '90vh', display: 'flex', flexDirection: 'column', background: 'var(--paper-raised)', border: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--rule)', marginBottom: '1rem' }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', fontWeight: 600, color: 'var(--ink)' }}>Add a New Question</div>
          <button type="button" onClick={onCancel} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
          <div style={{ overflowY: 'auto', flex: 1, paddingRight: '0.25rem' }}>
            {error && (
              <div style={{ background: '#FFF5F5', border: '1px solid var(--red-pen)', padding: '0.6rem 0.875rem', marginBottom: '1rem', color: 'var(--red-pen)', fontSize: '0.8125rem' }}>
                {error}
              </div>
            )}

            <div style={{ border: '1px dashed var(--rule)', background: 'var(--paper)', padding: '1rem', marginBottom: '1rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <label htmlFor="question-pdf-upload" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.8125rem', color: 'var(--ink)', fontWeight: 600 }}>
                  <Upload size={14} />
                  {file ? file.name : 'Upload the question paper (PDF, optional)'}
                </label>
                <input id="question-pdf-upload" type="file" accept=".pdf" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
                <button
                  type="button"
                  onClick={handleDraft}
                  disabled={!canDraft || drafting}
                  className="btn btn-primary"
                  style={{ fontSize: '0.8125rem', padding: '0.4rem 0.75rem', opacity: !canDraft || drafting ? 0.6 : 1 }}
                  title="Sends the question text to the live LLM for a suggested model answer and rubric — only ever pre-fills this form, nothing is saved automatically."
                >
                  <Sparkles size={14} /> {drafting ? 'Drafting...' : 'Draft with AI'}
                </button>
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--ink-soft)', marginTop: '0.5rem' }}>
                Upload a PDF or paste the question text below, then optionally use "Draft with AI" for a starting model answer and rubric — review and edit everything before saving.
              </div>
            </div>

            {draftedFromAI && (
              <div style={{ fontSize: '0.75rem', color: 'var(--marks-good)', fontWeight: 600, marginBottom: '0.75rem' }}>
                ✓ Drafted by AI — review every field below before creating this question.
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '1rem', marginBottom: '1rem' }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Subject</label>
                <input className="form-input" value={subject} onChange={e => setSubject(e.target.value)} placeholder="e.g. Science" />
              </div>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Title</label>
                <input className="form-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Question 4 — Photosynthesis" required />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Question Text</label>
              <textarea className="form-textarea" rows={3} value={text} onChange={e => setText(e.target.value)} placeholder="Paste or type the full question prompt..." required />
            </div>

            <div className="form-group">
              <label className="form-label">Model Answer (optional — shown as a reference in the result view)</label>
              <textarea className="form-textarea" rows={3} value={modelAnswerText} onChange={e => setModelAnswerText(e.target.value)} placeholder="The ideal/reference answer for this question..." />
            </div>

            <div className="form-group">
              <label className="form-label">
                Rubric Points <span style={{ color: 'var(--ink-soft)', fontWeight: 400 }}>(total: {totalMarks} marks)</span>
              </label>
              {rubricPoints.map((row, idx) => (
                <div key={idx} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-start' }}>
                  <input
                    className="form-input"
                    style={{ flex: 1 }}
                    value={row.criterion}
                    onChange={e => updateRow(idx, { criterion: e.target.value })}
                    placeholder="What must be true for full credit on this point?"
                  />
                  <input
                    className="form-input"
                    type="number"
                    min="0.5"
                    step="0.5"
                    style={{ width: 80 }}
                    value={row.maxMarks}
                    onChange={e => updateRow(idx, { maxMarks: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    disabled={rubricPoints.length <= 1}
                    className="btn btn-secondary"
                    style={{ padding: '0.4rem', opacity: rubricPoints.length <= 1 ? 0.4 : 1 }}
                    title="Remove this rubric point"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addRow} className="btn btn-secondary" style={{ fontSize: '0.8125rem', padding: '0.35rem 0.7rem' }}>
                <Plus size={13} /> Add Rubric Point
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid var(--rule)' }}>
            <button type="button" onClick={onCancel} className="btn btn-secondary">
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={!canSubmit || saving}>
              {saving ? 'Creating...' : 'Create Question'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
