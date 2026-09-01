import { Router } from 'express';
import { getDb } from '../db/index.js';
import crypto from 'crypto';

const router = Router();

router.get('/:resultId', (req, res) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM annotations WHERE grading_result_id = ?').all(req.params.resultId);
  res.json(rows.map((a: any) => ({
    id: a.id,
    gradingResultId: a.grading_result_id,
    page: a.page,
    x: a.x,
    y: a.y,
    width: a.width,
    height: a.height,
    type: a.type,
    linkedPointResultId: a.linked_point_result_id,
    correctionText: a.correction_text,
    createdByUser: Boolean(a.created_by_user),
    updatedAt: a.updated_at,
  })));
});

router.post('/', (req, res) => {
  const { gradingResultId, page, x, y, width, height, type, correctionText } = req.body;
  if (!gradingResultId || !correctionText) {
    return res.status(400).json({ error: 'Missing required fields: gradingResultId, correctionText' });
  }

  const db = getDb();
  const id = `ann-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  const insert = db.prepare(`
    INSERT INTO annotations (id, grading_result_id, page, x, y, width, height, type, linked_point_result_id, correction_text, created_by_user, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  insert.run(id, gradingResultId, page || 1, x || 50, y || 100, width || 200, height || 40, type || 'box', null, correctionText, now);

  res.status(201).json({
    id,
    gradingResultId,
    page: page || 1,
    x: x || 50,
    y: y || 100,
    width: width || 200,
    height: height || 40,
    type: type || 'box',
    correctionText,
    createdByUser: true,
    updatedAt: now,
  });
});

router.patch('/:id', (req, res) => {
  const { x, y, width, height, type, correctionText } = req.body;
  const db = getDb();
  const existing: any = db.prepare('SELECT * FROM annotations WHERE id = ?').get(req.params.id);

  if (!existing) {
    return res.status(404).json({ error: 'Annotation not found' });
  }

  const now = new Date().toISOString();
  const newX = x !== undefined ? x : existing.x;
  const newY = y !== undefined ? y : existing.y;
  const newWidth = width !== undefined ? width : existing.width;
  const newHeight = height !== undefined ? height : existing.height;
  const newType = type || existing.type;
  const newText = correctionText !== undefined ? correctionText : existing.correction_text;

  const update = db.prepare(`
    UPDATE annotations
    SET x = ?, y = ?, width = ?, height = ?, type = ?, correction_text = ?, created_by_user = 1, updated_at = ?
    WHERE id = ?
  `);

  update.run(newX, newY, newWidth, newHeight, newType, newText, now, req.params.id);

  res.json({
    id: existing.id,
    gradingResultId: existing.grading_result_id,
    page: existing.page,
    x: newX,
    y: newY,
    width: newWidth,
    height: newHeight,
    type: newType,
    correctionText: newText,
    createdByUser: true,
    updatedAt: now,
  });
});

router.delete('/:id', (req, res) => {
  const db = getDb();
  const result = db.prepare('DELETE FROM annotations WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'Annotation not found' });
  }
  res.json({ success: true, message: 'Annotation deleted' });
});

export default router;
