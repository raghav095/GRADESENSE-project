import React, { useEffect, useState } from 'react';
import { Question, GradingResult } from '../types';
import { ChevronRight, ChevronDown, Upload, Plus, FileText, Type } from 'lucide-react';
import { AddQuestionForm } from './AddQuestionForm';
import { readJson } from '../utils/api';

interface Stage1ProvideProps {
  questions: Question[];
  // Receives a not-yet-invoked thunk, so the parent controls exactly when the
  // request starts (and can move to the Grading stage right as it fires) and
  // can catch a failure to show it back here, on this stage, rather than
  // losing it on an unmounted form.
  onGradingStarted: (start: () => Promise<GradingResult>) => void;
  error: string | null;
  /** True while a submission is in flight — the form stays visible (with the ProcessingStrip appended below it) but locked, rather than navigating away. */
  disabled?: boolean;
  /** Called after a new question is created via AddQuestionForm — parent refetches the question list. */
  onQuestionCreated: () => void;
}

type AnswerMode = 'upload' | 'paste';

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  fontWeight: 700,
  color: 'var(--ink-soft)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '0.75rem',
  paddingBottom: '0.5rem',
  borderBottom: '1px solid var(--rule)',
};

// A per-question sample answer, so the "try a sample" link is scoped to
// whichever question is actually selected rather than being a single
// unrelated button that always loads the same fixed paper.
const SAMPLE_ANSWERS: Record<string, { studentName: string; rollNumber: string; text: string }> = {
  'q1-science': {
    studentName: 'Ananya Rao',
    rollNumber: '24B',
    text: "An electric circuit is a close path in which electric current can flow. The battery gives the potentiall diffrence which push the current around the circuit. Switch is used for open and close the circuit, if switch is close then current will flow and bulb will glow, if switch is open then no current flow through the circuit. In the circuit the battery, switch, resistor, bulb and ammeter is connected in series because current pass through all of them one by one. Ammeter is connected in series because it measure the current flowing in circuit. Voltmeter is also connected in the circuit to measure the potential diffrence, as shown in diagram below - When current pass through the circuit some of the current get used up by the bulb and resistor, that is why the bulb glow and become hot. As per Ohms law, V = IR. So if we increase the resistance then the current flowing in the circuit will also increase, because more resistance need more current to push through it. If the resistance is less then the bulb will glow dim.",
  },
  'q2-english': {
    studentName: 'Siddharth V.',
    rollNumber: '18A',
    text: 'Technology has fundamentally reshaped learning dynamics, but I argue that easy access creates cognitive dependency rather than genuine comprehension. When information is instantly retrievable, students frequently substitute superficial searching for deep analytical thinking. For example, a student copying code solutions or math answers online may finish their homework faster, but fails to internalize the underlying concepts. While proponents argue that digital tools enable self-paced exploration, without disciplined reflection, easy answers discourage intellectual perseverance. Therefore, technology must be integrated as a secondary aid rather than a primary crutch for learning.',
  },
  'q3-economics': {
    studentName: 'Priya Nair',
    rollNumber: '31C',
    // Matches the ERROR_KEY.md-described mistakes for Q3 (correct curves/equilibrium,
    // vague surplus explanation, reversed cost-shift logic) — and, deliberately, contains
    // the exact evidence-quote substrings MockGrader's q3-economics fixture expects to
    // find verbatim. An earlier, more grammatically clean version of this sample text
    // didn't share any of those substrings, so grading it (even in mock mode) always
    // reported unmatched evidence and a spurious "Needs Review" flag on every scored
    // point — the reliability signal was firing correctly, but on a fixture mismatch,
    // not a real grading problem.
    text: 'Demand curve go downward because when price increase people buy less, and supply curve go upward when price increase, so producer supply more. From the graph the equilibrium price is 30 and quantity is 60 because demand equal supply. Below this price there is shortage in the market. If price is above equilibrium also something will happen in the market, quantity will not match properly. Also if cost of production increase, producer will charge more price so supply curve will shift to right and profit will increase. So the new equilibrium will have lower price and higher quantity than before.',
  },
};

