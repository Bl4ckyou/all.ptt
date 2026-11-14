import { describe, expect, it } from 'vitest';
import { detectLocale, parseAcceptLanguage } from './detect.js';

describe('detectLocale', () => {
  it('matches a regional tag to its base locale', () => {
    expect(detectLocale(['fr-CA', 'en-US'])).toBe('fr');
  });

  it('falls back to the default locale', () => {
    expect(detectLocale(['xx-YY'])).toBe('en');
  });

  it('respects the order of preference', () => {
    expect(detectLocale(['de-DE', 'fr-FR'])).toBe('de');
  });
});

describe('parseAcceptLanguage', () => {
  it('strips quality values and whitespace', () => {
    expect(parseAcceptLanguage('fr-FR,fr;q=0.9,en;q=0.8')).toEqual(['fr-FR', 'fr', 'en']);
  });

  it('returns an empty list for a missing header', () => {
    expect(parseAcceptLanguage(undefined)).toEqual([]);
  });
});
