// Shared fuzzy text-location logic — used by gradingPipeline.ts (to locate
// an LLM's claimed evidence quote in the student's real answer, for
// annotation placement) AND by mockGrader.ts (to verify that a canned
// fixture's evidence quote is actually present before trusting that
// fixture's fixed score for an arbitrary, possibly-different submission —
// see mockGrader.ts for why that check exists). Lives in its own module
// rather than being defined in gradingPipeline.ts so mockGrader.ts can import
// it without a circular dependency (gradingPipeline.ts imports MockGrader).

/**
 * Builds a lowercase, whitespace-collapsed copy of `text` alongside a map from
 * each character of that copy back to its index in the original string. This
 * lets fuzzyMatchQuote locate a quote using a forgiving (case/whitespace
 * insensitive) search while still returning exact offsets into the ORIGINAL
 * text — which is what annotation placement and highlighting need.
 */
function buildNormalizedMap(text: string): { normalized: string; map: number[] } {
  let normalized = '';
  const map: number[] = [];
  let lastWasSpace = true;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) {
      if (!lastWasSpace) {
        normalized += ' ';
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    normalized += ch.toLowerCase();
    map.push(i);
    lastWasSpace = false;
  }

  return { normalized, map };
}

export interface FuzzyMatchResult {
  matched: boolean;
  normalizedQuote: string | null;
  startOffset: number | null;
  endOffset: number | null;
}

export function fuzzyMatchQuote(quote: string | null, fullText: string): FuzzyMatchResult {
  if (!quote || !quote.trim()) {
    return { matched: false, normalizedQuote: null, startOffset: null, endOffset: null };
  }

  const trimmedQuote = quote.trim();
  const cleanQuote = trimmedQuote.toLowerCase().replace(/\s+/g, ' ');
  const { normalized: cleanText, map } = buildNormalizedMap(fullText);

  const toOriginalRange = (normalizedIdx: number, normalizedLen: number) => {
    const startOffset = map[normalizedIdx];
    const lastCharIdx = Math.min(normalizedIdx + normalizedLen - 1, map.length - 1);
    const endOffset = map[lastCharIdx] + 1;
    return { startOffset, endOffset };
  };

  // Exact substring match
  const exactIdx = cleanText.indexOf(cleanQuote);
  if (exactIdx !== -1) {
    const { startOffset, endOffset } = toOriginalRange(exactIdx, cleanQuote.length);
    return { matched: true, normalizedQuote: trimmedQuote, startOffset, endOffset };
  }

  // Sliding-window partial match: if a contiguous prefix/suffix chunk of the
  // quote (>=50% of its words, min 3) appears verbatim, accept it as located.
  const quoteWords = cleanQuote.split(' ');
  if (quoteWords.length >= 3) {
    for (let len = quoteWords.length; len >= Math.max(3, Math.ceil(quoteWords.length * 0.5)); len--) {
      const snippet = quoteWords.slice(0, len).join(' ');
      const idx = cleanText.indexOf(snippet);
      if (idx !== -1) {
        const { startOffset, endOffset } = toOriginalRange(idx, snippet.length);
        return { matched: true, normalizedQuote: trimmedQuote, startOffset, endOffset };
      }
    }
    for (let start = 1; start < quoteWords.length - 2; start++) {
      const snippet = quoteWords.slice(start, start + Math.max(3, Math.ceil(quoteWords.length * 0.4))).join(' ');
      const idx = cleanText.indexOf(snippet);
      if (idx !== -1) {
        const { startOffset, endOffset } = toOriginalRange(idx, snippet.length);
        return { matched: true, normalizedQuote: trimmedQuote, startOffset, endOffset };
      }
    }
  }

  return { matched: false, normalizedQuote: trimmedQuote, startOffset: null, endOffset: null };
}
