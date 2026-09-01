import React, { useEffect, useState } from 'react';
import { GradingResult } from '../types';
import { Download, Trash2 } from 'lucide-react';

interface HistoryViewProps {
  onSelectResult: (resultId: string) => void;
}

// History is the one place past results live — it folds in what used to be a
// separate "Review Queue" tab as a filter, since a flagged result is still a
// history entry, just one that needs a closer look.
export const HistoryView: React.FC<HistoryViewProps> = ({ onSelectResult }) => {
  const [results, setResults] = useState<GradingResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'all' | 'review'>('all');

  const fetchResults = () => {
    setLoading(true);
    fetch('/api/results')
      .then(res => res.json())
      .then(data => setResults(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchResults();
  }, []);

  const handleDelete = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!window.confirm('Delete this graded result? This cannot be undone.')) return;
    await fetch(`/api/results/${id}`, { method: 'DELETE' });
    setResults(prev => prev.filter(r => r.id !== id));
  };

  const visibleResults = filter === 'review' ? results.filter(r => r.needsHumanReview) : results;
  const reviewCount = results.filter(r => r.needsHumanReview).length;

  return (
    <div className="card" style={{ maxWidth: 1150, margin: '2rem auto' }}>
      <div style={{ marginBottom: '1.25rem', borderBottom: '1px solid var(--rule)', paddingBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h2 style={{ fontFamily: 'var(--font-serif)', fontSize: '1.25rem', fontWeight: 600, color: 'var(--ink)' }}>History</h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--ink-soft)', marginTop: '0.25rem' }}>
            Every graded paper is saved here. Select an entry to view it again — nothing re-grades.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button
            className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8125rem' }}
            onClick={() => setFilter('all')}
          >
            All ({results.length})
          </button>
          <button
            className={`btn ${filter === 'review' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ padding: '0.3rem 0.75rem', fontSize: '0.8125rem' }}
            onClick={() => setFilter('review')}
          >
            Needs Review ({reviewCount})
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--ink-soft)' }}>Loading history...</div>
      ) : visibleResults.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem 1rem', color: filter === 'review' ? 'var(--marks-good)' : 'var(--ink-soft)' }}>
          {filter === 'review' ? 'Nothing needs review — all graded papers meet the confidence threshold.' : 'No papers graded yet.'}
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Date / Time</th>
              <th>Student Name</th>
              <th>Roll</th>
              <th>Question</th>
              <th>Score</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleResults.map(r => (
              <tr key={r.id} onClick={() => onSelectResult(r.id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontSize: '0.8125rem', color: 'var(--ink-soft)' }}>{new Date(r.createdAt).toLocaleString()}</td>
                <td style={{ fontWeight: 600, color: 'var(--ink)' }}>{r.studentName}</td>
                <td>{r.rollNumber}</td>
                <td>{r.questionTitle}</td>
                <td className="mono" style={{ fontWeight: 600 }}>
                  {r.totalMarks} / {r.maxMarks}
                </td>
                <td>
                  {r.needsHumanReview ? (
                    <span title={r.reviewReason} style={{ color: 'var(--red-pen)', fontWeight: 600, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="status-dot status-dot-bad" /> Needs Review
                    </span>
                  ) : (
                    <span
                      title={r.reviewedAt ? `Manually reviewed ${new Date(r.reviewedAt).toLocaleString()}` : undefined}
                      style={{ color: 'var(--marks-good)', fontWeight: 600, fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: 6 }}
                    >
                      <span className="status-dot status-dot-good" /> {r.reviewedAt ? 'Reviewed' : 'Verified'}
                    </span>
                  )}
                </td>
                <td style={{ display: 'flex', gap: '0.4rem' }} onClick={e => e.stopPropagation()}>
                  <a href={`/api/results/${r.id}/export`} target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem' }}>
                    <Download size={11} /> PDF
                  </a>
                  <button
                    className="btn btn-secondary"
                    onClick={e => handleDelete(e, r.id)}
                    style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', color: 'var(--red-pen)' }}
                    title="Delete this result"
                  >
                    <Trash2 size={11} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
