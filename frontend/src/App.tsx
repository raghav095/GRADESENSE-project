import React, { useEffect, useState } from 'react';
import { Question } from './types';
import { Header } from './components/Header';
import { GradeFlow } from './components/GradeFlow';
import { HistoryView } from './components/HistoryView';

type View = 'grade' | 'history';

export const App: React.FC = () => {
  const [activeView, setActiveView] = useState<View>('grade');
  const [questions, setQuestions] = useState<Question[]>([]);
  const [questionsError, setQuestionsError] = useState<string | null>(null);
  const [reviewCount, setReviewCount] = useState<number>(0);
  const [openResultId, setOpenResultId] = useState<string | null>(null);

  const fetchQuestions = () => {
    fetch('/api/questions')
      .then(res => {
        if (!res.ok) throw new Error(`Server responded ${res.status}`);
        return res.json();
      })
      .then(data => {
        setQuestions(data);
        setQuestionsError(null);
      })
      .catch(() => setQuestionsError('Could not load questions from the backend — make sure the server (npm run dev:backend) is running, then reload.'));
  };

  useEffect(() => {
    fetchQuestions();
    fetchReviewCount();
  }, []);

  const fetchReviewCount = () => {
    fetch('/api/results?reviewOnly=true')
      .then(res => res.json())
      .then(data => setReviewCount(data.length))
      .catch(() => {});
  };

  // A saved result is reachable exactly two ways: finishing the grade flow,
  // or clicking a row in History — never its own nav item.
  const handleSelectResult = (resultId: string) => {
    setOpenResultId(resultId);
    setActiveView('grade');
  };

  return (
    <div className="app-container">
      <Header activeView={activeView} setActiveView={setActiveView} reviewCount={reviewCount} />

      <main className="main-content">
        {questionsError && (
          <div
            style={{
              maxWidth: 820,
              margin: '0 auto 1.25rem',
              background: '#FFF5F5',
              border: '1px solid var(--red-pen)',
              padding: '0.75rem 1rem',
              color: 'var(--red-pen)',
              fontSize: '0.875rem',
            }}
          >
            {questionsError}
          </div>
        )}

        {activeView === 'grade' && (
          <GradeFlow
            questions={questions}
            openResultId={openResultId}
            onResultOpened={() => setOpenResultId(null)}
            onResultSaved={fetchReviewCount}
            onQuestionCreated={fetchQuestions}
          />
        )}

        {activeView === 'history' && <HistoryView onSelectResult={handleSelectResult} />}
      </main>
    </div>
  );
};

export default App;
