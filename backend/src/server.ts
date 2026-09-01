import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import questionsRouter from './routes/questions.js';
import submissionsRouter from './routes/submissions.js';
import resultsRouter from './routes/results.js';
import annotationsRouter from './routes/annotations.js';
import { initializeDatabase } from './db/schema.js';
import { getDb } from './db/index.js';

// dotenv.config() with no path only looks in process.cwd() — but that's
// always backend/ here (whether started via `cd backend && npm run dev` or
// the root `npm run dev:backend` script), while .env lives at the project
// root, one level up. The bare call silently never found it: USE_LLM and
// GOOGLE_APPLICATION_CREDENTIALS were undefined every single run regardless
// of what .env actually said, so grading silently ran through MockGrader the
// entire time even with real credentials configured. Resolving the path
// relative to this file itself (via the CommonJS __dirname global — this
// compiles to CJS, not ESM, so import.meta isn't available here) fixes it
// regardless of how or from where the server is launched.
dotenv.config({ path: path.join(__dirname, '../../.env') });

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize SQLite database
initializeDatabase();

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Routes
app.use('/api/questions', questionsRouter);
app.use('/api/submissions', submissionsRouter);
app.use('/api/results', resultsRouter);
app.use('/api/annotations', annotationsRouter);

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', service: 'GradeSense Backend', timestamp: new Date().toISOString() });
});

// Delete a single grading result and its child records
app.delete('/api/results/:id', (req, res) => {
  const db = getDb();
  const id = req.params.id;
  db.prepare('DELETE FROM llm_logs WHERE grading_result_id = ?').run(id);
  db.prepare('DELETE FROM annotations WHERE grading_result_id = ?').run(id);
  db.prepare('DELETE FROM rubric_point_results WHERE grading_result_id = ?').run(id);
  const info = db.prepare('DELETE FROM grading_results WHERE id = ?').run(id);
  res.json({ deleted: info.changes > 0 });
});

// Reset: drop all submissions, results, annotations, logs — keep questions & rubric
app.post('/api/reset', (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM llm_logs').run();
  db.prepare('DELETE FROM annotations').run();
  db.prepare('DELETE FROM rubric_point_results').run();
  db.prepare('DELETE FROM grading_results').run();
  db.prepare('DELETE FROM submissions').run();
  res.json({ status: 'reset', message: 'All submissions, results, and logs cleared. Questions and rubric preserved.' });
});

app.listen(PORT, () => {
  console.log(`GradeSense Backend running on http://localhost:${PORT}`);
});
