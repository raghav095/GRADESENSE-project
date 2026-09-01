// @ts-ignore — pdfjs-dist's legacy Node build ships its own .d.ts that
// doesn't play perfectly with NodeNext resolution, but the runtime export is correct.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { PDFDocument, PDFPage, rgb, StandardFonts } from 'pdf-lib';
import { Annotation } from './types.js';
import { computeTextLayout, pageCount, PAGE_WIDTH, PAGE_HEIGHT, MARGIN_X, MARGIN_RIGHT, FONT_SIZE } from './textLayout.js';

// Uses pdfjs-dist directly rather than the `pdf-parse` package. `pdf-parse`
// wraps a very old, unmaintained pdf.js build that throws "Invalid PDF
// structure" / "Unknown compression method in flate stream" on PDFs using
// stream encodings pdf-lib (and other modern generators) commonly produce —
// confirmed by testing it against this app's own exported PDFs, which it
// couldn't re-read. pdfjs-dist is the actively maintained engine and parses
// the same files correctly.
export interface PdfExtraction {
  text: string;
  pageCount: number;
}

// Returns pageCount alongside the extracted text so a caller can tell a
// genuinely short answer apart from a PDF that mostly isn't text at all — a
// scanned/photographed answer sheet or a hand-drawn diagram has real content
// on the page, but pdfjs's getTextContent() only ever sees rendered text
// runs, never pixels. A one-page PDF that yields only a few dozen characters
// is a signal worth surfacing, not silently treating as "the student wrote
// almost nothing."
export async function extractTextFromPdf(pdfBuffer: Buffer): Promise<PdfExtraction> {
  try {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(pdfBuffer), useSystemFonts: true }).promise;
    const pageTexts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();

      // Grouped into visual lines by each item's baseline Y position (pdfjs
      // gives every item a transform matrix; transform[5] is its Y) instead
      // of concatenating every item on the page with a single space —
      // joining everything flat collapsed distinct lines (e.g. a "Name:"
      // header above the actual answer) into one run-on blob with no
      // boundary between them, which breaks anything that looks for a
      // line-anchored pattern in the extracted text, not just readability.
      const items = (content.items as any[]).filter(item => 'str' in item && typeof item.transform?.[5] === 'number');
      const lineGroups = new Map<number, { x: number; str: string }[]>();
      for (const item of items) {
        const y = Math.round(item.transform[5]);
        if (!lineGroups.has(y)) lineGroups.set(y, []);
        lineGroups.get(y)!.push({ x: item.transform[4], str: item.str });
      }
      const lines = Array.from(lineGroups.entries())
        .sort((a, b) => b[0] - a[0]) // top to bottom — higher PDF-space Y first
        .map(([, lineItems]) =>
          lineItems
            .sort((a, b) => a.x - b.x)
            .map(li => li.str)
            .join(' ')
        );
      pageTexts.push(lines.join('\n'));
    }
    return { text: pageTexts.join('\n\n').trim(), pageCount: doc.numPages };
  } catch (err: any) {
    throw new Error(`Failed to extract text from PDF: ${err.message}`);
  }
}

export interface ExportMeta {
  studentName?: string;
  rollNumber?: string;
  questionTitle?: string;
  subject?: string;
  modelAnswerText?: string;
  /** The real page image (a direct photo/scan upload, or a rasterized PDF page) — embedded as its own reference page when present. */
  originalImageBuffer?: Buffer;
}

function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

export interface ExportRubricPoint {
  id: string;
  criterion: string;
  marksAwarded: number;
  maxMarks: number;
  status: string;
  feedback: string;
}

export interface ExportSummary {
  totalMarks: number;
  maxMarks: number;
  confidence: number;
  needsHumanReview: boolean;
  reviewReason?: string | null;
  status: string;
  reviewedAt?: string | null;
}

// GradeSense's app color palette (see frontend/src/index.css), reused here so
// the exported document reads as the same product, not a generic printout —
// and so it actually shows the score and full rubric breakdown, which the
// PDF never included before (only the flagged mistakes were listed; the
// total mark, per-point marks, and confidence/review status weren't in the
// exported artifact at all).
const COLOR = {
  ink: rgb(0.11, 0.11, 0.118),
  inkSoft: rgb(0.361, 0.361, 0.376),
  rule: rgb(0.871, 0.871, 0.855),
  paper: rgb(0.969, 0.969, 0.961),
  good: rgb(0.243, 0.42, 0.31),
  partial: rgb(0.722, 0.525, 0.18),
  bad: rgb(0.698, 0.227, 0.18),
  white: rgb(1, 1, 1),
};

