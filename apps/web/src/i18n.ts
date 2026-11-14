import { Translator } from '@ptt/i18n';
import { getCatalog } from './api.js';

const STORAGE_KEY = 'ptt.locale';
const sources = new Map<string, string>();
let translator: Translator | null = null;

export function readStoredLocale(): string | null {
  return localStorage.getItem(STORAGE_KEY);
}

export function storeLocale(locale: string): void {
  localStorage.setItem(STORAGE_KEY, locale);
}

export async function loadI18n(locale: string, defaultLocale: string): Promise<void> {
  const wanted = locale === defaultLocale ? [locale] : [locale, defaultLocale];

  await Promise.all(
    wanted.map(async (target) => {
      if (sources.has(target)) return;
      sources.set(target, await getCatalog(target));
    }),
  );

  translator = new Translator(locale, Object.fromEntries(sources), defaultLocale);
}

export function t(key: string, args?: Record<string, string | number>): string {
  return translator?.t(key, args) ?? key;
}
