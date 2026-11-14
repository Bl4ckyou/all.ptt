import { describe, expect, it } from 'vitest';
import { draftCategory, modelMatchScore, nameTokens, repositoryKey } from './matching.js';

const gemmaModel = {
  path: '/cache/hub/models--ggml-org--gemma-3-4b/snapshots/abc/gemma-3-4b-it-Q4_K_M.gguf',
  name: 'gemma-3-4b-it-Q4_K_M',
  size: 1,
  source: 'huggingface',
};

const gemmaProjector = {
  path: '/cache/hub/models--ggml-org--gemma-3-4b/snapshots/abc/mmproj-gemma-3-4b-f16.gguf',
  name: 'mmproj-gemma-3-4b-f16',
  size: 1,
  source: 'huggingface',
};

const bonsaiProjector = {
  path: '/cache/hub/models--prism--bonsai-27b/snapshots/def/mmproj-bonsai-27b-f16.gguf',
  name: 'mmproj-bonsai-27b-f16',
  size: 1,
  source: 'huggingface',
};

describe('nameTokens', () => {
  it('ignores sizes and quantization tokens', () => {
    const tokens = nameTokens('gemma-3-4b-it-Q4_K_M');
    expect(tokens.has('gemma')).toBe(true);
    expect(tokens.has('4b')).toBe(false);
    expect(tokens.has('q4')).toBe(false);
  });
});

describe('repositoryKey', () => {
  it('groups files from the same Hugging Face snapshot', () => {
    expect(repositoryKey(gemmaModel.path)).toBe(repositoryKey(gemmaProjector.path));
  });
});

describe('modelMatchScore', () => {
  it('matches the projector from the same model family', () => {
    expect(modelMatchScore(gemmaProjector, gemmaModel)).toBeGreaterThan(0);
  });

  it('rejects projectors from unrelated models', () => {
    expect(modelMatchScore(bonsaiProjector, gemmaModel)).toBe(0);
  });
});

describe('draftCategory', () => {
  it('classifies assistant, dflash, dspark and mtp files', () => {
    expect(draftCategory('gemma-3-4b-assistant')).toBe('assistant');
    expect(draftCategory('gemma-3-4b-dflash')).toBe('dflash');
    expect(draftCategory('gemma-3-4b-dspark')).toBe('dspark');
    expect(draftCategory('gemma-3-4b-mtp')).toBe('mtp');
    expect(draftCategory('gemma-3-4b')).toBe('other');
  });
});