function statusColorFor(status: string, marks: number, max: number) {
  if (status === 'correct' || marks === max) return COLOR.good;
  if (status === 'partial' || marks > 0) return COLOR.partial;
  return COLOR.bad;
}

// pdf-lib's standard fonts (Helvetica etc.) use WinAnsi encoding, which has
// no glyph for ₹ (U+20B9) — or for plenty of other characters that can
// legitimately show up here (curly quotes from pasted text, other currency
// symbols, emoji). Without this, drawText() throws and the whole export
// fails with a 500 — confirmed: any Q3 result's rubric text contains "₹30",
// so exporting Q3 was completely broken before this fix.
//
// Two variants, because they're used in different contexts:
// - Freely: for text with no position dependency (criteria, feedback,
//   headers) — can safely expand "₹" to "Rs." etc.
// - PreservingLength: for the student's answer body specifically, whose
//   every character offset was already fixed at grading time to compute
//   annotation box positions — a length-changing substitution here would
//   silently shift every annotation after the replaced character.
function encodeOrStrip(font: any, text: string): string {
  try {
    font.encodeText(text);
    return text;
  } catch {
    let out = '';
    for (const ch of text) {
      try {
        font.encodeText(ch);
        out += ch;
      } catch {
        out += '?';
      }
    }
    return out;
  }
}

function sanitizeFreely(font: any, text: string): string {
  const replaced = text
    .replace(/₹/g, 'Rs. ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, '...')
    .replace(/–/g, '-');
  return encodeOrStrip(font, replaced);
}

function sanitizePreservingLength(font: any, text: string): string {
  let out = '';
  for (const ch of text) {
    if (ch === '₹') {
      out += 'R';
      continue;
    }
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += '?';
    }
  }
  return out;
}

/**
 * Renders a clean, paginated PDF from the extracted answer text and draws the
 * annotation boxes on top of it, followed by a full score + rubric breakdown.
 *
 * Deliberate design choice: this always regenerates the "answer paper" from
 * `studentText` using the same textLayout module that computed every
 * annotation's position (see gradingPipeline.ts) — it never tries to draw on
 * top of an arbitrary uploaded PDF's original bytes. `pdf-parse`/pdfjs give us
 * extracted text only, with no glyph-position data, so any attempt to overlay
 * boxes on the original file's real layout would be guesswork. Rendering a
 * canonical copy guarantees every box is exactly where the evidence quote it
 * came from actually is. The original uploaded file is never opened in write
 * mode and is left untouched on disk either way.
 */
