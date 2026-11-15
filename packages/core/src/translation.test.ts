import { describe, expect, it } from 'vitest';
import {
  baseLanguage,
  isTranslationModel,
  languageName,
  protectTokens,
  restoreTokens,
} from './translation.js';

function roundTrip(text: string): string | null {
  const { masked, tokens } = protectTokens(text);
  return restoreTokens(masked, tokens);
}

describe('protectTokens', () => {
  it('protects flags, placeholders and quant names', () => {
    const { masked, tokens } = protectTokens(
      'Set --context-size with Q4_K_M and {cpu}; see `--flash-attn`.',
    );
    expect(masked).not.toContain('--context-size');
    expect(masked).not.toContain('Q4_K_M');
    expect(masked).not.toContain('{cpu}');
    expect(masked).not.toContain('--flash-attn');
    expect([...tokens].sort()).toEqual(
      ['`--flash-attn`', '--context-size', '{cpu}', 'Q4_K_M'].sort(),
    );
  });

  it('protects urls and plain float types', () => {
    const { tokens } = protectTokens('Use f16 or BF16 from https://example.test/model');
    expect(tokens).toEqual(['https://example.test/model', 'BF16']);
  });

  it('round-trips the original text', () => {
    const text = 'Use --threads 8 with Q4_K_M and {cpu} on `llama.cpp`.';
    expect(roundTrip(text)).toBe(text);
  });
});

describe('restoreTokens', () => {
  it('returns null when the model dropped a placeholder', () => {
    const { tokens } = protectTokens('Use --threads 8');
    expect(restoreTokens('Utiliser', tokens)).toBeNull();
  });

  it('returns null for an unknown placeholder', () => {
    expect(restoreTokens('Utiliser \uE0005\uE001', ['--threads'])).toBeNull();
  });
});

describe('isTranslationModel', () => {
  it('detects translation capability from GGUF tags', () => {
    expect(isTranslationModel(['translation'])).toBe(true);
    expect(isTranslationModel(['Multilingual', 'Translation'])).toBe(true);
  });

  it('detects translation capability from the chat template', () => {
    expect(isTranslationModel([], '{% if target_lang %}x{% endif %}')).toBe(true);
  });

  it('ignores unrelated models', () => {
    expect(isTranslationModel(['chat'], '{{ messages }}')).toBe(false);
    expect(isTranslationModel(undefined)).toBe(false);
  });
});

describe('locales', () => {
  it('normalizes locale variants', () => {
    expect(baseLanguage('zh-CN')).toBe('zh');
    expect(baseLanguage('pt_BR')).toBe('pt');
  });

  it('resolves a human language name', () => {
    expect(languageName('fr')).toBe('French');
    expect(languageName('zh-CN')).toBe('Chinese');
  });
});
