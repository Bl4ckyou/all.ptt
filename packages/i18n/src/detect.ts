import { negotiateLanguages } from '@fluent/langneg';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locales.js';

// Pick the best supported locale from an Accept-Language / navigator list.
export function detectLocale(
  accepted: readonly string[],
  supported: readonly string[] = SUPPORTED_LOCALES,
  defaultLocale: string = DEFAULT_LOCALE,
): string {
  const [match] = negotiateLanguages(accepted, supported, {
    defaultLocale,
  });
  return match ?? defaultLocale;
}

export function parseAcceptLanguage(header: string | undefined): string[] {
  if (!header) return [];
  return header
    .split(',')
    .map((part) => part.split(';')[0]?.trim() ?? '')
    .filter((tag) => tag.length > 0);
}
