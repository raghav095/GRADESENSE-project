import mammoth from 'mammoth';

// mammoth extracts DOCX body text with paragraph breaks preserved as '\n' —
// it can't see embedded images any more than pdfjs can, so a diagram pasted
// into a Word document is just as invisible to this pipeline as one in a
// scanned PDF; gradingPipeline's diagram-criterion review flag applies to
// any non-pasted source for exactly this reason, not just PDFs.
export async function extractTextFromDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value.trim();
  } catch (err: any) {
    throw new Error(`Failed to extract text from DOCX: ${err.message}`);
  }
}
