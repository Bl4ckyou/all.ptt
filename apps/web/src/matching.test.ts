import { describe, expect, it } from 'vitest';
import {
  baseArchitecture,
  draftCategory,
  draftMatchScore,
  mmprojMatchScore,
  nameTokens,
  repositoryKey,
} from './matching.js';

const gemmaModel = {
  path: '/cache/hub/models--ggml-org--gemma-3-4b/snapshots/abc/gemma-4-E2B-it-Q4_K_M.gguf',
  name: 'gemma-4-E2B-it-Q4_K_M',
  size: 1,
  source: 'huggingface',
  architecture: 'gemma4',
  contextLength: 131072,
  embeddingLength: 1536,
  blockCount: 35,
};

const gemmaProjector = {
  path: '/cache/hub/models--ggml-org--gemma-3-4b/snapshots/abc/mmproj-gemma-4-E2B-f16.gguf',
  name: 'mmproj-gemma-4-E2B-f16',
  size: 1,
  source: 'huggingface',
  architecture: 'clip',
};

const bonsaiProjector = {
  path: '/cache/hub/models--prism--bonsai-27b/snapshots/def/mmproj-bonsai-27b-f16.gguf',
  name: 'mmproj-bonsai-27b-f16',
  size: 1,
  source: 'huggingface',
  architecture: 'clip',
};

const e2bMtp = {
  path: '/cache/hub/models--unsloth--gemma-4-E2B/snapshots/xyz/mtp-gemma-4-E2B-it.gguf',
  name: 'mtp-gemma-4-E2B-it',
  size: 1,
  source: 'huggingface',
  category: 'mtp' as const,
  architecture: 'gemma4-assistant',
  contextLength: 131072,
  embeddingLength: 256,
  blockCount: 4,
};

const gemma26bMtp = {
  path: '/cache/hub/models--unsloth--gemma-4-26B/snapshots/xyz/mtp-gemma-4-26B-A4B-it.gguf',
  name: 'mtp-gemma-4-26B-A4B-it',
  size: 1,
  source: 'huggingface',
  category: 'mtp' as const,
  architecture: 'gemma4-assistant',
  contextLength: 262144,
  embeddingLength: 1024,
  blockCount: 4,
};

const raonMtp = {
  path: '/cache/hub/models--someone--raon/snapshots/xyz/raon-1-nano-MTP.gguf',
  name: 'raon-1-nano-MTP',
  size: 1,
  source: 'huggingface',
  category: 'mtp' as const,
  architecture: 'raon1nano',
  contextLength: 32768,
  embeddingLength: 1536,
  blockCount: 25,
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

describe('baseArchitecture', () => {
  it('strips assistant and draft suffixes', () => {
    expect(baseArchitecture('gemma4-assistant')).toBe('gemma4');
    expect(baseArchitecture('gemma4')).toBe('gemma4');
  });
});

describe('mmprojMatchScore', () => {
  it('matches the projector from the same model family', () => {
    expect(mmprojMatchScore(gemmaProjector, gemmaModel)).toBeGreaterThan(0);
  });

  it('rejects projectors from unrelated models', () => {
    expect(mmprojMatchScore(bonsaiProjector, gemmaModel)).toBe(0);
  });
});

describe('draftMatchScore', () => {
  it('matches the E2B MTP to the E2B model', () => {
    expect(draftMatchScore(e2bMtp, gemmaModel)).toBeGreaterThan(0);
  });

  it('rejects the 26B MTP because the context length differs', () => {
    expect(draftMatchScore(gemma26bMtp, gemmaModel)).toBe(0);
  });

  it('rejects a different architecture even with a similar name', () => {
    expect(draftMatchScore(raonMtp, gemmaModel)).toBe(0);
  });

  it('rejects a renamed 26B MTP using metadata only', () => {
    const renamed = { ...gemma26bMtp, name: 'mtp-gemma-4-E2B-it', path: '/tmp/x.gguf' };
    expect(draftMatchScore(renamed, gemmaModel)).toBe(0);
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