export async function exportAnnotatedPdf(
  studentText: string,
  annotations: Annotation[],
  meta: ExportMeta = {},
  pointResults: ExportRubricPoint[] = [],
  summary?: ExportSummary
): Promise<Buffer> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const layout = computeTextLayout(studentText);
  const totalPages = Math.max(1, pageCount(layout));
  const pages: PDFPage[] = [];
  for (let p = 0; p < totalPages; p++) {
    pages.push(pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]));
  }

  const page1 = pages[0];

  page1.drawText('GradeSense — Graded Answer Paper', {
    x: MARGIN_X,
    y: PAGE_HEIGHT - 45,
    size: 16,
    font: fontBold,
    color: COLOR.ink,
  });

  if (meta.questionTitle) {
    page1.drawText(sanitizeFreely(font, meta.questionTitle), { x: MARGIN_X, y: PAGE_HEIGHT - 66, size: 12, font: fontBold, color: COLOR.ink });
  }

  const metaLine = [
    meta.studentName ? `Student: ${meta.studentName}` : null,
    meta.rollNumber ? `Roll: ${meta.rollNumber}` : null,
    meta.subject ? `Subject: ${meta.subject}` : null,
  ]
    .filter(Boolean)
    .join('   ·   ');
  if (metaLine) {
    page1.drawText(sanitizeFreely(font, metaLine), { x: MARGIN_X, y: PAGE_HEIGHT - 83, size: 9.5, font, color: COLOR.inkSoft });
  }

  // Result summary banner — score and status shown together, matching the
  // in-app rule: never a badge without its explanation right next to it.
  if (summary) {
    const bannerColor = summary.needsHumanReview ? COLOR.bad : summary.status === 'degraded' ? COLOR.partial : COLOR.good;
    const bannerBottom = PAGE_HEIGHT - 145;
    const bannerHeight = 48;

    page1.drawRectangle({
      x: MARGIN_X,
      y: bannerBottom,
      width: PAGE_WIDTH - MARGIN_X * 2,
      height: bannerHeight,
      color: COLOR.paper,
      borderColor: bannerColor,
      borderWidth: 1,
    });

    page1.drawText(`${summary.totalMarks} / ${summary.maxMarks}`, {
      x: MARGIN_X + 12,
      y: bannerBottom + 20,
      size: 18,
      font: fontBold,
      color: COLOR.ink,
    });

    const statusLabel = summary.needsHumanReview
      ? 'Needs Review'
      : summary.reviewedAt
      ? 'Reviewed by Teacher'
      : summary.status === 'degraded'
      ? 'Degraded Mode'
      : 'Evaluated';

    page1.drawText(statusLabel, { x: MARGIN_X + 100, y: bannerBottom + 30, size: 11, font: fontBold, color: bannerColor });

    const detailText = sanitizeFreely(font, summary.reviewReason || `${Math.round(summary.confidence * 100)}% confidence`);
    wrapPlainText(detailText, 95)
      .slice(0, 2)
      .forEach((line, i) => {
        page1.drawText(line, { x: MARGIN_X + 100, y: bannerBottom + 16 - i * 11, size: 8.5, font, color: COLOR.inkSoft });
      });
  }

  page1.drawLine({
    start: { x: MARGIN_X, y: PAGE_HEIGHT - 160 },
    end: { x: PAGE_WIDTH - MARGIN_X, y: PAGE_HEIGHT - 160 },
    thickness: 0.5,
    color: COLOR.rule,
  });

  if (!studentText.trim()) {
    page1.drawText('(No response submitted.)', {
      x: MARGIN_X,
      y: PAGE_HEIGHT - 185,
      size: 11,
      font,
      color: COLOR.inkSoft,
    });
  }

  layout.forEach(line => {
    const pageIdx = line.page - 1;
    const page = pages[pageIdx];
    if (!page || !line.text) return;
    page.drawText(sanitizePreservingLength(font, line.text), {
      x: line.x,
      y: PAGE_HEIGHT - line.y - FONT_SIZE,
      size: FONT_SIZE,
      font,
      color: COLOR.ink,
    });
  });

  // Only rubric-linked annotations get drawn on the paper — their position
  // came from actually locating the evidence quote in the student's text, so
  // a box there is a true claim about where a mistake is. A free-standing
  // "teacher note" (no linkedPointResultId) has no such anchor — there is no
  // in-app way to place one at a real spot on the page, so its x/y is just
  // an unused placeholder default. Drawing a colored box there would be a
  // false claim about location (it previously landed squarely on top of the
  // score banner). Those notes are listed instead, under their own "Teacher
  // Notes" heading further down — a separate, clearly labeled place, not a
  // phantom mark on the answer paper.
  const rubricLinkedAnnotations = annotations.filter(ann => ann.linkedPointResultId);
  const manualNotes = annotations.filter(ann => !ann.linkedPointResultId && ann.correctionText?.trim());

  // Group annotations that belong to the same correction (a quote spanning
  // multiple lines produces one box per line, all sharing one note) so each
  // gets exactly one number, not a floating text callout per box. Floating
  // callouts placed independently next to each box is what caused them to
  // pile on top of each other and the answer text whenever two flagged
  // phrases sit close together — extremely common, since mistakes cluster.
  // A small colored number badge on the text plus one clean list below can
  // never collide, however close together the flagged phrases are.
  const groups = new Map<string, Annotation[]>();
  rubricLinkedAnnotations.forEach(ann => {
    const key = ann.linkedPointResultId!;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ann);
  });

  const orderedGroups = Array.from(groups.values()).sort((a, b) => {
    const pageDiff = a[0].page - b[0].page;
    if (pageDiff !== 0) return pageDiff;
    return a[0].y - b[0].y;
  });

  const numberByPointResultId: Record<string, number> = {};

  orderedGroups.forEach((group, groupIdx) => {
    const number = groupIdx + 1;
    const linkedId = group[0].linkedPointResultId;
    if (linkedId) numberByPointResultId[linkedId] = number;
    const pr = pointResults.find(p => p.id === linkedId);
    const badgeColor = pr ? statusColorFor(pr.status, pr.marksAwarded, pr.maxMarks) : COLOR.bad;

    group.forEach((ann, i) => {
      const pageIdx = Math.max(0, Math.min(ann.page - 1, pages.length - 1));
      const page = pages[pageIdx];
      const pdfY = PAGE_HEIGHT - ann.y - ann.height;

      if (ann.type === 'box') {
        page.drawRectangle({
          x: ann.x,
          y: pdfY,
          width: ann.width,
          height: ann.height,
          borderColor: badgeColor,
          borderWidth: 1.5,
          color: rgb(1, 0.95, 0.95),
          opacity: 0.55,
        });
      } else {
        page.drawLine({
          start: { x: ann.x, y: pdfY + 2 },
          end: { x: ann.x + ann.width, y: pdfY + 2 },
          thickness: 2,
          color: badgeColor,
        });
      }

      // Only the first box in the group gets the number badge — the rest
      // are continuation lines of the same flagged quote. Placed in the
      // right margin (never occupied by answer text) rather than right
      // after wherever that physical line happened to wrap — an inline
      // badge for a multi-line quote landed at that line's wrap point,
      // which usually fell mid-sentence right before the quote continued
      // on the next line, visually cutting into the reading flow. A
      // margin badge can never collide with text, however the quote wraps.
      if (i === 0) {
        const badgeX = PAGE_WIDTH - MARGIN_RIGHT + 10;
        page.drawRectangle({ x: badgeX, y: pdfY + 2, width: 14, height: 12, color: badgeColor });
        page.drawText(String(number), {
          x: badgeX + (number < 10 ? 5 : 2),
          y: pdfY + 5,
          size: 8,
          font: fontBold,
          color: COLOR.white,
        });
      }
    });
  });

  // Original Uploaded Answer — the actual photographed/scanned page, so a
  // teacher can check the AI's transcription and every red mark above
  // directly against the real handwriting, not just trust the reading of
  // it. Best-effort: only present when the caller could actually get an
  // image for this submission; silently omitted otherwise, and any failure
  // here must never break the export itself.
  if (meta.originalImageBuffer) {
    try {
      const image = isPngBuffer(meta.originalImageBuffer)
        ? await pdfDoc.embedPng(meta.originalImageBuffer)
        : await pdfDoc.embedJpg(meta.originalImageBuffer);

      const originalPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      originalPage.drawText('Original Uploaded Answer (as submitted)', {
        x: MARGIN_X,
        y: PAGE_HEIGHT - 45,
        size: 16,
        font: fontBold,
        color: COLOR.ink,
      });
      originalPage.drawText('Shown for direct reference — check the transcription and every red mark above against the real handwriting here.', {
        x: MARGIN_X,
        y: PAGE_HEIGHT - 63,
        size: 9,
        font,
        color: COLOR.inkSoft,
      });

      const maxW = PAGE_WIDTH - MARGIN_X * 2;
      const maxH = PAGE_HEIGHT - 100;
      const scaled = image.scaleToFit(maxW, maxH);
      originalPage.drawImage(image, {
        x: MARGIN_X + (maxW - scaled.width) / 2,
        y: 50 + (maxH - scaled.height) / 2,
        width: scaled.width,
        height: scaled.height,
      });
    } catch (err: any) {
      console.error('Failed to embed original answer image into exported PDF:', err?.message || err);
    }
  }

  // Full rubric breakdown page — every point, not just the flagged ones, so
  // the exported PDF alone carries everything the brief's "expected grading
  // result" fields require (total, per-point marks, correct/missing/wrong,
  // feedback) instead of only the mistakes with no score visible anywhere.
  if (pointResults.length > 0) {
    const notesPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - 50;
    notesPage.drawText('Rubric Breakdown', { x: MARGIN_X, y, size: 16, font: fontBold, color: COLOR.ink });
    if (summary) {
      notesPage.drawText(`Score: ${summary.totalMarks} / ${summary.maxMarks}`, {
        x: PAGE_WIDTH - MARGIN_X - 110,
        y,
        size: 12,
        font: fontBold,
        color: COLOR.ink,
      });
    }
    y -= 28;

    for (const pr of pointResults) {
      const color = statusColorFor(pr.status, pr.marksAwarded, pr.maxMarks);
      const number = numberByPointResultId[pr.id];
      const label = sanitizeFreely(font, number ? `[${number}] ${pr.criterion}` : pr.criterion);

      if (y < 70) break; // one page is ample for the short rubric lists this tool grades against

      notesPage.drawRectangle({ x: MARGIN_X, y: y - 3, width: 8, height: 8, color });
      // A long criterion (common — these are full rubric sentences) was
      // previously drawn as one unwrapped line and could run straight into
      // the marks-awarded figure on the right. Wrapped narrowly enough that
      // even its first line never reaches that column.
      const labelLines = wrapPlainText(label, 72);
      labelLines.forEach((line, i) => {
        notesPage.drawText(line, { x: MARGIN_X + 14, y: y - i * 13, size: 10.5, font: fontBold, color: COLOR.ink });
      });
      notesPage.drawText(`${pr.marksAwarded}/${pr.maxMarks}`, {
        x: PAGE_WIDTH - MARGIN_X - 30,
        y,
        size: 10.5,
        font: fontBold,
        color,
      });
      y -= labelLines.length * 13 + 2;

      for (const line of wrapPlainText(sanitizeFreely(font, pr.feedback), 95)) {
        if (y < 60) break;
        notesPage.drawText(line, { x: MARGIN_X + 14, y, size: 9.5, font, color: COLOR.inkSoft });
        y -= 13;
      }
      y -= 10;
    }
  }

  // Model Answer — a separate reference page, clearly marked as not graded.
  // The in-app view has always had a "Model Answer" tab for this, but the
  // exported PDF never carried it — meaning a teacher without the app open
  // (which is the whole point of exporting a PDF) had no way to see what
  // "would improve the answer" alongside the student's own paper.
  if (meta.modelAnswerText?.trim()) {
    let modelPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - 50;
    modelPage.drawText('Model Answer — Reference', { x: MARGIN_X, y, size: 16, font: fontBold, color: COLOR.ink });
    y -= 20;
    modelPage.drawText('Not graded — provided as the marking-scheme reference for this question.', {
      x: MARGIN_X,
      y,
      size: 9,
      font,
      color: COLOR.good,
    });
    y -= 26;

    for (const line of wrapPlainText(sanitizeFreely(font, meta.modelAnswerText), 92)) {
      if (y < 60) {
        modelPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
        y = PAGE_HEIGHT - 50;
      }
      modelPage.drawText(line, { x: MARGIN_X, y, size: 10.5, font, color: COLOR.ink });
      y -= 15;
    }
  }

  // Teacher Notes — a separate page, clearly labeled, distinct from the
  // rubric breakdown above. These are free-standing comments the teacher
  // wrote, not tied to any rubric point or its marks, so they read as the
  // teacher's own voice rather than being mixed into the auto-generated
  // per-criterion feedback.
  if (manualNotes.length > 0) {
    const teacherNotesPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - 50;
    teacherNotesPage.drawText('Teacher Notes', { x: MARGIN_X, y, size: 16, font: fontBold, color: COLOR.ink });
    y -= 20;
    teacherNotesPage.drawText('Free-standing notes added by the teacher — not tied to a specific rubric point or its marks.', {
      x: MARGIN_X,
      y,
      size: 9,
      font,
      color: COLOR.inkSoft,
    });
    y -= 26;

    for (const note of manualNotes) {
      if (y < 70) break;
      teacherNotesPage.drawRectangle({ x: MARGIN_X, y: y - 3, width: 8, height: 8, color: COLOR.ink });
      const lines = wrapPlainText(sanitizeFreely(font, note.correctionText), 92);
      lines.forEach((line, i) => {
        if (y - i * 13 < 60) return;
        teacherNotesPage.drawText(line, { x: MARGIN_X + 14, y: y - i * 13, size: 10, font, color: COLOR.ink });
      });
      y -= lines.length * 13 + 12;
    }
  }

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
}

function wrapPlainText(text: string, maxCharsPerLine: number): string[] {
  const lines: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    let end = Math.min(cursor + maxCharsPerLine, text.length);
    if (end < text.length) {
      const lastSpace = text.lastIndexOf(' ', end);
      if (lastSpace > cursor) end = lastSpace;
    }
    lines.push(text.slice(cursor, end).trim());
    let next = end;
    while (next < text.length && text[next] === ' ') next++;
    cursor = next;
  }
  return lines;
}