export const Stage1Provide: React.FC<Stage1ProvideProps> = ({ questions, onGradingStarted, error, disabled = false, onQuestionCreated }) => {
  const [selectedQuestionId, setSelectedQuestionId] = useState<string>('');
  const [studentName, setStudentName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [studentAnswerText, setStudentAnswerText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [answerMode, setAnswerMode] = useState<AnswerMode>('upload');
  const [rubricOpen, setRubricOpen] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [addQuestionOpen, setAddQuestionOpen] = useState(false);

  // `questions` arrives asynchronously (fetched in App.tsx), so it can still
  // be [] on this component's first render. Defaulting the selection with a
  // useState initializer only runs once and would get stuck on '' forever
  // once the real list arrives — this keeps it synced instead.
  useEffect(() => {
    if (!selectedQuestionId && questions.length > 0) {
      setSelectedQuestionId(questions[0].id);
    }
  }, [questions, selectedQuestionId]);

  const selectedQuestion = questions.find(q => q.id === selectedQuestionId) || questions[0];
  const hasAnswer = Boolean(studentAnswerText.trim() || file);
  const canSubmit = Boolean(selectedQuestionId && hasAnswer);

  const disabledReason = questions.length === 0
    ? 'Loading questions...'
    : !selectedQuestionId
    ? 'Select a question to continue'
    : !hasAnswer
    ? answerMode === 'upload'
      ? 'Upload the answer paper (or switch to Paste Text) to continue'
      : 'Paste the answer text (or switch to Upload PDF) to continue'
    : '';

  const acceptFile = (f: File | null) => {
    if (f && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return;
    setFile(f);
  };

  // The two ways of providing an answer are mutually exclusive — switching
  // tabs clears the other, so there's never invisible state from a tab
  // you're not looking at silently satisfying "hasAnswer".
  const switchMode = (mode: AnswerMode) => {
    if (mode === answerMode) return;
    if (mode === 'upload') setStudentAnswerText('');
    else setFile(null);
    setAnswerMode(mode);
  };

  const runGrading = async () => {
    const formData = new FormData();
    formData.append('questionId', selectedQuestionId);
    // Left blank (rather than defaulting to 'Anonymous Student'/'00' here)
    // when the teacher didn't type one — that lets the backend fall back to
    // a name/roll it finds on the uploaded PDF itself before giving up and
    // using those defaults, instead of the typed-blank default always
    // winning over it.
    if (studentName.trim()) formData.append('studentName', studentName.trim());
    if (rollNumber.trim()) formData.append('rollNumber', rollNumber.trim());
    formData.append('studentAnswerText', studentAnswerText);
    if (file) formData.append('file', file);

    const subRes = await fetch('/api/submissions', { method: 'POST', body: formData });
    if (!subRes.ok) {
      const errJson = await readJson(subRes);
      throw new Error(errJson.error || 'Failed to upload submission');
    }
    const submission = await readJson(subRes);

    const gradeRes = await fetch(`/api/submissions/${submission.id}/grade`, { method: 'POST' });
    if (!gradeRes.ok) {
      const errJson = await readJson(gradeRes);
      throw new Error(errJson.error || 'Failed during grading execution');
    }
    return (await readJson(gradeRes)) as GradingResult;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || disabled) return;
    onGradingStarted(runGrading);
  };

  const loadSample = () => {
    const sample = SAMPLE_ANSWERS[selectedQuestionId];
    if (!sample) return;
    setStudentName(sample.studentName);
    setRollNumber(sample.rollNumber);
    setStudentAnswerText(sample.text);
    setFile(null);
    setAnswerMode('paste');
  };

  const handleQuestionCreated = (newQuestionId: string) => {
    setAddQuestionOpen(false);
    setSelectedQuestionId(newQuestionId);
    onQuestionCreated();
  };

  return (
    <div className="card" style={{ maxWidth: 820, margin: '0 auto' }}>
      <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)' }}>Grade a Student Answer Paper</h2>
      <p style={{ fontSize: '0.8125rem', color: 'var(--ink-soft)', marginTop: '0.25rem', marginBottom: '1.75rem' }}>
        Pick the question, provide the student's answer, and grade it — that's the whole flow.
      </p>

      {error && (
        <div style={{ background: '#FFF5F5', border: '1px solid var(--red-pen)', padding: '0.75rem 1rem', marginBottom: '1.25rem', color: 'var(--red-pen)', fontSize: '0.875rem' }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Section 1 — which question */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={sectionLabelStyle}>1. Examination Question</div>

          <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'stretch', marginBottom: '0.75rem' }}>
            <select
              className="form-select"
              style={{ flex: 1 }}
              value={selectedQuestionId}
              disabled={disabled}
              onChange={e => {
                setSelectedQuestionId(e.target.value);
                setRubricOpen(false);
              }}
            >
              {questions.map(q => (
                <option key={q.id} value={q.id}>
                  [{q.subject}] {q.title} ({q.maxMarks} Marks)
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setAddQuestionOpen(true)}
              disabled={disabled}
              className="btn btn-secondary"
              style={{ flexShrink: 0, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}
              title="Add a new question with its own rubric — typed manually, or drafted with AI from an uploaded question paper"
            >
              <Plus size={14} /> Add Question
            </button>
          </div>

          {addQuestionOpen && <AddQuestionForm onCreated={handleQuestionCreated} onCancel={() => setAddQuestionOpen(false)} />}

          {/* Rubric disclosure + sample link grouped as one unit — reads as
              "more about the question you picked", not two loose floating links. */}
          {selectedQuestion && !addQuestionOpen && (
            <div style={{ background: 'var(--paper)', border: '1px solid var(--rule)', padding: '0.75rem 1rem' }}>
              <button
                type="button"
                onClick={() => setRubricOpen(o => !o)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--ink)', fontSize: '0.8125rem', fontWeight: 600 }}
              >
                {rubricOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                View rubric criteria ({selectedQuestion.maxMarks} Marks Available)
              </button>

              {rubricOpen && (
                <ul style={{ paddingLeft: '1.25rem', fontSize: '0.8125rem', color: 'var(--ink)', marginTop: '0.6rem' }}>
                  {selectedQuestion.rubricPoints?.map(rp => (
                    <li key={rp.id} style={{ marginBottom: '0.25rem' }}>
                      <strong className="mono">[{rp.maxMarks}M]:</strong> {rp.criterion}
                    </li>
                  ))}
                </ul>
              )}

              {SAMPLE_ANSWERS[selectedQuestionId] && (
                <button
                  type="button"
                  onClick={loadSample}
                  disabled={disabled}
                  style={{ display: 'block', marginTop: '0.6rem', background: 'none', border: 'none', padding: 0, cursor: disabled ? 'default' : 'pointer', color: 'var(--ink-soft)', fontSize: '0.8125rem', textDecoration: 'underline', opacity: disabled ? 0.5 : 1 }}
                >
                  Try a sample answer for this question
                </button>
              )}
            </div>
          )}
        </div>

        {/* Section 2 — who */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={sectionLabelStyle}>
            2. Student Details <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }}>(optional)</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Student Name</label>
              <input type="text" className="form-input" value={studentName} disabled={disabled} onChange={e => setStudentName(e.target.value)} placeholder="e.g. Ananya Rao" />
            </div>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Roll Number</label>
              <input type="text" className="form-input" value={rollNumber} disabled={disabled} onChange={e => setRollNumber(e.target.value)} placeholder="e.g. 24B" />
            </div>
          </div>
        </div>

        {/* Section 3 — the answer, one input method visible at a time instead
            of an upload box always sitting above a mostly-empty paste box. */}
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={sectionLabelStyle}>3. Answer Paper</div>

          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <button
              type="button"
              onClick={() => switchMode('upload')}
              disabled={disabled}
              className={`btn ${answerMode === 'upload' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, fontSize: '0.8125rem' }}
            >
              <FileText size={14} /> Upload PDF
            </button>
            <button
              type="button"
              onClick={() => switchMode('paste')}
              disabled={disabled}
              className={`btn ${answerMode === 'paste' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ flex: 1, fontSize: '0.8125rem' }}
            >
              <Type size={14} /> Paste Text
            </button>
          </div>

          {answerMode === 'upload' ? (
            // The whole panel is the label (not just the text inside it) —
            // a label's click target extends only to its own content, so
            // wrapping just the text left the surrounding padding inert.
            <label
              htmlFor="file-upload"
              style={{
                display: 'block',
                border: `1px dashed ${isDragOver ? 'var(--ink)' : 'var(--rule)'}`,
                padding: '2rem 1.25rem',
                textAlign: 'center',
                background: isDragOver ? '#FFFFFF' : 'var(--paper)',
                transition: 'border-color 0.15s, background 0.15s',
                cursor: disabled ? 'default' : 'pointer',
              }}
              onDragOver={e => {
                e.preventDefault();
                if (!disabled) setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setIsDragOver(false);
                if (disabled) return;
                acceptFile(e.dataTransfer.files?.[0] || null);
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <Upload size={22} color="var(--ink-soft)" />
                <input type="file" accept=".pdf" disabled={disabled} onChange={e => acceptFile(e.target.files?.[0] || null)} style={{ display: 'none' }} id="file-upload" />
                <span style={{ color: 'var(--ink)', fontWeight: 600, fontSize: '0.9375rem' }}>
                  {file ? file.name : 'Drop a PDF here, or click to upload'}
                </span>
              </div>
            </label>
          ) : (
            <textarea
              className="form-textarea"
              rows={9}
              value={studentAnswerText}
              disabled={disabled}
              onChange={e => setStudentAnswerText(e.target.value)}
              placeholder="Paste student answer text here..."
              autoFocus
            />
          )}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '1rem', marginTop: '1.5rem' }}>
          {!disabled && disabledReason && <span style={{ fontSize: '0.8125rem', color: 'var(--ink-soft)', fontStyle: 'italic' }}>{disabledReason}</span>}
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!canSubmit || disabled}
            style={{ minWidth: 180, flexShrink: 0, opacity: canSubmit && !disabled ? 1 : 0.6, cursor: canSubmit && !disabled ? 'pointer' : 'not-allowed' }}
          >
            {disabled ? 'Grading...' : 'Grade This Paper →'}
          </button>
        </div>
      </form>
    </div>
  );
};
