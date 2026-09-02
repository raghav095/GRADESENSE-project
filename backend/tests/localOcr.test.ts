import { describe, it, expect } from 'vitest';
import { extractHandwrittenTextLocally } from '../src/services/localOcrService.js';

describe('Local OCR & HTR Service', () => {
  it('returns null for an empty buffer', async () => {
    const result = await extractHandwrittenTextLocally(Buffer.from([]));
    expect(result).toBeNull();
  });

  it('handles small synthetic image buffer gracefully', async () => {
    // 1x1 pixel valid PNG buffer
    const tinyPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    const result = await extractHandwrittenTextLocally(tinyPng);
    // Should complete without throwing, returning null or string
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
