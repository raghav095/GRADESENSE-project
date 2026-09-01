import React from 'react';

interface HeaderProps {
  activeView: 'grade' | 'history';
  setActiveView: (view: 'grade' | 'history') => void;
  reviewCount: number;
}

export const Header: React.FC<HeaderProps> = ({ activeView, setActiveView, reviewCount }) => {
  return (
    <header className="header">
      <div className="brand" onClick={() => setActiveView('grade')} style={{ cursor: 'pointer' }}>
        GradeSense
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 400,
            color: 'var(--ink-soft)',
            fontFamily: 'var(--font-sans)',
            borderLeft: '1px solid var(--rule)',
            paddingLeft: '0.5rem',
            marginLeft: '0.25rem',
          }}
        >
          Exam Grading Tool
        </span>
      </div>

      {/* Two real destinations only — everything about the grading task
          itself lives inside the "Grade a Paper" flow as stages, not tabs. */}
      <nav className="nav-tabs">
        <button className={`nav-btn ${activeView === 'grade' ? 'active' : ''}`} onClick={() => setActiveView('grade')}>
          Grade a Paper
        </button>

        <button className={`nav-btn ${activeView === 'history' ? 'active' : ''}`} onClick={() => setActiveView('history')}>
          History
          {reviewCount > 0 && (
            <span className="mono" style={{ marginLeft: '0.35rem', color: 'var(--red-pen)', fontWeight: 600 }} title={`${reviewCount} result(s) need review`}>
              ({reviewCount})
            </span>
          )}
        </button>
      </nav>
    </header>
  );
};
