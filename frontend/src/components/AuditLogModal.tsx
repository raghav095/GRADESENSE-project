import React, { useEffect, useState } from 'react';
import { LlmCallLog } from '../types';
import { X } from 'lucide-react';

interface AuditLogModalProps {
  resultId: string;
  onClose: () => void;
}

export const AuditLogModal: React.FC<AuditLogModalProps> = ({ resultId, onClose }) => {
  const [logs, setLogs] = useState<LlmCallLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/results/${resultId}/logs`)
      .then(res => res.json())
      .then(data => setLogs(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [resultId]);

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div className="card" style={{ width: '90%', maxWidth: 880, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--paper-raised)', border: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingBottom: '1rem', borderBottom: '1px solid var(--rule)' }}>
          <div style={{ fontFamily: 'var(--font-serif)', fontSize: '1.125rem', fontWeight: 600, color: 'var(--ink)' }}>
            LLM Execution & Audit Trail (Result {resultId.slice(0, 12)}...)
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--ink-soft)', cursor: 'pointer' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '1rem 0' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-soft)', padding: '2rem' }}>Loading logs...</div>
          ) : logs.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--ink-soft)', padding: '2rem' }}>No LLM logs found for this result.</div>
          ) : (
            logs.map((l, idx) => (
              <div key={l.id || idx} style={{ background: 'var(--paper)', border: '1px solid var(--rule)', padding: '1rem', marginBottom: '1rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.8125rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 600, color: 'var(--ink)' }}>{l.pass.toUpperCase()} PASS</span>
                    <span className="mono" style={{ color: 'var(--ink-soft)' }}>{l.model}</span>
                  </div>
                  <div className="mono" style={{ color: 'var(--ink-soft)', fontSize: '0.75rem' }}>
                    {l.latencyMs} ms
                  </div>
                </div>

                {l.error && (
                  <div style={{ background: '#FFF5F5', color: 'var(--red-pen)', padding: '0.5rem', fontSize: '0.75rem', marginBottom: '0.5rem', border: '1px solid var(--red-pen)' }}>
                    {l.error}
                  </div>
                )}

                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
                  Prompt Input
                </div>
                <pre className="mono" style={{ background: '#FFFFFF', border: '1px solid var(--rule)', padding: '0.75rem', fontSize: '0.75rem', color: 'var(--ink)', overflowX: 'auto', marginBottom: '0.75rem', maxHeight: 150 }}>
                  {l.rawRequest}
                </pre>

                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
                  Model Output JSON
                </div>
                <pre className="mono" style={{ background: '#FFFFFF', border: '1px solid var(--rule)', padding: '0.75rem', fontSize: '0.75rem', color: 'var(--ink)', overflowX: 'auto', maxHeight: 180 }}>
                  {l.rawResponse}
                </pre>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
