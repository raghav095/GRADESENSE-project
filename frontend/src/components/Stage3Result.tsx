import React, { useState } from 'react';
import { GradingResult, Annotation } from '../types';
import { ResultHeader } from './ResultHeader';
import { PdfViewerCanvas } from './PdfViewerCanvas';
import { RubricSidebar } from './RubricSidebar';
import { AuditLogModal } from './AuditLogModal';
import { ArrowLeft, Terminal, Download } from 'lucide-react';

interface Stage3ResultProps {
  result: GradingResult;
  onGradeAnother: () => void;
}

export const Stage3Result: React.FC<Stage3ResultProps> = ({ result: initialResult, onGradeAnother }) => {
  const [result, setResult] = useState<GradingResult>(initialResult);
  const [annotations, setAnnotations] = useState<Annotation[]>(initialResult.annotations || []);
  const [selectedRubricPointId, setSelectedRubricPointId] = useState<string | null>(null);
  const [showAuditModal, setShowAuditModal] = useState(false);

  const handleExportPdf = () => {
    window.open(`/api/results/${result.id}/export`, '_blank');
  };

  return (
    <div>
      <ResultHeader result={result} onReviewed={() => setResult(r => ({ ...r, needsHumanReview: false, reviewedAt: new Date().toISOString() }))} />

      <div className="grading-grid">
        <PdfViewerCanvas result={result} selectedRubricPointId={selectedRubricPointId} onSelectRubricPoint={setSelectedRubricPointId} />

        <RubricSidebar
          result={result}
          annotations={annotations}
          onUpdateAnnotations={setAnnotations}
          selectedRubricPointId={selectedRubricPointId}
          onSelectRubricPoint={setSelectedRubricPointId}
        />
      </div>

      {/* All actions for this result, grouped together — reset on the left,
          inspection/export on the right — instead of competing for space
          up in the header alongside the score and status. Sticky to the
          bottom of the viewport (not just the end of the document) so
          "Export Annotated PDF" stays reachable while scrolling through a
          long rubric or answer, instead of requiring a scroll all the way
          past everything first. */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          display: 'flex',
          justifyContent: 'space-between',
          marginTop: '1.5rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
          background: 'var(--paper)',
          borderTop: '1px solid var(--rule)',
          padding: '1rem 0',
        }}
      >
        <button className="btn btn-secondary" onClick={onGradeAnother}>
          <ArrowLeft size={14} />
          Grade Another Paper
        </button>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button className="btn btn-secondary" onClick={() => setShowAuditModal(true)} title="Inspect raw LLM calls">
            <Terminal size={14} />
            Audit Logs
          </button>
          <button className="btn btn-primary" onClick={handleExportPdf}>
            <Download size={14} />
            Export Annotated PDF
          </button>
        </div>
      </div>

      {showAuditModal && <AuditLogModal resultId={result.id} onClose={() => setShowAuditModal(false)} />}
    </div>
  );
};
