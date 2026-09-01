import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';

const execFileAsync = promisify(execFile);

/**
 * Renders a PDF's pages to PNG image buffers via poppler's `pdftoppm` — for
 * handing to a vision-capable model. pdfjs's text extraction (pdfService.ts)
 * only ever sees rendered text runs, never pixels, so a diagram/figure needs
 * an actual image.
 *
 * Deliberately shells out to pdftoppm rather than rendering via pdfjs-dist +
 * a Node canvas library: tried both @napi-rs/canvas and node-canvas, and
 * pdfjs-dist's Node rendering path fails specifically on a PDF containing an
 * embedded raster image (`TypeError: Image or Canvas expected` inside
 * pdfjs's own paintImageXObject) — confirmed against a real uploaded answer
 * paper with an embedded circuit diagram, exactly the realistic case (a
 * diagram pasted or scanned into the document), even though it worked fine
 * for a synthetic PDF using only vector-drawn shapes and text. Poppler is a
 * mature, full PDF rendering engine that handles both cases correctly —
 * confirmed against that same real file.
 *
 * Requires poppler-utils installed separately (`brew install poppler` on
 * macOS, `apt-get install poppler-utils` on Linux) — NOT an npm dependency,
 * so it must be listed in the README's setup steps. This is a best-effort
 * enhancement: if pdftoppm isn't installed or fails for any reason, this
 * returns [] and the caller falls back to flagging diagram/figure criteria
 * for human review, exactly as it did before this existed. Nothing about
 * grading itself breaks if poppler is absent.
 */
export async function renderPdfPagesToImages(pdfBuffer: Buffer, maxPages = 3): Promise<Buffer[]> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gradesense-render-'));
  const pdfPath = path.join(tmpDir, 'input.pdf');
  const outPrefix = path.join(tmpDir, 'page');

  try {
    fs.writeFileSync(pdfPath, pdfBuffer);
    // 220 DPI rather than 150: a typed diagram reads fine at 150, but a
    // scanned/photographed page of handwriting needs the extra pixel density
    // for a vision model to make out individual letterforms reliably.
    await execFileAsync('pdftoppm', ['-png', '-r', '220', '-f', '1', '-l', String(maxPages), pdfPath, outPrefix]);

    const files = fs
      .readdirSync(tmpDir)
      .filter(f => f.startsWith('page') && f.endsWith('.png'))
      .sort();
    return files.map(f => fs.readFileSync(path.join(tmpDir, f)));
  } catch (err: any) {
    console.error('renderPdfPagesToImages failed (pdftoppm missing or errored):', err?.message || err);
    return [];
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
