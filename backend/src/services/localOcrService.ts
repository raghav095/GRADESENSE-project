import { pipeline, RawImage } from '@xenova/transformers';
import { createWorker } from 'tesseract.js';

let trocrPipeline: any = null;

async function getTrOcrPipeline() {
  if (!trocrPipeline) {
    try {
      // Lazy load TrOCR handwritten model weights on first use
      trocrPipeline = await pipeline('image-to-text', 'Xenova/trocr-small-handwritten');
    } catch (err) {
      console.warn('Failed to load local TrOCR model, will fallback to Tesseract:', err);
      trocrPipeline = null;
    }
  }
  return trocrPipeline;
}

/**
 * Extracts handwritten text locally without calling any cloud AI LLM API.
 * Uses Microsoft TrOCR (via @xenova/transformers) as primary local engine,
 * falling back to Tesseract OCR if TrOCR is unavailable or yields empty output.
 */
export async function extractHandwrittenTextLocally(imageBuffer: Buffer): Promise<string | null> {
  if (!imageBuffer || imageBuffer.length === 0) return null;

  // 1. Primary Local Engine: Microsoft TrOCR via @xenova/transformers
  try {
    const pipe = await getTrOcrPipeline();
    if (pipe) {
      const mimeType = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 ? 'image/png' : 'image/jpeg';
      const blob = new Blob([imageBuffer as unknown as BlobPart], { type: mimeType });
      const rawImage = await RawImage.fromBlob(blob);
      const output = await pipe(rawImage);
      if (Array.isArray(output) && output.length > 0 && output[0]?.generated_text) {
        const transcribed = output[0].generated_text.trim();
        if (transcribed.length > 0) {
          return transcribed;
        }
      }
    }
  } catch (err) {
    console.warn('TrOCR inference error, falling back to Tesseract:', err);
  }

  // 2. Secondary Local Engine: Tesseract OCR
  try {
    const worker = await createWorker('eng');
    const mimeType = imageBuffer[0] === 0x89 && imageBuffer[1] === 0x50 ? 'image/png' : 'image/jpeg';
    const dataUri = `data:${mimeType};base64,${imageBuffer.toString('base64')}`;

    const res = await worker.recognize(dataUri);
    await worker.terminate();

    const tesseractText = res?.data?.text?.trim();
    if (tesseractText && tesseractText.length > 0) {
      return tesseractText;
    }
  } catch (tessErr) {
    console.warn('Tesseract OCR fallback failed:', tessErr);
  }

  return null;
}
