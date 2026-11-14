import { describe, expect, it } from 'vitest';
import { isUsableModelFile } from './models.js';

describe('isUsableModelFile', () => {
  it('keeps regular model files', () => {
    expect(isUsableModelFile('Qwen3-4B-Q4_K_M.gguf')).toBe(true);
  });

  it('skips vision projectors and mtp heads', () => {
    expect(isUsableModelFile('Bonsai-27B-mmproj-BF16.gguf')).toBe(false);
    expect(isUsableModelFile('mmproj-F16.gguf')).toBe(false);
    expect(isUsableModelFile('mtp-gemma-4-E2B-it.gguf')).toBe(false);
  });

  it('keeps only the first part of a split model', () => {
    expect(isUsableModelFile('Model-Q4-00001-of-00004.gguf')).toBe(true);
    expect(isUsableModelFile('Model-Q4-00002-of-00004.gguf')).toBe(false);
  });

  it('ignores non-gguf files', () => {
    expect(isUsableModelFile('README.md')).toBe(false);
  });
});
