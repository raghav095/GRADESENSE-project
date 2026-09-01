// Single source of truth for turning plain answer text into a paginated,
// fixed-width line layout. Both the annotated-PDF exporter (pdfService.ts)
// and the annotation-position calculator (gradingPipeline.ts) use this same
// module, so an annotation box is always computed against the exact same
// line breaks the exported PDF actually draws — they can never drift apart.
//
// We deliberately wrap by a fixed character budget rather than measuring
// real glyph widths: this keeps position math synchronous and dependency-free
// while still guaranteeing the two consumers agree with each other, which is
// the property that actually matters ("the box is at the correct place").

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;
export const MARGIN_X = 50;
export const MARGIN_RIGHT = 50;
export const TOP_MARGIN = 195; // fixed room for title/student header + the score/status banner drawn by pdfService.ts — must stay a constant here since annotation positions are computed against it at grading time, before export-time content (like the banner's exact height) is known
export const BOTTOM_MARGIN = 60;
export const FONT_SIZE = 11;
export const LINE_HEIGHT = 18;
export const USABLE_WIDTH = PAGE_WIDTH - MARGIN_X - MARGIN_RIGHT;
export const MAX_CHARS_PER_LINE = 92;
export const CHAR_WIDTH = USABLE_WIDTH / MAX_CHARS_PER_LINE;
export const LINES_PER_PAGE = Math.max(1, Math.floor((PAGE_HEIGHT - TOP_MARGIN - BOTTOM_MARGIN) / LINE_HEIGHT));

export interface LayoutLine {
  page: number;
  text: string;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number; // top-left, UI coordinate space (0 = top of page)
  width: number;
  height: number;
}

export interface AnnotationBox {
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export function computeTextLayout(text: string): LayoutLine[] {
  const lines: LayoutLine[] = [];
  let page = 1;
  let lineOnPage = 0;
  let offset = 0;

  const advancePage = () => {
    if (lineOnPage >= LINES_PER_PAGE) {
      page++;
      lineOnPage = 0;
    }
  };

  const paragraphs = text.split('\n');
  paragraphs.forEach((para, idx) => {
    const isLastParagraph = idx === paragraphs.length - 1;

    if (para.trim() === '') {
      advancePage();
      lineOnPage++;
    } else {
      let cursor = 0;
      while (cursor < para.length) {
        let end = Math.min(cursor + MAX_CHARS_PER_LINE, para.length);
        if (end < para.length) {
          const lastSpace = para.lastIndexOf(' ', end);
          if (lastSpace > cursor) end = lastSpace;
        }

        advancePage();
        lines.push({
          page,
          text: para.slice(cursor, end),
          startOffset: offset + cursor,
          endOffset: offset + end,
          x: MARGIN_X,
          y: TOP_MARGIN + lineOnPage * LINE_HEIGHT,
          width: (end - cursor) * CHAR_WIDTH,
          height: LINE_HEIGHT,
        });
        lineOnPage++;

        let next = end;
        while (next < para.length && para[next] === ' ') next++;
        cursor = next;
      }
    }

    offset += para.length + (isLastParagraph ? 0 : 1); // +1 for the '\n' consumed by split
  });

  return lines;
}

/** One box per line a [startOffset, endOffset) character range visually spans. */
export function boxesForRange(lines: LayoutLine[], startOffset: number, endOffset: number): AnnotationBox[] {
  const boxes: AnnotationBox[] = [];
  for (const line of lines) {
    if (line.endOffset <= startOffset || line.startOffset >= endOffset) continue;
    const segStart = Math.max(startOffset, line.startOffset);
    const segEnd = Math.min(endOffset, line.endOffset);
    const charsBefore = segStart - line.startOffset;
    const charsIn = Math.max(1, segEnd - segStart);
    boxes.push({
      page: line.page,
      x: MARGIN_X + charsBefore * CHAR_WIDTH,
      y: line.y,
      width: charsIn * CHAR_WIDTH,
      height: LINE_HEIGHT,
    });
  }
  return boxes;
}

export function pageCount(lines: LayoutLine[]): number {
  return lines.reduce((max, l) => Math.max(max, l.page), 1);
}
